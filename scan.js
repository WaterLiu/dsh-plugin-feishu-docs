/**
 * Read the documents out of one Session's own log.
 *
 * Everything the popover shows comes from here, so the bundle needs no index
 * file, no script, and no credentials: install it and it works on whatever
 * Sessions already exist on the machine.
 *
 * A Session's log is `~/.dsh/sessions/<project>/session-<id>/session.v4.jsonl.zstd`.
 * Node 22.15+ can decompress zstd in core; older runtimes fall back to the `zstd`
 * binary when it happens to be installed.
 */
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { execFile } from 'node:child_process'
import zlib from 'node:zlib'

const SESSIONS_ROOT = join(homedir(), '.dsh', 'sessions')

/** Document kinds a Feishu URL can name, and what the UI calls them. */
const KIND_OF = {
  docx: 'docx',
  docs: 'docx',
  sheets: 'sheet',
  base: 'bitable',
  wiki: 'wiki',
  slides: 'slides',
  mindnotes: 'mindnote',
}

/** `https://<host>/<kind>/<token>` — the only links that count as documents. */
const DOC_URL = /https:\/\/[^\s)\]"'<>]*?\/(docx|docs|sheets|base|wiki|slides|mindnotes)\/([A-Za-z0-9]{16,})/g

/** `[title](url)` — the title the message itself gave the link. */
const MD_LINK = /\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)/g

/** Tool calls that create a document rather than merely mention one. */
const CREATE_SIG = /workbook-create|workbook-import|\bdocs \+create|\bdrive \+import|\bbase \+app-create|\bslides \+create/

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Offset of the next zstd frame header at or after `from`, or -1. */
function nextFrame(buffer, from) {
  return buffer.indexOf(ZSTD_MAGIC, from)
}

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
  let pos = nextFrame(buffer, 0)
  while (pos >= 0 && pos < buffer.length) {
    try {
      parts.push(zlib.zstdDecompressSync(buffer.subarray(pos)).toString('utf8'))
    } catch (error) {
      /* not a frame boundary; keep scanning */
    }
    const following = nextFrame(buffer, pos + ZSTD_MAGIC.length)
    if (following < 0) break
    pos = following
  }
  return parts.join('')
}

/** Read the log: core zstd frame-by-frame, else the `zstd` binary. */
async function decompress(path) {
  const buffer = await readFile(path)
  if (typeof zlib.zstdDecompressSync === 'function') {
    return decodeFrames(buffer)
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
  // Callers may pass either `session-<id>` or the bare id.
  const wanted = String(sessionId).replace(/^session-/, '')
  const projects = await readdir(SESSIONS_ROOT, { withFileTypes: true })
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const dir = join(SESSIONS_ROOT, project.name)
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('session-')) continue
      const id = entry.name.slice('session-'.length)
      if (id !== wanted && !id.startsWith(wanted)) continue
      const log = join(dir, entry.name, 'session.v4.jsonl.zstd')
      if (existsSync(log)) return { log, project: project.name, id }
    }
  }
  return null
}

/** Message text of either record shape (`data.message.content` or `data.content`). */
function textOf(data) {
  const message = data && typeof data.message === 'object' && data.message?.content ? data.message : data
  const blocks = message?.content
  if (!Array.isArray(blocks)) return ''
  let out = ''
  for (const block of blocks) {
    if (block && typeof block === 'object' && block.type === 'text') out += block.text || ''
  }
  return out
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

/**
 * Every document one Session's messages mention.
 *
 * Links that appear only inside tool output are ignored: the reader never saw
 * them as a message, so listing them would contradict what is on screen.
 *
 * @param sessionId - full or truncated Session id.
 * @returns `{ sessionId, project, docs }`, or null when the log is absent.
 */
export async function readSession(sessionId) {
  if (!sessionId) return null
  const found = await findLog(String(sessionId))
  if (!found) return null

  let raw
  try {
    raw = await decompress(found.log)
  } catch (error) {
    return { sessionId: found.id, project: basename(found.project), docs: [], error: String(error) }
  }

  const docs = new Map()
  const createdTokens = new Set()
  let currentTurn = 0

  const remember = (kind, token, title, when, turn) => {
    const key = `${kind}/${token}`
    const existing = docs.get(key)
    if (existing) {
      existing.count += 1
      if (!existing.t && title) existing.t = title
      return
    }
    const { d, hm } = stamp(when)
    docs.set(key, {
      t: title || '',
      ty: KIND_OF[kind] || kind,
      u: `https://bytedance.larkoffice.com/${kind}/${token}`,
      turn: turn || 0,
      d,
      hm,
      count: 1,
    })
  }

  for (const line of raw.split('\n')) {
    if (!line) continue
    let record
    try {
      record = JSON.parse(line)
    } catch (error) {
      continue
    }
    const type = record.type
    const data = record.data || {}

    if (type === 'turn/start' && data.turn != null) {
      currentTurn = data.turn
      continue
    }

    if (type === 'tool/call') {
      const args = data.arguments || ''
      if (CREATE_SIG.test(args)) {
        for (const match of String(args).matchAll(DOC_URL)) createdTokens.add(match[2])
      }
      continue
    }

    if (type !== 'user/message' && type !== 'assistant/message') continue

    const text = textOf(data)
    if (!text) continue
    const turn = data.turn ?? currentTurn
    const when = record.time

    // Titles come from the message's own Markdown labels.
    const titled = new Map()
    for (const match of text.matchAll(MD_LINK)) {
      const url = match[2]
      const doc = [...url.matchAll(DOC_URL)].pop()
      if (doc) titled.set(doc[2], match[1].trim())
    }

    for (const match of text.matchAll(DOC_URL)) {
      remember(match[1], match[2], titled.get(match[2]), when, turn)
    }
  }

  const list = [...docs.values()].map((doc) => {
    const token = doc.u.split('/').pop()
    return {
      ...doc,
      t: doc.t || token,
      new: createdTokens.has(token),
      by: '',
      mid: '',
      cid: '',
    }
  })
  list.sort((a, b) => (a.turn || 0) - (b.turn || 0))

  return { sessionId: found.id, project: basename(found.project), docs: list }
}

/** Whether this runtime can decompress a Session log at all. */
export function canRead() {
  return typeof zlib.zstdDecompressSync === 'function' || Boolean(process.env.PATH)
}
