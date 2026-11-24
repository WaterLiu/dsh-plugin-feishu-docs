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
 *
 * @author WaterLiu
 */
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import zlib from 'node:zlib'

const DSH_HOME = join(homedir(), '.dsh')
const SESSIONS_ROOT = join(DSH_HOME, 'sessions')
/** Where our own scan state lives; DSH's sessions are not relocated by it. */
const STATE = process.env.FEISHU_DOCS_STATE_DIR || DSH_HOME
const INDEX_FILE = join(STATE, 'feishu-docs-sessions.json')
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

/** Fenced blocks and inline code: URLs there are text, not links the reader can click. */
const CODE_BLOCK = /```[\s\S]*?```|~~~[\s\S]*?~~~/g
const INLINE_CODE = /`[^`\n]*`/g

/** Every document link in one message, each with the best title its line offers. */
function docsInText(text) {
  const hits = []
  // A URL inside a code fence or backticks is part of a command or a log line —
  // the chat renders it as code, not as a link, so it is not a document the
  // Session "shows". Prose mentions, bare or labelled, still count.
  const prose = String(text).replace(CODE_BLOCK, ' ').replace(INLINE_CODE, ' ')
  for (const line of prose.split('\n')) {
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
  // A frame that does not decode yet is a write in progress: report how far the
  // buffer was consumed so the next scan resumes there instead of skipping it.
  let consumed = buffer.length
  for (let at = buffer.indexOf(ZSTD_MAGIC); at >= 0; at = buffer.indexOf(ZSTD_MAGIC, at + ZSTD_MAGIC.length)) {
    try {
      parts.push(zlib.zstdDecompressSync(buffer.subarray(at)).toString('utf8'))
    } catch (error) {
      consumed = at
      break
    }
  }
  return { text: parts.join(''), consumed }
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
 * Locate a Session's log and describe its current version cheaply.
 *
 * The version is the file's size and modification time, so a caller can ask
 * "anything new?" without decompressing anything: reading the whole log to
 * discover that nothing changed would make polling expensive.
 *
 * @param sessionId - full or truncated Session id.
 * @returns `{ log, project, id, rev }`, or null when the log is absent.
 */
export async function locate(sessionId) {
  if (!sessionId) return null
  const found = await findLog(String(sessionId))
  if (!found) return null
  try {
    const info = await stat(found.log)
    return { ...found, rev: `${Math.round(info.mtimeMs)}:${info.size}`, size: info.size }
  } catch (error) {
    return { ...found, rev: '' }
  }
}

/* ---------------------------------------------------------------- the state */

/**
 * Per-Session scan state.
 *
 * A Session's log is append-only, and a Session is usually opened many times, so
 * the whole log is read once and only the frames appended since are decoded
 * afterwards. The state records how far it got, which is also the marker that the
 * Session has been read end to end (`scannedAt`).
 */
const scans = new Map()
let indexLoaded = false
let saveTimer = null

/** Read the on-disk index once, so a restart resumes instead of rescanning. */
async function loadIndex() {
  if (indexLoaded) return
  indexLoaded = true
  try {
    const stored = JSON.parse(await readFile(INDEX_FILE, 'utf8'))
    for (const [key, value] of Object.entries(stored)) {
      scans.set(key, {
        id: value.id,
        project: value.project,
        offset: value.offset || 0,
        rev: value.rev || '',
        scannedAt: value.scannedAt || 0,
        turn: value.turn || 0,
        docs: new Map((value.docs || []).map((doc) => [doc.k, doc])),
        blocks: new Map(Object.entries(value.blocks || {}).map(([turn, block]) => [Number(turn), block])),
        created: new Set(value.created || []),
      })
    }
  } catch (error) {
    /* first run, or an index we cannot read: everything is rescanned */
  }
}

/** Persist the index, debounced — polling would otherwise rewrite it constantly. */
function queueSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveIndex().catch(() => { /* the index is an optimisation */ })
  }, 300)
}

/**
 * Persist the per-Session scan state so a restart resumes instead of rescanning.
 */
async function saveIndex() {
  const out = {}
  for (const [key, entry] of scans) {
    out[key] = {
      id: entry.id,
      project: entry.project,
      offset: entry.offset,
      rev: entry.rev,
      scannedAt: entry.scannedAt,
      turn: entry.turn,
      docs: [...entry.docs.values()],
      blocks: Object.fromEntries(entry.blocks),
      created: [...entry.created],
    }
  }
  await mkdir(dirname(INDEX_FILE), { recursive: true })
  await writeFile(INDEX_FILE, JSON.stringify(out))
}

/** Read `size - start` bytes from `path`. */
async function readRange(path, start, size) {
  if (start >= size) return Buffer.alloc(0)
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    return buffer
  } finally {
    await handle.close()
  }
}

/** Fold one chunk of decompressed log into the Session's state. */
function applyLines(entry, chunk) {
  for (const line of chunk.split('\n')) {
    if (!line) continue
    let record
    try {
      record = JSON.parse(line)
    } catch (error) {
      continue
    }
    const data = record.data || {}

    if (record.type === 'turn/start') {
      if (data.turn != null) {
        entry.turn = data.turn
        // A turn is one question-and-answer block: `turn/start` … `turn/end`.
        // Recording both seqs gives each block a stable identity that the log and
        // the rendered rows share (`data-chat-turn`).
        entry.blocks.set(entry.turn, { start: record.seq, end: null })
      }
      continue
    }

    if (record.type === 'turn/end') {
      const turn = data.turn ?? entry.turn
      const block = entry.blocks.get(turn)
      if (block) block.end = record.seq
      else entry.blocks.set(turn, { start: null, end: record.seq })
      // Documents first seen in this turn become complete with it.
      for (const doc of entry.docs.values()) {
        if (doc.turn === turn) doc.endSeq = record.seq
      }
      continue
    }

    if (record.type === 'tool/call') {
      const args = String(data.arguments || '')
      if (CREATE.test(args)) for (const hit of args.matchAll(DOC_URL)) entry.created.add(hit[2])
      continue
    }

    if (record.type !== 'user/message' && record.type !== 'assistant/message') continue
    const text = textOf(data)
    if (!text) continue

    const atTurn = data.turn ?? entry.turn
    // The message's own id: the client finds the exact row with it, which `turn`
    // cannot promise once a document is mentioned many times.
    const messageId = (data.message && data.message.id) || ''
    const messageSeq = typeof record.seq === 'number' ? record.seq : null
    for (const hit of docsInText(text)) {
      const key = `${hit.kind}/${hit.token}`
      const seen = entry.docs.get(key)
      if (seen) {
        seen.count += 1
        if (!seen.t && hit.title) seen.t = hit.title
        continue
      }
      const block = entry.blocks.get(atTurn) || null
      entry.docs.set(key, {
        k: key,
        mid: messageId,
        seq: messageSeq,
        // The block this document belongs to: one turn, start..end.
        block: `${entry.id}#${atTurn || 0}`,
        startSeq: block ? block.start : null,
        endSeq: block ? block.end : null,
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
}

/** The shape the popover consumes, derived from the state. */
function payloadOf(entry, cached) {
  const list = [...entry.docs.values()].map((doc) => {
    const { k, ...rest } = doc
    const token = String(doc.u || '').split('/').pop()
    return {
      ...rest,
      t: doc.t || token, // a doc the text never named shows its token, not an empty row
      new: entry.created.has(token),
      by: '', // creator needs a Feishu lookup: see owners.js
      deleted: false, // whether the document still exists: see owners.js
      mid: doc.mid || '', // the first message that showed it
      cid: '',
    }
  })
  list.sort((a, b) => (a.turn || 0) - (b.turn || 0))
  return {
    sessionId: entry.id,
    project: basename(entry.project),
    docs: list,
    rev: entry.rev,
    // The marker: this Session has been read end to end, at this time.
    scanned: entry.offset > 0,
    scannedAt: entry.scannedAt || 0,
    cached,
  }
}

/**
 * Every document one Session's messages mention.
 *
 * Links that appear only inside tool output are ignored: the reader never saw
 * them as a message, nor do links inside code. The first read consumes the whole
 * log; later reads only decode the frames appended since, which is what makes
 * polling every few seconds affordable.
 *
 * @param sessionId - full or truncated Session id.
 * @returns `{ sessionId, project, docs, rev, scanned, scannedAt, cached }`, or
 *   null when the log is absent.
 */
export async function readSession(sessionId) {
  if (!sessionId) return null
  const found = await locate(sessionId)
  if (!found) return null
  await loadIndex()

  const key = `${found.project}/${found.id}`
  let entry = scans.get(key)
  if (!entry) {
    entry = { id: found.id, project: found.project, offset: 0, rev: '', scannedAt: 0, turn: 0, docs: new Map(), blocks: new Map(), created: new Set() }
    scans.set(key, entry)
  }

  const unchanged = Boolean(entry.rev) && entry.rev === found.rev
  if (!unchanged) {
    try {
      let chunk
      let consumed
      if (typeof zlib.zstdDecompressSync === 'function') {
        const start = Math.min(entry.offset || 0, found.size)
        chunk = await readRange(found.log, start, found.size)
        const decoded = decodeFrames(chunk)
        chunk = decoded.text
        consumed = decoded.consumed
        entry.offset = start + consumed
      } else {
        // No core zstd: the binary has no ranges, so this is a full read.
        chunk = await decompress(found.log)
        entry.offset = found.size
      }
      applyLines(entry, chunk)
      entry.rev = found.rev
      entry.scannedAt = Date.now()
      queueSave()
    } catch (error) {
      return { sessionId: entry.id, project: basename(entry.project), docs: [], error: String(error) }
    }
  }

  return payloadOf(entry, unchanged)
}
