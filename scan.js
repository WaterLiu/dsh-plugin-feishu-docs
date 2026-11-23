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
import { readFile, readdir, writeFile } from 'node:fs/promises'
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

/**
 * A title written next to a bare URL, as pasted lists usually do:
 * `1. 文档名 — https://…`, `- 文档名: https://…`, `文档名 https://…`.
 */
/** Whether a candidate is a usable title rather than a truncated reference. */
function validTitle(text) {
  const t = String(text || '').trim()
  if (t.length < 2 || t.length > 160) return false
  if (/^(?:wiki|docx|docs|sheets?|base|slides|mindnotes)\//i.test(t)) return false
  if (/(?:\.\.\.|…)$/.test(t)) return false
  if (/^https?:/i.test(t)) return false
  if (/^[A-Za-z0-9_-]{16,}$/.test(t)) return false
  return true
}

function titleFromLine(line, url) {
  // Table rows put the title and the link in different cells: drop the links
  // first, then keep the most descriptive remaining cell.
  const withoutLinks = line.replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
  const cut = withoutLinks.replace(url, ' ')
  const cleaned = cut
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '')
    .replace(/^(?:DOCX|WIKI|SHEETS?|BASE|SLIDES|MINDNOTES)\s+/i, '')
    .replace(/\s*\|\s*$/, '')
    .replace(/[\s—–\-:：|,，、]+$/, '')
    .replace(/^[\s—–\-:：|,，、]+/, '')
    .replace(/[（(]\s*(?:wiki|docx|docs|sheet|sheets|base|slides)\s*[)）]/gi, '')
    .trim()

  let best = cleaned
  if (cleaned.includes('|')) {
    const cells = cleaned.split('|').map((cell) => cell.trim()).filter(Boolean)
    best = cells.sort((a, b) => b.length - a.length)[0] || ''
  }
  best = best.replace(/^\s*\|+\s*|\s*\|+\s*$/g, '').trim()

  if (best.length < 2 || best.length > 160) return ''
  // A whole paragraph is not a title.
  if (best.split(/\s+/).length > 16) return ''
  return best
}

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

  const remember = (kind, token, title, when, turn, url) => {
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
      // Keep the URL the message used: tenants differ, so it must not be rebuilt.
      u: url || '',
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

    // Bare URLs take their title from the line they sit on.
    const lines = text.split('\n')
    const lineTitle = new Map()
    for (const line of lines) {
      const urls = [...line.matchAll(DOC_URL)]
      if (!urls.length) continue
      for (const found of urls) {
        if (lineTitle.has(found[2])) continue
        const guess = titleFromLine(line, found[0])
        if (guess) lineTitle.set(found[2], guess)
      }
    }

    for (const match of text.matchAll(DOC_URL)) {
      const label = titled.get(match[2])
      const fallback = lineTitle.get(match[2])
      const title = validTitle(label) ? label : validTitle(fallback) ? fallback : ''
      remember(match[1], match[2], title, when, turn, match[0])
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

const TITLE_CACHE = join(homedir(), '.dsh', 'feishu-docs-titles.json')
const OWNER_CACHE = join(homedir(), '.dsh', 'feishu-docs-owners.json')

/** The document kind as the drive meta API names it. */
const META_TYPE = { docx: 'docx', sheet: 'sheet', bitable: 'bitable', slides: 'slides', wiki: 'wiki', mindnote: 'mindnote' }

/** Titles resolved from Feishu, so a token is only ever shown once. */
async function loadTitleCache() {
  try {
    return JSON.parse(await readFile(TITLE_CACHE, 'utf8'))
  } catch (error) {
    return {}
  }
}

async function saveTitleCache(cache) {
  try {
    await writeFile(TITLE_CACHE, JSON.stringify(cache, null, 1))
  } catch (error) {
    /* a cache that cannot be written only costs one extra lookup */
  }
}

/** Ask the CLI for one document's real title. */
function fetchTitle(url) {
  return new Promise((done) => {
    execFile('lark-cli', ['drive', '+inspect', '--as', 'user', '--url', url],
      { timeout: 4000, env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1' } },
      (error, stdout) => {
        if (error) return done(null)
        try {
          const title = (JSON.parse(stdout).data || {}).title
          done(title && String(title).trim() ? String(title).trim() : null)
        } catch (parseError) {
          done(null)
        }
      })
  })
}

/**
 * Replace guessed titles with the documents' real ones.
 *
 * The heuristic in this file reads the title out of the message text, which is
 * usually right and costs nothing. When it is not — a bare URL, a truncated
 * label — the authoritative title comes from Feishu, once, through the CLI, and
 * is cached for every later open.
 *
 * @param entries - documents from {@link readSession}; mutated in place.
 * @returns the same array.
 */
export async function enrichTitles(entries) {
  const needs = entries.filter((doc) => !validTitle(doc.t) || doc.t === doc.u.split('/').pop())
  if (!needs.length) return entries

  const cache = await loadTitleCache()
  const pending = []
  for (const doc of needs) {
    const token = doc.u.split('/').pop()
    if (cache[token]) {
      doc.t = cache[token]
      continue
    }
    pending.push(doc)
  }
  if (!pending.length) return entries

  const resolved = await Promise.all(pending.map(async (doc) => {
    const title = await fetchTitle(doc.u)
    if (!title) return false
    doc.t = title
    cache[doc.u.split('/').pop()] = title
    return true
  }))
  if (resolved.some(Boolean)) await saveTitleCache(cache)
  return entries
}

/** Run `task` over `items`, never more than `limit` at a time. */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** Run the CLI with JSON output; resolves null instead of throwing. */
function cli(args, timeout = 5000) {
  return new Promise((done) => {
    execFile('lark-cli', args,
      { timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } },
      (error, stdout) => {
        if (error) return done(null)
        try {
          const parsed = JSON.parse(stdout)
          done(parsed && parsed.ok ? parsed.data : null)
        } catch (parseError) {
          done(null)
        }
      })
  })
}

/** The signed-in person, so their own documents read as a name rather than "他人". */
let selfOpenIdPromise = null
function selfOpenId() {
  if (!selfOpenIdPromise) {
    selfOpenIdPromise = cli(['api', 'GET', '/open-apis/authen/v1/user_info', '--as', 'user'])
      .then((data) => (data && data.open_id) || '')
      .catch(() => '')
  }
  return selfOpenIdPromise
}

/**
 * Fill in each document's creator.
 *
 * Owners come from one batch meta query for the whole list; names from the
 * contact API, one call per distinct person, both cached by token/person so a
 * Session opened twice costs a single read.
 *
 * @param entries - documents from {@link readSession}; `by` is set in place.
 * @returns the same array.
 */
export async function enrichOwners(entries) {
  const needs = entries.filter((doc) => !doc.by)
  if (!needs.length) return entries

  let cache
  try {
    cache = JSON.parse(await readFile(OWNER_CACHE, 'utf8'))
  } catch (error) {
    cache = {}
  }

  const unresolved = needs.filter((doc) => !(cache[doc.u.split('/').pop()] || {}).owner)
  const wiki = unresolved.filter((doc) => doc.ty === 'wiki')
  const other = unresolved.filter((doc) => doc.ty !== 'wiki')

  if (other.length) {
    const request = other.map((doc) => ({
      doc_token: doc.u.split('/').pop(),
      doc_type: META_TYPE[doc.ty] || 'docx',
    }))
    const meta = await cli(['api', 'POST', '/open-apis/drive/v1/metas/batch_query', '--as', 'user',
      '--data', JSON.stringify({ request_docs: request, with_url: false })], 12000)
    for (const item of (meta && meta.metas) || []) {
      // Cache only real answers: an empty row would suppress every later retry.
      if (item.doc_token && item.owner_id) cache[item.doc_token] = { owner: item.owner_id }
    }
  }

  // A wiki node keeps its owner on the node, not in the drive meta answer.
  // Feishu rate-limits a burst of CLI calls, so these run a few at a time.
  await mapLimit(wiki, 3, async (doc) => {
    const token = doc.u.split('/').pop()
    const node = await cli(['api', 'GET', '/open-apis/wiki/v2/spaces/get_node', '--as', 'user',
      '--params', JSON.stringify({ token })], 6000)
    const owner = (node && node.node && (node.node.owner || node.node.creator)) || ''
    if (owner) cache[token] = { owner }
  })

  // Names, one lookup per distinct owner.
  const self = await selfOpenId()
  const owners = [...new Set(Object.values(cache).map((row) => row && row.owner).filter(Boolean))]
  const named = new Map()
  await mapLimit(owners, 3, async (owner) => {
    const known = Object.values(cache).find((row) => row && row.owner === owner && row.name)
    if (known) return named.set(owner, known.name)
    const data = await cli(['contact', '+get-user', '--as', 'user', '--user-id', owner], 4000)
    const name = (data && data.user && data.user.name) || ''
    if (!name) return
    named.set(owner, name)
    for (const row of Object.values(cache)) {
      if (row && row.owner === owner) row.name = name
    }
  })

  for (const doc of entries) {
    const token = doc.u.split('/').pop()
    const row = cache[token]
    if (doc.new) {
      doc.by = 'DSH'
      continue
    }
    if (!row || !row.owner) continue
    if (row.owner === self) doc.by = row.name || '你'
    else doc.by = row.name || named.get(row.owner) || ''
  }

  try {
    await writeFile(OWNER_CACHE, JSON.stringify(cache, null, 1))
  } catch (error) {
    /* the cache is an optimisation only */
  }
  return entries
}

/** Whether this runtime can decompress a Session log at all. */
export function canRead() {
  return typeof zlib.zstdDecompressSync === 'function' || Boolean(process.env.PATH)
}
