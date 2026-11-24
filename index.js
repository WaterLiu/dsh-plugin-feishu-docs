/**
 * Host half of the Feishu documents chip.
 *
 * Answers one question per Session — "which Feishu documents do its messages
 * show?" — by reading that Session's own log, then asks Feishu (through
 * `lark-cli`) for what the log cannot know: the real title, the creator, and
 * whether the document still exists.
 *
 * Routes:
 *   GET  /x-feishu-docs/session.json?sid=<id>&rev=<rev>
 *                                             the documents of one Session, or
 *                                             `{ unchanged }` when nothing changed;
 *   GET  /x-feishu-docs/doctor.json           what this machine still needs;
 *   GET  /x-feishu-docs/avatar                the signed-in user's avatar, cached;
 *   GET  /x-feishu-docs/log?d=<json>           one client trace line, for support;
 *   GET  /x-feishu-docs/auth/start?scopes=<csv>   begin a device-code login;
 *   GET  /x-feishu-docs/auth/finish?device=<code> complete it;
 *   GET  /x-feishu-docs/auth/logout               sign out.
 *
 * @author WaterLiu
 */
import { appendFile, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { locate, readSession } from './scan.js'
import { creatorStatus, enrichCreators } from './owners.js'
import { cachedAvatar } from './avatar.js'
import { diagnose, finishLogin, lastProbe, logout, refreshAuth, startLogin } from './setup.js'

/** The web server owns the route table. */
export const inject = ['webServer']

const ROUTE = '/x-feishu-docs'
/** Where the popover's traces land, next to the plugin's other files. */
const STATE = process.env.FEISHU_DOCS_STATE_DIR || join(homedir(), '.dsh')
const LOG_PATH = join(STATE, 'feishu-docs-log.ndjson')

/** Append one line to the trace, rotating past 512 KiB. Never throws. */
async function trace(entry) {
  try {
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`
    const size = await stat(LOG_PATH).then((info) => info.size).catch(() => 0)
    if (size > 512 * 1024) await rename(LOG_PATH, `${LOG_PATH}.1`).catch(() => {})
    await appendFile(LOG_PATH, line)
  } catch (error) {
    /* a trace that cannot be written must never break the popover */
  }
}

/**
 * Keep the token alive while the app runs.
 *
 * The access token lives two hours and the CLI renews it on the next authorized
 * call, so a quiet spell — the usual case between chats — is what makes people log
 * in again. One renewal every 90 minutes is far below that limit and costs a single
 * read-only call when nothing needs doing.
 */
const KEEPALIVE_MS = 90 * 60 * 1000
let keepAliveTimer = null

/**
 * Start the renewal timer, once.
 */
function keepAlive() {
  if (keepAliveTimer) return
  keepAliveTimer = setInterval(() => {
    void refreshAuth().then((result) => {
      if (result && result.ok === false && result.reason && result.reason !== 'fresh') {
        void trace({ phase: 'auth-keepalive', ok: false, reason: result.reason })
      }
    }).catch(() => {})
  }, KEEPALIVE_MS)
  keepAliveTimer.unref?.()
}

/**
 * The plugin entry: mount the routes the popover talks to.
 *
 * @param ctx - the host context; `webServer` is the injected service.
 */
export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      resource: async (request) => {
        const url = new URL(request.url)
        const json = (body, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          })

        if (url.pathname.endsWith('/doctor.json')) {
          const [report, creators] = await Promise.all([diagnose(), creatorStatus()])
          // Answered once per open: record what the token looked like, so a later
          // "why do I have to log in again" has evidence instead of a guess.
          void trace({
            phase: 'auth-state',
            state: report.auth && report.auth.state,
            tokenStatus: report.auth && report.auth.tokenStatus,
            canRefresh: Boolean(report.auth && report.auth.canRefresh),
            probe: lastProbe(),
          })
          if (report.auth && report.auth.available) keepAlive()
          // Why an owner id is shown instead of a name, e.g. a missing scope.
          return json({ ...report, creatorNames: creators.names || 'ok' })
        }

        // The popover reports what a jump did, so a "nothing happened" can be read
        // instead of guessed at. Bounded and local: the file rotates past 512 KiB.
        if (url.pathname.endsWith('/log')) {
          if (request.headers.get('x-feishu-docs') !== 'popover') return json({ error: 'bad request' }, 400)
          const raw = url.searchParams.get('d') || ''
          if (raw) {
            try {
              await trace(JSON.parse(raw))
            } catch (error) {
              /* malformed trace payloads are dropped, not fatal */
            }
          }
          return json({ ok: true })
        }

        // The avatar comes from the local cache, same-origin, so the page policy
        // cannot drop it and the browser can revalidate cheaply.
        if (url.pathname.endsWith('/avatar')) {
          const cached = await cachedAvatar()
          if (!cached.bytes || !cached.bytes.length) return json({ error: 'no avatar' }, 404)
          const tag = `"${cached.at}"`
          if (request.headers.get('if-none-match') === tag) {
            return new Response(null, { status: 304, headers: { etag: tag } })
          }
          return new Response(cached.bytes, {
            status: 200,
            headers: {
              'content-type': cached.contentType || 'image/jpeg',
              'cache-control': 'private, max-age=3600',
              etag: tag,
            },
          })
        }

        // The authorization routes change state. A resource route only ever sees
        // GET and HEAD — every other method is answered 405 with an empty body by
        // the web server, before this function runs — so the calls are GETs with
        // query parameters, and the popover's custom header keeps a foreign page
        // from driving them (it forces a preflight a cross-site request cannot pass).
        if (url.pathname.endsWith('/auth/start') || url.pathname.endsWith('/auth/finish') || url.pathname.endsWith('/auth/logout')) {
          if (request.headers.get('x-feishu-docs') !== 'popover') return json({ error: 'bad request' }, 400)
          const scopes = String(url.searchParams.get('scopes') || '')
            .split(',')
            .map((scope) => scope.trim())
            .filter(Boolean)
          try {
            if (url.pathname.endsWith('/auth/start')) return json(await startLogin(scopes))
            if (url.pathname.endsWith('/auth/logout')) {
              if (keepAliveTimer) {
                clearInterval(keepAliveTimer)
                keepAliveTimer = null
              }
              return json(await logout())
            }
            const finished = await finishLogin(String(url.searchParams.get('device') || ''))
            // A fresh login is a valid token: start keeping it alive right away.
            if (finished && finished.ok) keepAlive()
            return json(finished)
          } catch (error) {
            ctx.logger?.warn?.(`feishu-docs: auth route failed: ${String(error)}`)
            return json({ error: String(error) }, 500)
          }
        }

        if (!url.pathname.endsWith('/session.json')) {
          return json({ error: 'not found' }, 404)
        }

        const sid = url.searchParams.get('sid')
        if (!sid) return json({ error: 'missing sid', docs: [] })

        try {
          // The popover polls this while it is open. Answering "unchanged" from a
          // stat keeps that cheap: a growing log is only parsed when it grew.
          const found = await locate(sid)
          if (!found) return json({ error: 'session log not found', sessionId: sid, docs: [] })
          const known = url.searchParams.get('rev') || ''
          if (known && found.rev && known === found.rev) return json({ unchanged: true, rev: found.rev })

          const result = await readSession(sid)
          if (!result) return json({ error: 'session log not found', sessionId: sid, docs: [] })
          if (result.error) return json(result, 200)
          // The log names no creator; Feishu does. A failed lookup leaves the
          // field empty rather than blocking the list.
          try {
            await enrichCreators(result.docs)
          } catch (error) {
            ctx.logger?.warn?.(`feishu-docs: cannot read creators: ${String(error)}`)
          }
          return json(result)
        } catch (error) {
          ctx.logger?.warn?.(`feishu-docs: cannot read session ${sid}: ${String(error)}`)
          return json({ error: String(error), sessionId: sid, docs: [] })
        }
      },
    }),
  )
}
