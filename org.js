/**
 * The organisation behind the signed-in user, and whether it is verified.
 *
 * Three sources are tried in order, because each needs a different scope and the
 * best answer is not always available:
 *
 * 1. `GET /open-apis/verification/v1/verification` — the intended API. Returns the
 *    企业主体名称 and `has_verification`, which is exactly "who is this and are they
 *    verified". Needs a **tenant** access token and `verification:verification_information:readonly`.
 * 2. `GET /open-apis/tenant/v2/tenant/query` — tenant name plus `tenant_tag`
 *    (0 个人 / 1 企业 / 2 教育). Also a tenant token, scope `tenant:tenant:readonly`.
 * 3. `GET /open-apis/contact/v3/departments/0` — the tenant's root department, which
 *    Feishu names after the company. Works with a **user** token and
 *    `contact:contact.base:readonly`, but says nothing about verification.
 *
 * A user token alone can never answer "is this tenant verified": the tenant token is
 * mandatory for 1 and 2. A personal account has no enterprise subject: source 1 answers
 * `has_verification: false` with no name, which is reported as `kind: 'personal'` so the
 * popover can say "飞书个人用户" and show **no** badge.
 *
 * When none of the three answers, the returned name is empty
 * and `error` says which scope to grant — the popover then says "飞书用户" rather than
 * claiming anything.
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

/** A company name and its verification rarely change; a day of caching is plenty. */
const TTL = 24 * 60 * 60 * 1000

/** Tenant tags the tenant API can return, spelled the way a person reads them. */
const TENANT_TAGS = { 0: '个人', 1: '企业', 2: '教育' }

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
 * Pull the scope-apply URL out of a CLI error.
 *
 * The app-scope error is the one a developer can act on, and the CLI prints the exact
 * console link for it. Surfacing that link turns "it does not work" into one click.
 *
 * @param answer - the parsed CLI envelope of a failed call.
 * @returns the URL, or '' when the failure has none.
 */
function scopeApplyUrl(answer) {
  const error = (answer && answer.error) || {}
  // The CLI ships a ready-made URL; the hint carries the same one in prose.
  if (error.console_url) return String(error.console_url)
  const found = String(error.hint || '').match(/https:\/\/open\.feishu\.cn\/page\/scope-apply\S+/)
  return found ? found[0] : ''
}

/**
 * Source 1: 认证信息 — subject name and verification state.
 *
 * A personal Feishu account answers `{ has_verification: false }` with **no name**:
 * there is no enterprise subject to verify, so "未认证" would describe a thing that
 * does not exist. That shape becomes `kind: 'personal'` instead.
 */
async function fromVerification() {
  const answer = await invoke(['api', 'GET', '/open-apis/verification/v1/verification', '--as', 'bot'])
  const info = answer && answer.ok && answer.data ? answer.data.verification : null
  if (!info) return { ok: false, answer }
  const name = String(info.name || '').trim()
  return {
    ok: true,
    value: {
      name,
      // Only an enterprise subject can be verified; a personal account exposes none.
      verified: name && typeof info.has_verification === 'boolean' ? info.has_verification : null,
      kind: name ? 'enterprise' : 'personal',
      tag: '',
      source: 'verification',
    },
  }
}

/** Source 2: 企业信息 — tenant name and its type. */
async function fromTenant() {
  const answer = await invoke(['api', 'GET', '/open-apis/tenant/v2/tenant/query', '--as', 'bot'])
  const tenant = answer && answer.ok && answer.data ? answer.data.tenant : null
  if (!tenant) return { ok: false, answer }
  return {
    ok: true,
    value: {
      name: String(tenant.name || '').trim(),
      verified: null,
      kind: Number(tenant.tenant_tag) === 0 ? 'personal' : 'enterprise',
      tag: TENANT_TAGS[tenant.tenant_tag] || '',
      source: 'tenant',
    },
  }
}

/** Source 3: the root department, which a user token can read. */
async function fromRootDepartment() {
  const answer = await invoke(['api', 'GET', '/open-apis/contact/v3/departments/0', '--params',
    '{"department_id_type":"open_department_id"}'])
  const department = answer && answer.ok && answer.data ? (answer.data.department || answer.data) : null
  if (!department) return { ok: false, answer }
  const name = String(department.name || department.i18n_name || '').trim()
  if (!name) return { ok: false, answer }
  return { ok: true, value: { name, verified: null, kind: 'unknown', tag: '', source: 'department' } }
}

/**
 * The organisation name, its verification state when known, and what to do if not.
 *
 * @returns `{ name, verified, tag, source, at, error, fixUrl }` — `verified` is
 *   `true`/`false` only from the verification API, and `null` when that API was not
 *   available, because guessing it would be worse than leaving it blank.
 */
export async function orgFor() {
  const cached = await readCache()
  // An entry written before `kind` existed cannot describe the account reliably.
  const fresh = cached && cached.kind && Date.now() - (cached.at || 0) < TTL
  if (fresh && (cached.name || cached.kind === 'personal')) {
    return { ...cached, error: '', fixUrl: '' }
  }

  const attempts = [fromVerification, fromTenant, fromRootDepartment]
  let lastFailure = null
  for (const attempt of attempts) {
    const result = await attempt()
    if (result.ok) {
      const at = Date.now()
      const value = { ...result.value, at }
      await writeCache(value)
      return { ...value, error: '', fixUrl: '' }
    }
    lastFailure = lastFailure || result.answer
  }

  // Nothing worked: keep whatever was cached, and say what would fix it.
  return {
    name: (cached && cached.name) || '',
    verified: cached ? cached.verified ?? null : null,
    kind: (cached && cached.kind) || 'unknown',
    tag: (cached && cached.tag) || '',
    source: (cached && cached.source) || '',
    at: (cached && cached.at) || 0,
    error: why(lastFailure) || 'no answer from Feishu',
    fixUrl: scopeApplyUrl(lastFailure),
  }
}

/**
 * The cached organisation without touching the network — what a first paint may use.
 *
 * @returns `{ name, verified, tag }`, empty when nothing has been stored yet.
 */
export async function cachedOrg() {
  const cached = await readCache()
  return {
    name: (cached && cached.name) || '',
    verified: cached ? cached.verified ?? null : null,
    kind: (cached && cached.kind) || 'unknown',
    tag: (cached && cached.tag) || '',
  }
}
