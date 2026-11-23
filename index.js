/**
 * Host half of the Feishu documents chip.
 *
 * Answers one question per Session — "which Feishu documents do its messages
 * show?" — by reading that Session's own log, then asks Feishu (through
 * `lark-cli`) for what the log cannot know: the real title, the creator, and
 * whether the document still exists.
 *
 * Routes:
 *   GET  /x-feishu-docs/session.json?sid=<id>  the documents of one Session;
 *   GET  /x-feishu-docs/doctor.json           what this machine still needs;
 *   GET  /x-feishu-docs/avatar?u=<url>        the signed-in user's avatar, proxied;
 *   GET  /x-feishu-docs/auth/start?scopes=<csv>   begin a device-code login;
 *   GET  /x-feishu-docs/auth/finish?device=<code> complete it;
 *   GET  /x-feishu-docs/auth/logout               sign out.
 */
import { readSession } from './scan.js'
import { creatorStatus, enrichCreators } from './owners.js'
import { diagnose, finishLogin, logout, startLogin } from './setup.js'

/** The web server owns the route table. */
export const inject = ['webServer']

const ROUTE = '/x-feishu-docs'

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
          // Why an owner id is shown instead of a name, e.g. a missing scope.
          return json({ ...report, creatorNames: creators.names || 'ok' })
        }

        // Feishu hosts avatars on its own CDN. Serving it from here keeps the
        // image same-origin, so a page policy cannot drop it, and the allowlist
        // keeps this from becoming an open proxy.
        if (url.pathname.endsWith('/avatar')) {
          let target = null
          try {
            target = new URL(String(url.searchParams.get('u') || ''))
          } catch (error) {
            return json({ error: 'bad url' }, 400)
          }
          if (!/(^|\.)(feishu\.cn|feishucdn\.com|larksuite\.com|larksuitecdn\.com|larkoffice\.com)$/i.test(target.hostname)) {
            return json({ error: 'host not allowed' }, 400)
          }
          try {
            const upstream = await fetch(target, { redirect: 'follow' })
            if (!upstream.ok) return json({ error: `upstream ${upstream.status}` }, 502)
            const type = upstream.headers.get('content-type') || ''
            if (!type.startsWith('image/')) return json({ error: 'not an image' }, 415)
            return new Response(upstream.body, {
              status: 200,
              headers: { 'content-type': type, 'cache-control': 'private, max-age=600' },
            })
          } catch (error) {
            return json({ error: String(error) }, 502)
          }
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
            if (url.pathname.endsWith('/auth/logout')) return json(await logout())
            return json(await finishLogin(String(url.searchParams.get('device') || '')))
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
