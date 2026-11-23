/**
 * Read the documents out of one Session's own log.
 *
 * Everything the popover shows comes from here, so the bundle needs no index
 * file, no script, and no credentials: install it and it works on whatever
 * Sessions already exist on the machine. Nothing leaves the machine — this file
 * opens one log, decompresses it, and matches links in message text.
 *
 * A Session's log is `~/.dsh/sessions/<project>/session-<id>/session.v4.jsonl.zstd`.
 * Node 22.15+ can decompress zstd in core; older runtimes fall back to the `zstd`
 * binary when it happens to be installed.
 */
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { execFile } from 'node:child_process'
import zlib from 'node:zlib'

const SESSIONS_ROOT = join(homedir(), '.dsh', 'sessions')
const LOG_NAME = 'session.v4.jsonl.zstd'

/** `https://<tenant>/<kind>/<token>` — the only links that count as documents. */
const DOC_URL = /https:\/\/[^\s)\]"'<>]*?\/(docx|docs|sheets|base|wiki|slides|mindnotes)\/([A-Za-z0-9]{16,})/g

/** URL segment → the kind the popover draws an icon for. */
const KIND = { docx: 'docx', docs: 'docx', sheets: 'sheet', base: 'bitable', wiki: 'wiki', slides: 'slides', mindnotes: 'mindnote' }

/** `[label](url)` — a title the message gave the link itself. */
const MD_LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g

/** Tool calls that create a document rather than merely mention one. */
const CREATE = /workbook-create|workbook-import|\bdocs \+create|\bdrive \+import|\bbase \+app-create|\bslides \+create/

/* ------------------------------------------------------------------ titles */

/** Drop the markup a line may wrap a link in, and its block marker. */
function strip(text) {
  return text
    .replace(MD_LINK, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[[^\]]*\]\(?/g, ' ') // half a Markdown link, cut by the URL slice
    .replace(/^\s*(?:#{1,6}\s*|>+\s*|[-*+•]\s+|\d+[.)、]\s*)+/, '')
    .replace(/[*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|,，、:：—–\-()]+|[\s|,，、:：—–\-()]+$/g, '')
    .trim()
}

/**
 * Whether a candidate reads like a title rather than a token, a URL, or prose.
 *
 * @param candidate - raw text.
 * @param max - length ceiling: a declared `[label](url)` may be longer than a
 *   title guessed from the surrounding line.
 */
function plausible(candidate, max = 60) {
  const t = String(candidate ?? '').trim()
  return t.length > 1
    && t.length <= max
    && /\p{L}|\p{N}/u.test(t) // "## 🔗", "→", " — " carry no letter and are never titles
    && t.split(/\s+/).length <= 16 // a whole paragraph is not a title
    && !/[。！？；]/.test(t) // a sentence is not a title
    && !/^https?:/i.test(t)
    && !/^(?:wiki|docx|docs|sheets?|base|slides|mindnotes)\//i.test(t)
    && !/(?:\.\.\.|…)$/.test(t)
    && !/^[A-Za-z0-9_-]{16,}$/.test(t)
}

/**
 * The text that names a document on its line.
 *
 * Whatever sits beside the link — `1. 文档名 — https://…`, `- 文档名: https://…`,
 * `文档名 https://…`, or a table row whose title lives in another cell — after
 * dropping the link itself and its markup. Prose on either side is not a title.
 *
 * @param line - the whole line.
 * @param url - the document URL on that line.
 * @returns a title, or '' when the line names nothing usable.
 */
function titleOfLine(line, url) {
  const at = line.indexOf(url)
  if (at < 0) return ''
  const before = bestCell(line.slice(0, at))
  const after = bestCell(line.slice(at + url.length))
  // A link with prose on both sides is a sentence about a document, not a label
  // for it: "…即便出现了 <url> 这个链接" must not become the title.
  if (before.length > 12 && after.length > 12) return ''
  for (const candidate of [before, after]) if (plausible(candidate)) return candidate
  return ''
}

/** The longest cell of one side of a line, with table pipes honoured. */
function bestCell(side) {
  const cells = side.split('|').map(strip).filter(Boolean)
  return cells.sort((a, b) => b.length - a.length)[0] || ''
}

/** Token of a document URL, or '' when the URL names no document. */
function tokenOf(url) {
  const found = [...String(url).matchAll(DOC_URL)].pop()
  return found ? found[2] : ''
}

/** Every document link in one message, each with the best title its line offers. */
function docsInText(text) {
  const hits = []
  for (const line of text.split('\n')) {
    const urls = [...line.matchAll(DOC_URL)]
    if (!urls.length) continue

    // `[label](url)` on this line, by token, so a bare URL beside it can still
    // borrow the label the message gave.
    const labels = new Map()
    for (const link of line.matchAll(MD_LINK)) {
      const token = tokenOf(link[2])
      if (token) labels.set(token, link[1].trim())
    }
    for (const found of urls) {
      const label = labels.get(found[2])
      const title = plausible(label, 160) ? label.trim() : titleOfLine(line, found[0])
      hits.push({ kind: found[1], token: found[2], url: found[0], title })
    }
  }
  return hits
}

/* -------------------------------------------------------------------- log IO */

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Decompress a Session log.
 *
 * The log is a *concatenation* of zstd frames — one per write — and Node's
 * decompressor stops after the first. So every frame header is decoded on its
 * own and the pieces are joined: each byte is decoded once, and a header pattern
 * that happens to occur inside compressed data simply fails and is skipped.
 */
function decodeFrames(buffer) {
  const parts = []
  for (let at = buffer.indexOf(ZSTD_MAGIC); at >= 0; at = buffer.indexOf(ZSTD_MAGIC, at + ZSTD_MAGIC.length)) {
    try {
      parts.push(zlib.zstdDecompressSync(buffer.subarray(at)).toString('utf8'))
    } catch (error) {
      /* not a frame boundary; keep scanning */
    }
  }
  return parts.join('')
}

/** Read the log: core zstd frame-by-frame, else the `zstd` binary. */
async function decompress(path) {
  if (typeof zlib.zstdDecompressSync === 'function') {
    return decodeFrames(await readFile(path))
  }
  return new Promise((resolve, reject) => {
    execFile('zstd', ['-dc', path], { maxBuffer: 512 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/** Find the log of one Session by id, tolerating a truncated id. */
async function findLog(sessionId) {
  if (!existsSync(SESSIONS_ROOT)) return null
  const wanted = `session-${String(sessionId).replace(/^session-/, '')}`
  for (const project of await readdir(SESSIONS_ROOT, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    let entries
    try {
      entries = await readdir(join(SESSIONS_ROOT, project.name), { withFileTypes: true })
    } catch (error) {
      continue
    }
    const hit = entries.find((entry) => entry.isDirectory() && entry.name.startsWith(wanted))
    if (!hit) continue
    const log = join(SESSIONS_ROOT, project.name, hit.name, LOG_NAME)
    if (existsSync(log)) return { log, project: project.name, id: hit.name.slice('session-'.length) }
  }
  return null
}

/** Message text of either record shape (`data.message.content` or `data.content`). */
function textOf(data) {
  const blocks = data?.message?.content ?? data?.content
  if (!Array.isArray(blocks)) return ''
  return blocks.filter((block) => block && block.type === 'text').map((block) => block.text || '').join('')
}

/** `YYYY-MM-DD` and `HH:mm` in the reader's zone. */
function stamp(ms) {
  if (!ms) return { d: '', hm: '' }
  const date = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return {
    d: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    hm: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

/* ------------------------------------------------------------------ the scan */

/**
 * Every document one Session's messages mention.
 *
 * Links that appear only inside tool output are ignored: the reader never saw
 * them as a message, so listing them would contradict what is on screen. The
 * exception is a create call, which marks the result as produced by DSH.
 *
 * @param sessionId - full or truncated Session id.
 * @returns `{ sessionId, project, docs }`, or null when the log is absent.
 */
export async function readSession(sessionId) {
  if (!sessionId) return null
  const found = await findLog(sessionId)
  if (!found) return null

  let raw
  try {
    raw = await decompress(found.log)
  } catch (error) {
    return { sessionId: found.id, project: basename(found.project), docs: [], error: String(error) }
  }

  const docs = new Map()
  const created = new Set()
  let turn = 0

  for (const line of raw.split('\n')) {
    if (!line) continue
    let record
    try {
      record = JSON.parse(line)
    } catch (error) {
      continue
    }
    const data = record.data || {}

    if (record.type === 'turn/start') {
      if (data.turn != null) turn = data.turn
      continue
    }

    if (record.type === 'tool/call') {
      const args = String(data.arguments || '')
      if (CREATE.test(args)) for (const hit of args.matchAll(DOC_URL)) created.add(hit[2])
      continue
    }

    if (record.type !== 'user/message' && record.type !== 'assistant/message') continue
    const text = textOf(data)
    if (!text) continue

    const atTurn = data.turn ?? turn
    for (const hit of docsInText(text)) {
      const key = `${hit.kind}/${hit.token}`
      const seen = docs.get(key)
      if (seen) {
        seen.count += 1
        if (!seen.t && hit.title) seen.t = hit.title
        continue
      }
      docs.set(key, {
        t: hit.title,
        ty: KIND[hit.kind] || hit.kind,
        // Keep the URL the message used: tenants differ, so it must not be rebuilt.
        u: hit.url,
        turn: atTurn || 0,
        ...stamp(record.time),
        count: 1,
      })
    }
  }

  const list = [...docs.values()].map((doc) => {
    const token = doc.u.split('/').pop()
    return {
      ...doc,
      t: doc.t || token, // a doc the text never named shows its token, not an empty row
      new: created.has(token),
      by: '', // creator needs a Feishu lookup; the plugin stays offline
      mid: '',
      cid: '',
    }
  })
  list.sort((a, b) => (a.turn || 0) - (b.turn || 0))

  return { sessionId: found.id, project: basename(found.project), docs: list }
}
