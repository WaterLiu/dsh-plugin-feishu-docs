/**
 * The one place this plugin talks to `lark-cli`.
 *
 * Two details are easy to get wrong and both are handled here:
 *
 * - The CLI prints its JSON envelope on stdout when it succeeds and on **stderr**
 *   when it fails, with a non-zero exit code either way. Reading only stdout
 *   turns every failure into "no answer", which silently disables whatever
 *   depended on the answer — a deletion check that can never fire, for instance.
 * - A GUI-launched host usually has no `~/.local/bin` on its `PATH`, so the
 *   binary is looked up through a plain shell first and the login shell second.
 */
import { execFile } from 'node:child_process'

/** Resolved once: where `lark-cli` lives on this machine, or '' when absent. */
let cliPath

/** Locate `lark-cli`, plain shell first, login shell second. */
function findCli() {
  if (cliPath !== undefined) return Promise.resolve(cliPath)
  const probe = (flag) => new Promise((done) => {
    execFile('sh', [flag, 'command -v lark-cli'], (error, stdout) => {
      done(!error && String(stdout).trim() ? String(stdout).trim() : '')
    })
  })
  return probe('-c')
    .then((found) => found || probe('-lc'))
    .then((found) => {
      cliPath = found
      return found
    })
}

/** Where `lark-cli` was found, or '' when this machine has none. */
export function larkCli() {
  return findCli()
}

/**
 * The JSON envelope in one stream, if there is one.
 *
 * A failing run may print warnings before the envelope, so the last parseable
 * object wins: every `{` is tried from the end backwards, and the outer object
 * of a pretty-printed envelope is the one that parses cleanly.
 *
 * @param text - raw stdout or stderr.
 * @returns the parsed envelope, or null.
 */
export function envelope(text) {
  const raw = String(text || '')
  const starts = []
  for (let at = raw.indexOf('{'); at >= 0; at = raw.indexOf('{', at + 1)) starts.push(at)
  for (const at of starts.reverse()) {
    try {
      return JSON.parse(raw.slice(at))
    } catch (error) {
      /* an inner brace, keep looking outward */
    }
  }
  return null
}

/**
 * Run one `lark-cli` call.
 *
 * @param args - subcommand and flags.
 * @param timeout - milliseconds before the process is killed.
 * @returns `{ code, envelope, text }` — `code` is the exit status, `envelope`
 *   the JSON it printed on either stream, `text` whatever it printed.
 */
export async function run(args, timeout = 15000) {
  const bin = await findCli()
  if (!bin) return { code: -1, envelope: null, text: '' }
  const [code, stdout, stderr] = await new Promise((done) => {
    execFile(bin, args, {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
    }, (error, out, err) => {
      const status = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      done([status, String(out || ''), String(err || '')])
    })
  })
  return {
    code,
    envelope: envelope(stdout) || envelope(stderr),
    text: `${stdout}\n${stderr}`.trim(),
  }
}

/**
 * Run one `lark-cli` call and return its envelope from either stream.
 *
 * @param args - subcommand and flags.
 * @param timeout - milliseconds before the process is killed.
 * @returns the envelope, or null when the CLI printed none.
 */
export async function invoke(args, timeout = 15000) {
  const result = await run(args, timeout)
  return result.envelope
}

/** The `data` of a successful call, else null. */
export async function invokeData(args, timeout = 15000) {
  const parsed = await invoke(args, timeout)
  return parsed && parsed.ok ? parsed.data : null
}

/** Why a call failed, in one line, for a cache entry or for doctor.json. */
export function why(parsed) {
  const error = (parsed && parsed.error) || {}
  if (!error.message && !error.subtype) return ''
  return `${error.subtype || error.type || 'error'}: ${String(error.message || '').slice(0, 200)}`
}
