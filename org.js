/**
 * The organisation the signed-in user belongs to.
 *
 * A Feishu user token does not answer "which company is this": `tenant/v2/tenant/query`
 * needs a tenant (app) token and is rejected with `user access token not support`, and
 * `authen/v1/user_info` only carries an opaque `tenant_key`. What *is* reachable with a
 * user token is the tenant's root department — Feishu names it after the company — so
 * that is what this module reads, with one read-only scope (`contact:contact.base:readonly`).
 *
 * The tenant's verified badge is deliberately absent: Feishu's open platform does not
 * expose 企业认证 to user tokens, and inventing a label would be worse than omitting it.
 *
 * @author WaterLiu
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { invoke, why } from './cli.js'

/** Where the answer is cached, so opening the popover does not re-ask every time. */
const DSH_HOME = join(homedir(), '.dsh')
const STATE = process.env.FEISHU_DOCS_STATE_DIR || DSH_HOME
const CACHE = join(STATE, 'feishu-docs-org.json')

/** A company name rarely changes: a day of caching is plenty, and cheap to refresh. */
const TTL = 24 * 60 * 60 * 1000

/** Read the cache, tolerating a missing or corrupt file. */
async function readCache() {
  try {
    return JSON.parse(await readFile(CACHE, 'utf8'))
  } catch (error) {
    return null
  }
}

/** Write the cache; failing to write it only costs one lookup. */
async function writeCache(value) {
  try {
    await mkdir(dirname(CACHE), { recursive: true })
    await writeFile(CACHE, JSON.stringify(value, null, 1))
  } catch (error) {
    /* the cache is an optimisation */
  }
}

/**
 * The tenant's name, from its root department.
 *
 * @returns `{ name, at, error }` — `name` is empty when the scope is missing, and
 *   `error` then says which scope to grant.
 */
export async function orgFor() {
  const cached = await readCache()
  if (cached && cached.name && Date.now() - (cached.at || 0) < TTL) {
    return { name: cached.name, at: cached.at || 0, error: '' }
  }

  // Department id 0 is the root of the tenant's department tree.
  const answer = await invoke(['api', 'GET', '/open-apis/contact/v3/departments/0', '--params',
    '{"department_id_type":"open_department_id"}'])
  const department = answer && answer.ok && answer.data
    ? (answer.data.department || answer.data)
    : null
  const name = String((department && (department.name || department.i18n_name)) || '').trim()
  if (!name) {
    // The CLI names the scope in its error, which is exactly what the panel shows.
    return { name: (cached && cached.name) || '', at: (cached && cached.at) || 0, error: why(answer) }
  }

  const at = Date.now()
  await writeCache({ name, at })
  return { name, at, error: '' }
}

/**
 * The cached organisation without touching the network — what a first paint may use.
 *
 * @returns `{ name, at }`, with an empty name when nothing has been stored yet.
 */
export async function cachedOrg() {
  const cached = await readCache()
  return { name: (cached && cached.name) || '', at: (cached && cached.at) || 0 }
}
