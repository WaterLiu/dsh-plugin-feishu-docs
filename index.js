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
 *   POST /x-feishu-docs/auth/start            begin a device-code login;
 *   POST /x-feishu-docs/auth/finish           complete it;
 *   POST /x-feishu-docs/auth/logout           sign out.
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

        // The authorization routes change state, so they only accept a POST that
        // the popover itself made: the custom header forces a preflight, which a
        // foreign page cannot satisfy.
        if (url.pathname.endsWith('/auth/start') || url.pathname.endsWith('/auth/finish') || url.pathname.endsWith('/auth/logout')) {
          if (request.method !== 'POST') return json({ error: 'POST only' }, 405)
          if (request.headers.get('x-feishu-docs') !== 'popover') return json({ error: 'bad request' }, 400)
          let body = {}
          try {
            body = await request.json()
          } catch (error) {
            return json({ error: 'invalid JSON body' }, 400)
          }
          try {
            if (url.pathname.endsWith('/auth/start')) return json(await startLogin(body.scopes))
            if (url.pathname.endsWith('/auth/logout')) return json(await logout())
            return json(await finishLogin(body.deviceCode))
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
