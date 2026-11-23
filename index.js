/**
 * Host half of the Feishu documents chip.
 *
 * Answers one question per Session — "which Feishu documents do its messages
 * show?" — by reading that Session's own log. Nothing is precomputed, nothing is
 * configured: installing the bundle is the whole setup.
 *
 * Routes:
 *   GET /x-feishu-docs/session.json?sid=<id>  the documents of one Session;
 *   GET /x-feishu-docs/doctor.json            whether this runtime can read logs.
 */
import { execFile } from 'node:child_process'
import zlib from 'node:zlib'
import { readSession } from './scan.js'
import { creatorStatus, enrichCreators, larkCli } from './owners.js'

/** The web server owns the route table. */
export const inject = ['webServer']

const ROUTE = '/x-feishu-docs'

/** `command -v` for one executable, through the login shell so PATH matches. */
function which(cmd) {
  return new Promise((done) => {
    execFile('sh', ['-lc', `command -v ${cmd}`], (error, stdout) => {
      done(!error && String(stdout).trim() ? String(stdout).trim() : null)
    })
  })
}

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
          const [fallbackCli, lark, creators] = await Promise.all([which('zstd'), larkCli(), creatorStatus()])
          return json({
            checkedAt: new Date().toISOString(),
            zstd: typeof zlib.zstdDecompressSync === 'function' ? 'core' : fallbackCli ? 'cli' : null,
            zstdPath: fallbackCli,
            // Creators can only be filled in when this is not null.
            larkCli: lark || null,
            // Why an owner id is shown instead of a name, e.g. a missing scope.
            creatorNames: creators.names || 'ok',
            node: process.version,
          })
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
