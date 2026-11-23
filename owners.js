/**
 * Fill in each document's creator, exactly as Feishu reports it.
 *
 * The creator is the one field the Session log cannot answer: it lives in
 * Feishu, so this module asks through `lark-cli` — the CLI that already holds
 * the signed-in user's credentials. Nothing is invented: the name when Feishu
 * returns one for that owner, otherwise the owner id as returned. No document
 * is relabelled as "你" or "DSH"; if Feishu has no answer, the field stays empty.
 *
 * Cost is bounded: one batch metadata call per Session, one node call per wiki
 * document, one name lookup per distinct person, and both answered-from answers
 * are cached in `~/.dsh/feishu-docs-owners.json`.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const CACHE = join(homedir(), '.dsh', 'feishu-docs-owners.json')

/** The document type the metadata API expects for each kind the popover knows. */
const META_TYPE = { docx: 'docx', sheet: 'sheet', bitable: 'bitable', slides: 'slides', mindnote: 'mindnote', file: 'file' }

/** Resolved once: where `lark-cli` lives on this machine, or '' when absent. */
let cliPath

/**
 * Locate `lark-cli`.
 *
 * The plain shell runs first so an ordinary `PATH` (or a caller that prepends
 * one) decides; the login shell is the fallback for a GUI process, whose
 * `PATH` usually omits `~/.local/bin`.
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

/** Run one `lark-cli` call and return its `data`, or null when it did not answer. */
async function call(args, timeout = 8000) {
  const bin = await findCli()
  if (!bin) return null
  const stdout = await new Promise((done) => {
    execFile(bin, args, {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
    }, (error, out) => done(error ? '' : String(out)))
  })
  try {
    const parsed = JSON.parse(stdout)
    return parsed && parsed.ok ? parsed.data : null
  } catch (error) {
    return null
  }
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

/** Owner ids for the documents nobody has asked about yet. */
async function findOwners(docs) {
  const wiki = docs.filter((doc) => doc.ty === 'wiki')
  const rest = docs.filter((doc) => doc.ty !== 'wiki')
  const owners = new Map()

  if (rest.length) {
    const data = await call(['api', 'POST', '/open-apis/drive/v1/metas/batch_query', '--as', 'user',
      '--data', JSON.stringify({
        request_docs: rest.map((doc) => ({ doc_token: tokenOf(doc), doc_type: META_TYPE[doc.ty] || 'docx' })),
        with_url: false,
      })], 12000)
    for (const meta of (data && data.metas) || []) {
      if (meta && meta.doc_token && meta.owner_id) owners.set(meta.doc_token, meta.owner_id)
    }
  }

  // A wiki node keeps its owner on the node rather than in the drive metadata.
  await mapLimit(wiki, 3, async (doc) => {
    const data = await call(['api', 'GET', '/open-apis/wiki/v2/spaces/get_node', '--as', 'user',
      '--params', JSON.stringify({ token: tokenOf(doc) })], 6000)
    const node = data && data.node
    const owner = (node && (node.owner || node.creator)) || ''
    if (owner) owners.set(tokenOf(doc), owner)
  })

  return owners
}

/** Display name for an owner id, or '' when Feishu does not give one. */
async function findName(openId) {
  const data = await call(['contact', '+get-user', '--as', 'user', '--user-id', openId], 5000)
  const user = data && data.user
  return (user && (user.name || user.en_name)) || ''
}

/**
 * Set `doc.by` on every document from what Feishu reports.
 *
 * @param docs - entries from `readSession`; mutated in place.
 * @returns the same array.
 */
export async function enrichCreators(docs) {
  if (!Array.isArray(docs) || !docs.length) return docs

  const cache = await loadCache()
  const unknown = docs.filter((doc) => !(cache.tokens[tokenOf(doc)] || {}).owner)
  if (unknown.length) {
    for (const [token, owner] of await findOwners(unknown)) {
      if (!cache.tokens[token]) cache.tokens[token] = {}
      cache.tokens[token].owner = owner
    }
  }

  const owners = [...new Set(Object.values(cache.tokens).map((row) => row && row.owner).filter(Boolean))]
  await mapLimit(owners.filter((owner) => !cache.names[owner]), 3, async (owner) => {
    const name = await findName(owner)
    if (name) cache.names[owner] = name
  })

  for (const doc of docs) {
    const row = cache.tokens[tokenOf(doc)]
    if (!row || !row.owner) continue
    doc.by = cache.names[row.owner] || row.owner
  }

  await saveCache(cache)
  return docs
}
