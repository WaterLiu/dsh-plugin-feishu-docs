/**
 * Fill in what only Feishu knows about each document: its creator, and whether
 * the document still exists.
 *
 * The Session log has the links but no owner and no liveness, so this module
 * asks through `lark-cli` — the CLI that already holds the signed-in user's
 * credentials. Nothing is invented: the creator is the name Feishu returns, or
 * the owner id as returned, or nothing; a document is marked deleted only when
 * Feishu answers "not exist", never when it answers "permission denied".
 *
 * Cost is bounded: one batch metadata call per Session, one node call per wiki
 * document, one `+inspect` probe only for documents the metadata call did not
 * account for, one name lookup per distinct person. Answers are cached in
 * `~/.dsh/feishu-docs-owners.json` and re-asked at most every {@link TTL}, so a
 * deleted-then-restored document corrects itself.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const CACHE = join(homedir(), '.dsh', 'feishu-docs-owners.json')

/** How long one document's answer is trusted before Feishu is asked again. */
const TTL = 6 * 60 * 60 * 1000

/** The document type the metadata API expects for each kind the popover knows. */
const META_TYPE = { docx: 'docx', sheet: 'sheet', bitable: 'bitable', slides: 'slides', mindnote: 'mindnote', file: 'file' }

/** Feishu's answers for "this document is gone", as opposed to "you may not see it". */
const GONE = /not exist|not found|no such|不存在|已删除|已被删除|deleted/i

/** Resolved once: where `lark-cli` lives on this machine, or '' when absent. */
let cliPath

/**
 * Locate `lark-cli`.
 *
 * The plain shell runs first so an ordinary `PATH` decides; the login shell is
 * the fallback for a GUI process, whose `PATH` usually omits `~/.local/bin`.
 */
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

/** Run one `lark-cli` call and return its parsed envelope, or null. */
async function invoke(args, timeout) {
  const bin = await findCli()
  if (!bin) return null
  const stdout = await new Promise((done) => {
    execFile(bin, args, {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
    }, (error, out) => done(String(out || '')))
  })
  try {
    return JSON.parse(stdout)
  } catch (error) {
    return null
  }
}

/** The `data` of a successful call, else null. */
async function data(args, timeout = 8000) {
  const parsed = await invoke(args, timeout)
  return parsed && parsed.ok ? parsed.data : null
}

/** Token of a document URL — the last path segment. */
function tokenOf(doc) {
  return String(doc.u || '').split('/').pop()
}

/** Run `task` over `items`, never more than `limit` at a time. */
async function mapLimit(items, limit, task) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) await task(items[cursor++])
  })
  await Promise.all(workers)
}

async function loadCache() {
  try {
    const cache = JSON.parse(await readFile(CACHE, 'utf8'))
    return { tokens: cache.tokens || {}, names: cache.names || {} }
  } catch (error) {
    return { tokens: {}, names: {} }
  }
}

async function saveCache(cache) {
  try {
    await mkdir(dirname(CACHE), { recursive: true })
    await writeFile(CACHE, JSON.stringify(cache, null, 1))
  } catch (error) {
    /* the cache is an optimisation: failing to write it costs one lookup */
  }
}

/**
 * Ask Feishu about the documents nobody has asked about yet.
 *
 * @returns `{ owners, known }` — owner ids by token, and the tokens Feishu
 *   accounted for at all. A token missing from `known` is either deleted or
 *   invisible, which the caller distinguishes by probing it.
 */
async function scan(docs) {
  const wiki = docs.filter((doc) => doc.ty === 'wiki')
  const rest = docs.filter((doc) => doc.ty !== 'wiki')
  const owners = new Map()
  const known = new Set()

  if (rest.length) {
    const answer = await data(['api', 'POST', '/open-apis/drive/v1/metas/batch_query', '--as', 'user',
      '--data', JSON.stringify({
        request_docs: rest.map((doc) => ({ doc_token: tokenOf(doc), doc_type: META_TYPE[doc.ty] || 'docx' })),
        with_url: false,
      })], 12000)
    for (const meta of (answer && answer.metas) || []) {
      if (!meta || !meta.doc_token) continue
      known.add(meta.doc_token)
      if (meta.owner_id) owners.set(meta.doc_token, meta.owner_id)
    }
  }

  // A wiki node keeps its owner on the node rather than in the drive metadata.
  await mapLimit(wiki, 3, async (doc) => {
    const answer = await data(['api', 'GET', '/open-apis/wiki/v2/spaces/get_node', '--as', 'user',
      '--params', JSON.stringify({ token: tokenOf(doc) })], 6000)
    if (!answer) return
    known.add(tokenOf(doc))
    const node = answer.node || {}
    const owner = node.owner || node.creator
    if (owner) owners.set(tokenOf(doc), owner)
  })

  return { owners, known }
}

/**
 * Probe one document for existence.
 *
 * @returns `'exists'`, `'deleted'`, or `'unknown'` — permission, scope, network
 *   and credential failures are all "unknown", because none of them mean the
 *   document is gone.
 */
async function checkDocument(url) {
  const parsed = await invoke(['drive', '+inspect', '--as', 'user', '--url', url], 6000)
  if (!parsed) return 'unknown'
  if (parsed.ok) return 'exists'
  const error = parsed.error || {}
  const said = `${error.subtype || ''} ${error.message || ''} ${error.code || ''}`
  return GONE.test(said) ? 'deleted' : 'unknown'
}

/** Display name for an owner id, or '' when Feishu does not give one. */
async function findName(openId) {
  const answer = await data(['contact', '+get-user', '--as', 'user', '--user-id', openId], 5000)
  const user = answer && answer.user
  return (user && (user.name || user.en_name)) || ''
}

/**
 * Set `doc.by` and `doc.deleted` on every document from what Feishu reports.
 *
 * @param docs - entries from `readSession`; mutated in place.
 * @returns the same array.
 */
export async function enrichCreators(docs) {
  if (!Array.isArray(docs) || !docs.length) return docs
  // No CLI on this machine: there is nobody to ask, and nothing worth caching.
  if (!(await findCli())) return docs

  const cache = await loadCache()
  const stale = (row) => !row || !row.checkedAt || Date.now() - row.checkedAt > TTL
  const ask = docs.filter((doc) => {
    const row = cache.tokens[tokenOf(doc)]
    return !(row && row.owner) && stale(row)
  })

  if (ask.length) {
    const { owners, known } = await scan(ask)
    for (const [token, owner] of owners) {
      const row = (cache.tokens[token] = cache.tokens[token] || {})
      row.owner = owner
      row.checkedAt = Date.now()
      delete row.deleted
    }
    for (const token of known) {
      const row = (cache.tokens[token] = cache.tokens[token] || {})
      row.checkedAt = Date.now()
      delete row.deleted
    }
    // Feishu did not account for these: ask each one directly whether it is gone.
    const missing = ask.filter((doc) => !known.has(tokenOf(doc)))
    await mapLimit(missing, 3, async (doc) => {
      const verdict = await checkDocument(doc.u)
      const row = (cache.tokens[tokenOf(doc)] = cache.tokens[tokenOf(doc)] || {})
      if (verdict === 'deleted') row.deleted = true
      else if (verdict === 'exists') delete row.deleted
      // An unanswered probe (permission, network, credentials) keeps the previous
      // verdict and waits out the TTL instead of being retried on every open.
      row.checkedAt = Date.now()
    })
  }

  const owners = [...new Set(Object.values(cache.tokens).map((row) => row && row.owner).filter(Boolean))]
  await mapLimit(owners.filter((owner) => !cache.names[owner]), 3, async (owner) => {
    const name = await findName(owner)
    if (name) cache.names[owner] = name
  })

  for (const doc of docs) {
    const row = cache.tokens[tokenOf(doc)]
    if (!row) continue
    doc.deleted = row.deleted === true
    if (row.owner) doc.by = cache.names[row.owner] || row.owner
  }

  await saveCache(cache)
  return docs
}
