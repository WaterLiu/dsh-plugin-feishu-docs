/**
 * First-run readiness, and re-authorization when it lapses.
 *
 * The popover can only be as good as what this machine has: Node's zstd for the
 * log, `lark-cli` for anything Feishu knows, and a signed-in user whose token
 * carries the scopes this plugin needs. This module answers "what is missing"
 * in one object, and drives the device-code login that fixes the last one, so a
 * new user sees one panel with the remaining steps instead of an empty column.
 *
 * Nothing here installs anything: a missing binary is reported with the exact
 * command that installs it, because a global install is the user's call.
 *
 * @author WaterLiu
 */
import { execFile } from 'node:child_process'
import zlib from 'node:zlib'

import { avatarFor } from './avatar.js'
import { orgFor } from './org.js'
import { invoke, larkCli, run, why } from './cli.js'

/** Scopes this plugin cannot work without: document metadata, titles, owners. */
const REQUIRED_SCOPES = ['drive:drive.metadata:readonly']

/**
 * Scopes that make the result nicer rather than possible: a colleague's name
 * instead of an owner id. The signed-in user's avatar needs nothing extra — it
 * comes from `authen/v1/user_info`, which the token already covers.
 */
const NICE_SCOPES = ['contact:user:search', 'contact:contact.base:readonly']

/**
 * Scopes that a **user** authorization can never grant.
 *
 * These belong to the app (tenant) token and are applied in the developer console,
 * then approved by a tenant admin — `auth login` cannot request them, and asking for
 * them there would fail the whole device flow. They live here so that nobody adds
 * them to the lists above by mistake, and so the panel can name what is missing.
 */
const APP_SCOPES = ['verification:verification_information:readonly', 'tenant:tenant:readonly']

/** Every user-level scope this plugin can use, in one place. */
function allUserScopes() {
  return [...REQUIRED_SCOPES, ...NICE_SCOPES]
}

/**
 * The scopes a login should ask for.
 *
 * One place decides this, because the popover used to keep its own copy and it went
 * stale — the 企业名称 scope was added here and the copy never learned about it.
 *
 * @param state - an `authState()` answer: `{ available, missing }`.
 * @returns user-level scopes only; app-level ones are filtered out by construction.
 */
export function loginScopesFor(state = {}) {
  const explicit = Array.isArray(state.explicit) ? state.explicit.filter(Boolean) : []
  const missing = Array.isArray(state.missing) ? state.missing.filter(Boolean) : []
  const wanted = explicit.length
    ? explicit
    : state.available && missing.length
      ? missing
      : allUserScopes()
  // Defensive: a caller that passes an app-level scope must not break the flow.
  return [...new Set(wanted)].filter((scope) => !APP_SCOPES.includes(scope))
}

/**
 * Device-flow completions still running in the background, by device code.
 *
 * The CLI blocks until the user authorizes, which can take minutes. Running that
 * inside an HTTP request means the request times out first, and a killed exchange
 * burns the one-time code — the popover then waits forever. So the wait lives
 * here and the popover only asks for the outcome.
 */
const loginJobs = new Map()

/** Forget completions nobody will ask about again. */
function pruneJobs() {
  const cutoff = Date.now() - 15 * 60 * 1000
  for (const [code, job] of loginJobs) if (job.at < cutoff) loginJobs.delete(code)
}

/** Run `command` through the login shell, matching how a GUI-started host finds tools. */
function which(command) {
  return new Promise((done) => {
    execFile('sh', ['-lc', `command -v ${command}`], (error, stdout) => {
      done(!error && String(stdout).trim() ? String(stdout).trim() : null)
    })
  })
}

/** Whether zstd can be decompressed here, and by what. */
async function zstdState() {
  if (typeof zlib.zstdDecompressSync === 'function') return { zstd: 'core', zstdPath: null }
  const binary = await which('zstd')
  return { zstd: binary ? 'cli' : null, zstdPath: binary }
}

/** A timestamp from the CLI, if it parses and lies in the future. */
function isFuture(value) {
  const at = Date.parse(String(value || ''))
  return Number.isFinite(at) && at > Date.now()
}

/** Who is signed in, till when, and whether it can still renew itself. */
async function authState() {
  const state = {
    available: false, userName: '', openId: '', brand: 'feishu',
    expiresAt: '', refreshExpiresAt: '', tokenStatus: '', canRefresh: false,
    missing: [], required: REQUIRED_SCOPES, nice: NICE_SCOPES, app: APP_SCOPES,
  }
  const status = await invoke(['auth', 'status', '--json'])
  if (status && status.brand) state.brand = status.brand
  const user = status && status.identities && status.identities.user
  if (!user) return state
  state.userName = user.userName || ''
  state.openId = user.openId || ''
  state.expiresAt = user.expiresAt || ''
  state.refreshExpiresAt = user.refreshExpiresAt || ''
  state.tokenStatus = user.tokenStatus || ''
  state.available = Boolean(user.available) && user.tokenStatus === 'valid'
  // An expired access token is not a lost login: the refresh token lives for a
  // week and the CLI renews it on the next authorized call. `canRefresh` is what
  // tells "needs renewing" apart from "needs the user again".
  state.canRefresh = !state.available && Boolean(user.available) && isFuture(user.refreshExpiresAt)
  if (!state.available) return state
  const checked = await invoke(['auth', 'check', '--scope', allUserScopes().join(' '), '--json'])
  if (checked) state.missing = Array.isArray(checked.missing) ? checked.missing : []
  return state
}

/** Renewal is cheap, but not free: one probe per minute at most. */
const PROBE_COOLDOWN = 60 * 1000
/** After a failure, back off — a revoked token must not be retried in a loop. */
const PROBE_MAX_BACKOFF = 10 * 60 * 1000

/** One renewal at a time: refresh tokens rotate, so two probes would burn each other. */
let probeFlight = null
/** `{ at, ok, via, reason, tookMs, failures, nextAt }` — for the trace and the UI. */
let probeState = { at: 0, ok: null, via: '', reason: '', tookMs: 0, failures: 0, nextAt: 0 }

/** The last renewal attempt, without any token material. */
export function lastProbe() {
  return { ...probeState }
}

/** Turn a failed CLI run into a reason a person can act on. */
function classifyProbeFailure(text) {
  const raw = String(text || '')
  if (/invalid_grant|refresh[ _-]?token|expired|revoked|invalid_token|unauthorized/i.test(raw)) return 'expired'
  if (/keychain|operation not permitted|EPERM|EACCES/i.test(raw)) return 'storage'
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|socket hang up|getaddrinfo/i.test(raw)) return 'network'
  return 'unknown'
}

/**
 * Renew the access token without bothering the user.
 *
 * `lark-cli` refreshes implicitly — the next authorized call after expiry spends
 * the refresh token and returns a fresh two-hour access token. The plugin
 * therefore only has to make such a call. Two probes are tried because the first
 * one's behaviour on an expired token is a build detail: `auth check` (read only),
 * then the lightest authorized endpoint there is, `authen/v1/user_info`, which the
 * avatar code already uses.
 *
 * Success is not "the command exited 0" — it is `auth status` reporting a valid
 * token whose expiry actually moved. Anything else is a failure and is classified,
 * because "network is down" must never look like "you have to log in again".
 *
 * @param options - `force` skips the cooldown (used right after a login).
 * @returns `{ ok, via, reason, tookMs, state }` — `state` is the fresh auth state.
 */
export async function refreshAuth({ force = false } = {}) {
  if (probeFlight) return probeFlight
  if (!force && Date.now() < probeState.nextAt) {
    return { ok: false, via: '', reason: 'cooldown', tookMs: 0, state: await authState() }
  }

  probeFlight = (async () => {
    const started = Date.now()
    const before = await authState()
    if (!before.canRefresh) {
      probeState = { ...probeState, at: started, ok: before.available, via: '', reason: before.available ? 'fresh' : 'expired', tookMs: Date.now() - started, nextAt: 0 }
      return { ok: before.available, via: '', reason: probeState.reason, tookMs: probeState.tookMs, state: before }
    }

    const scopes = allUserScopes().join(' ')
    let via = ''
    let detail = ''

    const check = await run(['auth', 'check', '--scope', scopes, '--json'], 20000)
    if (check.code === 0) via = 'auth-check'
    else detail = check.text

    if (!via) {
      const probe = await run(['api', 'GET', '/open-apis/authen/v1/user_info'], 20000)
      if (probe.code === 0) via = 'user-info'
      else detail = `${detail} ${probe.text}`
    }

    // The only proof of renewal: a valid token whose expiry moved forward.
    const after = await authState()
    const movedForward = Date.parse(after.expiresAt || '') > Date.parse(before.expiresAt || '') || (!before.expiresAt && Boolean(after.expiresAt))
    const ok = after.available && movedForward
    const reason = ok ? '' : classifyProbeFailure(detail) || (via ? 'unknown' : 'expired')

    probeState = {
      at: started,
      ok,
      via,
      reason,
      tookMs: Date.now() - started,
      failures: ok ? 0 : probeState.failures + 1,
      nextAt: ok ? started + PROBE_COOLDOWN : started + Math.min(PROBE_MAX_BACKOFF, PROBE_COOLDOWN * 2 ** Math.min(probeState.failures + 1, 4)),
    }
    return { ok, via, reason, tookMs: probeState.tookMs, state: after }
  })()

  try {
    return await probeFlight
  } finally {
    probeFlight = null
  }
}

/**
 * Everything a first run needs, in one object.
 *
 * @returns the readiness report served as `doctor.json`.
 */
export async function diagnose() {
  const [zstd, bin, first] = await Promise.all([zstdState(), which('lark-cli'), authState()])

  // An expired access token is renewable for a week. Try that before telling
  // anyone they are signed out — the CLI renews on the next authorized call.
  let probe = null
  let auth = first
  if (bin && first.canRefresh) {
    probe = await refreshAuth()
    auth = probe.state || (await authState())
  }

  // Asked before the items are built, because one of them is about this answer.
  const org = auth.available
    ? await orgFor()
    : { name: '', verified: null, kind: 'unknown', tag: '', source: '', at: 0, error: '', fixUrl: '' }

  const items = []
  items.push({
    id: 'zstd',
    title: '解压会话日志',
    ok: Boolean(zstd.zstd),
    detail: zstd.zstd === 'core' ? 'Node 内置 zstd' : zstd.zstd === 'cli' ? `使用 ${zstd.zstdPath}` : '既没有 Node 内置 zstd，也没有 zstd 命令',
    fix: zstd.zstd ? null : { kind: 'command', command: 'brew install zstd' },
  })

  items.push({
    id: 'larkCli',
    title: '飞书命令工具',
    ok: Boolean(bin),
    detail: bin || '未安装 lark-cli：创建者、真实标题、已删除标记都依赖它',
    fix: bin ? null : { kind: 'command', command: 'npm install -g @larksuite/cli' },
  })

  if (bin) {
    const missingRequired = auth.missing.filter((scope) => REQUIRED_SCOPES.includes(scope))
    const missingNice = auth.missing.filter((scope) => NICE_SCOPES.includes(scope))
    // Why it is unavailable decides what to advise: a network blip must not tell
    // someone to authorize again.
    const renewReason = probe && !probe.ok ? probe.reason : ''
    const detail = !auth.available
      ? renewReason === 'network'
        ? '网络异常，暂时读不到飞书；稍后会自动重试，不需要重新授权'
        : renewReason === 'storage'
          ? '续期后的登录凭据无法写入 keychain：创建者、真实标题、已删除标记都拿不到，可能需要重新授权'
          : '未登录或登录已失效：创建者、真实标题、已删除标记都拿不到'
      : missingRequired.length
        ? `缺少必需权限：${missingRequired.join('、')}`
        : missingNice.length
          ? `已授权${auth.userName ? `（${auth.userName}）` : ''}；再授通讯录权限即可显示人名、企业名称而不是 id`
          : `已授权${auth.userName ? `（${auth.userName}）` : ''}${auth.expiresAt ? ` · 到期 ${auth.expiresAt.slice(0, 16).replace('T', ' ')}` : ''}`
    // The organisation name and its verified badge need a *tenant* token, so this is
    // an app-level scope: the fix is a console link, not another user login.
    if (auth.available && !org.name && org.kind !== 'personal') {
      items.push({
        id: 'org',
        title: '企业名称与认证状态',
        ok: false,
        detail: auth.orgError
          ? `需要应用权限 verification:verification_information:readonly：${auth.orgError}`
          : '需要应用权限 verification:verification_information:readonly（查看租户认证信息）',
        fix: {
          kind: 'link',
          url: org.fixUrl || 'https://open.feishu.cn/app',
          label: org.fixUrl ? '去开通权限' : '打开开发者后台',
        },
      })
    }

    items.push({
      id: 'auth',
      title: '飞书授权',
      // Working is what the required scopes buy; the nice ones only prettify.
      ok: auth.available && !missingRequired.length,
      polish: Boolean(missingNice.length),
      detail,
      // One click starts the device flow, asking for exactly what is missing —
      // never the whole scope set the CLI could request.
      // Ask only for what the token is actually missing: `auth check` already
      // compared the granted scopes with ours. Only a signed-out machine asks for
      // the whole set, because there is nothing to compare against.
      fix: auth.available && !auth.missing.length ? null : {
        kind: 'auth',
        // Same rule as every other entry point — never a second copy of the list.
        scopes: loginScopesFor(auth),
      },
    })
  }

  // Cached on disk by avatar.js: only the first open waits for the download.
  const avatar = auth.available ? await avatarFor(auth.openId) : { bytes: null, url: '', at: 0, error: '' }
  const user = {
    available: auth.available,
    name: auth.userName,
    openId: auth.openId,
    brand: auth.brand,
    hasAvatar: Boolean(avatar.bytes),
    avatarAt: avatar.at || 0,
    avatarError: avatar.error || '',
    // Empty when the organisation scope is not granted yet; the popover then
    // says just "飞书用户" rather than claiming anything about the account.
    org: org.name || '',
    orgError: org.error || '',
    // From the 认证信息 API only: `null` means "not known", never "not verified".
    orgVerified: typeof org.verified === 'boolean' ? org.verified : null,
    // 'enterprise' | 'personal' | 'unknown' — a personal account has no badge at all.
    orgKind: org.kind || 'unknown',
    orgTag: org.tag || '',
    orgSource: org.source || '',
    orgFixUrl: org.fixUrl || '',
  }

  return {
    checkedAt: new Date().toISOString(),
    ok: items.every((item) => item.ok),
    user,
    // What the popover should offer to fix: an item with a fix is actionable.
    pending: items.filter((item) => item.fix).map((item) => item.id),
    items,
    zstd: zstd.zstd,
    zstdPath: zstd.zstdPath,
    node: process.version,
    larkCli: bin,
    // The one list a login button should request. The popover used to keep its own
    // copy, which silently missed every scope added after it was written.
    loginScopes: loginScopesFor(auth),
    auth: {
      ...auth,
      missingRequired: auth.missing.filter((scope) => REQUIRED_SCOPES.includes(scope)),
      // `state` is the one word the popover and the trace care about.
      state: auth.available ? (probe && probe.ok ? 'refreshed' : 'valid') : 'needs_login',
      probe: probe ? { ok: probe.ok, via: probe.via, reason: probe.reason, tookMs: probe.tookMs } : null,
    },
  }
}

/**
 * Begin a device-code login.
 *
 * @param scopes - scopes to request; defaults to what this plugin reads.
 * @returns `{ url, deviceCode, expiresIn }` — `url` is what the user opens.
 */
export async function startLogin(scopes) {
  // Same rule as the button: only user-level scopes, never the app-level ones.
  const wanted = loginScopesFor({ explicit: Array.isArray(scopes) ? scopes : [] })
  const answer = await invoke(['auth', 'login', '--scope', wanted.join(' '), '--no-wait', '--json'], 30000)
  if (!answer) return { error: 'lark-cli 没有返回结果' }
  if (answer.ok === false) return { error: (answer.error && answer.error.message) || '发起授权失败' }
  const url = answer.verification_url || answer.verification_uri
  const deviceCode = answer.device_code || ''
  if (!url || !deviceCode) return { error: '没有拿到授权链接' }

  pruneJobs()
  loginJobs.set(deviceCode, { state: 'waiting', error: '', at: Date.now() })
  run(['auth', 'login', '--device-code', deviceCode, '--json'], 6 * 60 * 1000).then((result) => {
    const job = loginJobs.get(deviceCode) || { at: Date.now() }
    if (result.code === 0 && (!result.envelope || result.envelope.ok !== false)) {
      loginJobs.set(deviceCode, { ...job, state: 'ok', error: '', at: Date.now() })
      return
    }
    const said = why(result.envelope) || result.text.split('\n').filter(Boolean).slice(-1)[0] || '授权失败'
    loginJobs.set(deviceCode, { ...job, state: 'error', error: said, at: Date.now() })
  })

  return { url, deviceCode, expiresIn: answer.expires_in || 600 }
}

/**
 * Sign out, which clears the token this plugin relies on.
 *
 * @returns `{ ok }` or `{ error }`.
 */
export async function logout() {
  const result = await run(['auth', 'logout', '--json'], 20000)
  if (result.code === 0) return { ok: true }
  if (result.envelope && result.envelope.ok === false) {
    const error = result.envelope.error || {}
    return { error: error.message || '退出失败' }
  }
  return { error: result.text ? result.text.split('\n').filter(Boolean).slice(-1)[0] : '退出失败' }
}

/**
 * Complete a device-code login started by {@link startLogin}.
 *
 * @param deviceCode - the code from that call.
 * @returns `{ ok }` or `{ error }`.
 */
export async function finishLogin(deviceCode) {
  if (!deviceCode) return { error: '缺少 device_code' }

  const job = loginJobs.get(deviceCode)
  if (job) {
    if (job.state === 'ok') return { ok: true }
    if (job.state === 'error') return { error: job.error }
    return { pending: true }
  }

  // No job for this code — the host restarted, or an older popover asked. Try
  // once directly, and report "not yet" as pending rather than as a failure.
  const answer = await invoke(['auth', 'login', '--device-code', deviceCode, '--json'], 10000)
  if (answer && answer.ok) return { ok: true }
  if (answer && answer.ok === false) return { error: why(answer) || '授权失败' }
  return { pending: true }
}
