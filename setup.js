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
 */
import { execFile } from 'node:child_process'
import zlib from 'node:zlib'

import { invoke, larkCli, run, why } from './cli.js'

/** Scopes this plugin cannot work without: document metadata, titles, owners. */
const REQUIRED_SCOPES = ['drive:drive.metadata:readonly']

/**
 * Scopes that make the result nicer rather than possible: a person's name
 * instead of an owner id, and their avatar instead of an initial.
 */
const NICE_SCOPES = ['contact:user:search', 'contact:user.basic_profile:readonly']

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

/** Who is signed in, till when, and which of our scopes the token carries. */
async function authState() {
  const state = { available: false, userName: '', openId: '', brand: 'feishu', expiresAt: '', missing: [], required: REQUIRED_SCOPES, nice: NICE_SCOPES }
  const status = await invoke(['auth', 'status', '--json'])
  if (status && status.brand) state.brand = status.brand
  const user = status && status.identities && status.identities.user
  if (!user) return state
  state.available = Boolean(user.available) && user.tokenStatus === 'valid'
  state.userName = user.userName || ''
  state.openId = user.openId || ''
  state.expiresAt = user.expiresAt || ''
  if (!state.available) return state
  const checked = await invoke(['auth', 'check', '--scope', [...REQUIRED_SCOPES, ...NICE_SCOPES].join(' '), '--json'])
  if (checked) state.missing = Array.isArray(checked.missing) ? checked.missing : []
  return state
}

/**
 * The signed-in user's avatar, or '' when Feishu will not give one.
 *
 * The contact shortcuts do not expose an avatar, so this asks the raw user
 * endpoint, which needs a contact scope. A miss is cached for five minutes: the
 * account card falls back to an initial, and a granted scope shows up soon.
 */
let avatarCache = { openId: '', url: '', at: 0 }
async function findAvatar(openId) {
  if (!openId) return ''
  const fresh = avatarCache.openId === openId && Date.now() - avatarCache.at < 5 * 60 * 1000
  if (fresh) return avatarCache.url
  const pick = (avatar) => (typeof avatar === 'string'
    ? avatar
    : (avatar && (avatar.avatar_240 || avatar.avatar_640 || avatar.avatar_72 || avatar.avatar_1920)) || '')
  let url = ''
  // The user endpoint is the one that carries `avatar`; the contact shortcuts
  // return names only.
  const direct = await invoke(['api', 'GET', `/open-apis/contact/v3/users/${openId}`, '--as', 'user',
    '--params', JSON.stringify({ user_id_type: 'open_id' })], 6000)
  if (direct && direct.ok && direct.data && direct.data.user) url = pick(direct.data.user.avatar)
  if (!url) {
    const fallback = await invoke(['contact', '+get-user', '--as', 'user', '--user-id', openId], 5000)
    const user = fallback && fallback.ok && fallback.data && fallback.data.user
    if (user) url = pick(user.avatar)
  }
  avatarCache = { openId, url: String(url || ''), at: Date.now() }
  return avatarCache.url
}

/**
 * Everything a first run needs, in one object.
 *
 * @returns the readiness report served as `doctor.json`.
 */
export async function diagnose() {
  const [zstd, bin, auth] = await Promise.all([zstdState(), which('lark-cli'), authState()])

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
    const detail = !auth.available
      ? '未登录或登录已失效：创建者、真实标题、已删除标记都拿不到'
      : missingRequired.length
        ? `缺少必需权限：${missingRequired.join('、')}`
        : missingNice.length
          ? `已授权${auth.userName ? `（${auth.userName}）` : ''}；再授通讯录权限即可显示人名而不是 id`
          : `已授权${auth.userName ? `（${auth.userName}）` : ''}${auth.expiresAt ? ` · 到期 ${auth.expiresAt.slice(0, 16).replace('T', ' ')}` : ''}`
    items.push({
      id: 'auth',
      title: '飞书授权',
      // Working is what the required scopes buy; the nice ones only prettify.
      ok: auth.available && !missingRequired.length,
      polish: Boolean(missingNice.length),
      detail,
      // One click starts the device flow, asking for exactly what is missing —
      // never the whole scope set the CLI could request.
      fix: auth.available && !missingRequired.length && !missingNice.length ? null : {
        kind: 'auth',
        scopes: [...new Set([...REQUIRED_SCOPES, ...NICE_SCOPES, ...auth.missing])],
      },
    })
  }

  const user = {
    available: auth.available,
    name: auth.userName,
    openId: auth.openId,
    brand: auth.brand,
    avatar: auth.available ? await findAvatar(auth.openId) : '',
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
    auth: { ...auth, missingRequired: auth.missing.filter((scope) => REQUIRED_SCOPES.includes(scope)) },
  }
}

/**
 * Begin a device-code login.
 *
 * @param scopes - scopes to request; defaults to what this plugin reads.
 * @returns `{ url, deviceCode, expiresIn }` — `url` is what the user opens.
 */
export async function startLogin(scopes) {
  const wanted = Array.isArray(scopes) && scopes.length ? scopes : [...REQUIRED_SCOPES, ...NICE_SCOPES]
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
