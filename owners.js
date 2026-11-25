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
 *
 * @author WaterLiu
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { invoke, invokeData, larkCli, why } from './cli.js'

const STATE = process.env.FEISHU_DOCS_STATE_DIR || join(homedir(), '.dsh')
const CACHE = join(STATE, 'feishu-docs-owners.json')

/** How long one document's answer is trusted before Feishu is asked again. */
const TTL = 6 * 60 * 60 * 1000

/** The document type the metadata API expects for each kind the popover knows. */
const META_TYPE = { docx: 'docx', sheet: 'sheet', bitable: 'bitable', slides: 'slides', mindnote: 'mindnote', file: 'file' }

/** Feishu's answers for "this document is gone", as opposed to "you may not see it". */
/**
 * What "gone" reads like across Feishu's document APIs.
 *
 * A deleted sheet answers `1310249 Path param :spreadsheet_token is deleted`, a token
 * that never existed answers `1310214 … is not exist`; other families say `not found`
 * or `NOTEXIST`. All of them mean the link is dead, which is what the list marks.
 */
const GONE = /is deleted|not exist|no such|not[ _-]?found|不存在|已删除|已被删除|\bdeleted\b|NOTEXIST|1770002/i

/**
 * What "I am not allowed to know" reads like — the document may well exist.
 *
 * These must never be reported as deleted: a permission or scope gap says nothing
 * about the file, and a false "已删除" next to a live document is worse than silence.
 */
const NO_ACCESS = /unauthorized|access denied|no permission|permission denied|forbidden|missing_scope|app_scope_not_applied|99991672|99991679/i

/**
 * One existence probe per document family.
 *
 * `drive +inspect` is *not* one of them: it only parses the URL and answers `ok` for a
 * token that does not exist, so it could never report a deletion.
 */
const PROBES = {
  sheet: (token) => `/open-apis/sheets/v3/spreadsheets/${token}`,
  docx: (token) => `/open-apis/docx/v1/documents/${token}`,
  base: (token) => `/open-apis/bitable/v1/apps/${token}`,
  slides: (token) => `/open-apis/slides/v1/presentations/${token}`,
}

/** The title each family nests in its own response. */
const TITLE_PATHS = {
  sheet: (data) => data.spreadsheet && data.spreadsheet.title,
  docx: (data) => data.document && data.document.title,
  base: (data) => data.app && data.app.name,
  slides: (data) => data.presentation && data.presentation.title,
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

/**
 * Read the metadata cache, tolerating a missing or corrupt file.
 */
async function loadCache() {
  try {
    const cache = JSON.parse(await readFile(CACHE, 'utf8'))
    return { tokens: cache.tokens || {}, names: cache.names || {}, failures: cache.failures || {} }
  } catch (error) {
    return { tokens: {}, names: {}, failures: {} }
  }
}

/**
 * Write the metadata cache; a failure costs one lookup, so it is swallowed.
 *
 * @param cache - `{ tokens, names, failures }`.
 */
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
 * @returns `{ owners, titles, known }` — owner ids and real titles by token,
 *   and the tokens Feishu accounted for at all. A token missing from `known` is
 *   either deleted or invisible, which the caller distinguishes by probing it.
 */
async function scan(docs) {
  const wiki = docs.filter((doc) => doc.ty === 'wiki')
  const rest = docs.filter((doc) => doc.ty !== 'wiki')
  const owners = new Map()
  const titles = new Map()
  const known = new Set()

  if (rest.length) {
    const answer = await invokeData(['api', 'POST', '/open-apis/drive/v1/metas/batch_query', '--as', 'user',
      '--data', JSON.stringify({
        request_docs: rest.map((doc) => ({ doc_token: tokenOf(doc), doc_type: META_TYPE[doc.ty] || 'docx' })),
        with_url: false,
      })], 12000)
    for (const meta of (answer && answer.metas) || []) {
      if (!meta || !meta.doc_token) continue
      known.add(meta.doc_token)
      if (meta.owner_id) owners.set(meta.doc_token, meta.owner_id)
      // The document's own name beats anything guessed from message text.
      if (meta.title && String(meta.title).trim()) titles.set(meta.doc_token, String(meta.title).trim())
    }
  }

  // A wiki node keeps its owner on the node rather than in the drive metadata.
  await mapLimit(wiki, 3, async (doc) => {
    const answer = await invokeData(['api', 'GET', '/open-apis/wiki/v2/spaces/get_node', '--as', 'user',
      '--params', JSON.stringify({ token: tokenOf(doc) })], 6000)
    if (!answer) return
    known.add(tokenOf(doc))
    const node = answer.node || {}
    const owner = node.owner || node.creator
    if (owner) owners.set(tokenOf(doc), owner)
    if (node.title && String(node.title).trim()) titles.set(tokenOf(doc), String(node.title).trim())
  })

  return { owners, titles, known }
}

/**
 * Probe one document for existence, and take its title while we are there.
 *
 * @returns `{ verdict, title }` — `verdict` is `'exists'`, `'deleted'` or
 *   `'unknown'`; permission, scope, network and credential failures are all
 *   `'unknown'`, because none of them mean the document is gone.
 */
async function checkDocument(doc) {
  const probe = PROBES[doc && doc.ty]
  if (!probe) return { verdict: 'unknown', title: '' }
  const parsed = await invoke(['api', 'GET', probe(tokenOf(doc)), '--as', 'user'], 6000)
  if (!parsed) return { verdict: 'unknown', title: '' }
  if (parsed.ok) {
    const data = parsed.data || {}
    const read = TITLE_PATHS[doc.ty]
    const title = read ? String(read(data) || '').trim() : ''
    return { verdict: 'exists', title }
  }
  const error = parsed.error || {}
  const said = `${error.subtype || ''} ${error.message || ''} ${error.code || ''}`
  // Permission first: a document I may not read is not a document that is gone.
  if (NO_ACCESS.test(said)) return { verdict: 'unknown', title: '' }
  return { verdict: GONE.test(said) ? 'deleted' : 'unknown', title: '' }
}

const nameOf = (user) => (user && (user.localized_name || user.name || user.en_name)) || ''

/**
 * Display names for a set of owner ids.
 *
 * One batched `+search-user` asks for all of them at once (the shape user
 * identity is meant to use); when that scope is missing, each id is retried with
 * `+get-user`, which needs a different scope. Both failing is not an error worth
 * failing the list for — the caller keeps the owner id it already has.
 *
 * @returns `{ names, error }` — names by owner id, and the reason none arrived.
 */
async function findNames(ownerIds) {
  const names = new Map()
  if (!ownerIds.length) return { names, error: '' }

  const batched = await invoke(['contact', '+search-user', '--as', 'user', '--user-ids', ownerIds.slice(0, 100).join(',')], 10000)
  if (batched && batched.ok) {
    const users = (batched.data && (batched.data.users || batched.data.items)) || []
    for (const user of users) {
      const id = user.open_id || user.user_id
      const name = nameOf(user)
      if (id && name && name !== id) names.set(id, name)
    }
    if (names.size) return { names, error: '' }
  }

  let error = why(batched)
  await mapLimit(ownerIds, 3, async (id) => {
    const one = await invoke(['contact', '+get-user', '--as', 'user', '--user-id', id], 5000)
    if (!one) return
    if (one.ok) {
      const name = nameOf(one.data && one.data.user)
      if (name && name !== id) names.set(id, name)
    } else if (!error) {
      error = why(one)
    }
  })
  return { names, error: names.size ? '' : error }
}

/**
 * Why creator names may be missing, for `doctor.json`: '' when they resolve.
 *
 * @returns `{ names }` — the last failure that kept an owner id on screen.
 */
export async function creatorStatus() {
  const cache = await loadCache()
  return { names: (cache.failures && cache.failures.names) || '' }
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
  if (!(await larkCli())) return docs

  const cache = await loadCache()
  const stale = (row) => !row || !row.checkedAt || Date.now() - row.checkedAt > TTL
  // A document is asked about when Feishu's answer about it is missing or old —
  // and also when its title is still the token: a fresh owner answer says nothing
  // about the title, so a cache hit must not skip that question.
  const ask = docs.filter((doc) => {
    const token = tokenOf(doc)
    const row = cache.tokens[token]
    if (stale(row)) return true
    const nameless = !doc.t || doc.t === token
    // `noTitleAt` expires with the TTL: Feishu having no name for a document once
    // is not a reason to stop asking forever.
    const gaveUp = row.noTitleAt && Date.now() - row.noTitleAt < TTL
    return nameless && !(row.title || gaveUp || row.deleted)
  })

  // Existence is a separate question from naming: a document in the trash still has
  // metadata and a title, so probing only the nameless ones would never see a deletion.
  const toProbe = docs.filter((doc) => {
    const row = cache.tokens[tokenOf(doc)]
    return !row || !row.probedAt || Date.now() - row.probedAt > TTL
  })

  // Probing does not depend on the metadata call, so it starts alongside it.
  const probing = toProbe.length
    ? mapLimit(toProbe, 5, async (doc) => {
        const { verdict, title } = await checkDocument(doc)
        const row = (cache.tokens[tokenOf(doc)] = cache.tokens[tokenOf(doc)] || {})
        if (verdict === 'deleted') row.deleted = true
        else if (verdict === 'exists') delete row.deleted
        if (verdict !== 'unknown') row.probedAt = Date.now()
        if (title) {
          row.title = title
          delete row.noTitleAt
          row.checkedAt = Date.now()
        } else if (verdict === 'exists' && !row.title) {
          row.noTitleAt = Date.now()
          row.checkedAt = Date.now()
        }
      })
    : Promise.resolve()

  if (ask.length) {
    const { owners, titles, known } = await scan(ask)
    for (const [token, owner] of owners) {
      const row = (cache.tokens[token] = cache.tokens[token] || {})
      row.owner = owner
      row.checkedAt = Date.now()
      // Metadata answering does not mean the document is alive: a document in the
      // trash still has an owner and a title. Only the existence probe decides.
    }
    for (const [token, title] of titles) {
      const row = (cache.tokens[token] = cache.tokens[token] || {})
      row.title = title
      row.checkedAt = Date.now()
      delete row.noTitleAt
    }
    for (const token of known) {
      const row = (cache.tokens[token] = cache.tokens[token] || {})
      row.checkedAt = Date.now()
    }

  }

  // The existence verdict does not block the first paint: it costs one call per
  // document and the popover polls, so a deletion appears on the next tick. Its
  // results are saved on their own, because the cache below is written without them.
  if (toProbe.length) {
    void probing.then(() => saveCache(cache)).catch(() => {})
  } else {
    void probing.catch(() => {})
  }

  const owners = [...new Set(Object.values(cache.tokens).map((row) => row && row.owner).filter(Boolean))]
  const unnamed = owners.filter((owner) => !cache.names[owner])
  if (unnamed.length) {
    const { names, error } = await findNames(unnamed)
    for (const [id, name] of names) cache.names[id] = name
    // Keep the reason: an owner id shown as-is should be explainable.
    cache.failures = cache.failures || {}
    if (error && !names.size) cache.failures.names = error
    else delete cache.failures.names
  }

  for (const doc of docs) {
    const token = tokenOf(doc)
    const row = cache.tokens[token]
    if (!row) continue
    doc.deleted = row.deleted === true
    if (row.owner) doc.by = cache.names[row.owner] || row.owner
    // A label the message itself gave stays; a missing title or a bare token is
    // replaced by the document's real name.
    if ((!doc.t || doc.t === token) && row.title) doc.t = row.title
  }

  await saveCache(cache)
  return docs
}
