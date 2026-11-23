/**
 * The signed-in user's avatar, cached on disk.
 *
 * The URL Feishu hands out is a signed CDN link that can expire, and fetching it
 * costs a CLI round trip plus a download — so the picture is kept locally and
 * served from there. It is re-checked against Feishu at most once a day, in the
 * background, which means the popover never waits for it after the first time and
 * still picks up a new avatar within a day.
 *
 * `FEISHU_DOCS_STATE_DIR` overrides where the cache lives (tests point it at a
 * temporary directory); otherwise it sits beside the other plugin caches in
 * `~/.dsh`.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { invoke, why } from './cli.js'

const STATE = process.env.FEISHU_DOCS_STATE_DIR || join(homedir(), '.dsh')
const IMAGE = join(STATE, 'feishu-docs-avatar.img')
const META = join(STATE, 'feishu-docs-avatar.json')

/** How long a cached avatar is trusted before Feishu is asked again. */
const TTL = 24 * 60 * 60 * 1000

/** How long a failed refresh is left alone before trying again. */
const RETRY = 5 * 60 * 1000

/** Hosts an avatar may come from: this fetch must not reach anywhere else. */
const ALLOWED = /(^|\.)(feishucdn\.com|feishu\.cn|larksuite\.com|larksuitecdn\.com|larkoffice\.com)$/i

/** In-flight refresh, so concurrent opens share one download. */
let refreshing = null

async function readMeta() {
  try {
    return JSON.parse(await readFile(META, 'utf8'))
  } catch (error) {
    return null
  }
}

async function readImage() {
  try {
    return await readFile(IMAGE)
  } catch (error) {
    return null
  }
}

async function writeCache(openId, url, contentType, bytes) {
  await mkdir(dirname(IMAGE), { recursive: true })
  await writeFile(IMAGE, bytes)
  await writeFile(META, JSON.stringify({ openId, url, contentType, at: Date.now() }, null, 1))
}

/**
 * Ask Feishu for the avatar URL and download it.
 *
 * @param openId - who the avatar belongs to.
 * @returns `{ openId, url, contentType, at, bytes }`, or null when it failed.
 */
async function download(openId) {
  const answer = await invoke(['api', 'GET', '/open-apis/authen/v1/user_info', '--as', 'user'], 6000)
  const info = (answer && answer.ok && answer.data) || null
  if (!info) return { error: why(answer) || 'user_info 调用失败' }
  const url = info.avatar_middle || info.avatar_big || info.avatar_url || info.avatar_thumb
  if (!url) return { error: 'user_info 没有返回 avatar 字段' }

  let target = null
  try {
    target = new URL(url)
  } catch (error) {
    return { error: 'avatar 链接无法解析' }
  }
  if (!ALLOWED.test(target.hostname)) return { error: `avatar 域名不在白名单：${target.hostname}` }

  try {
    const response = await fetch(target, { redirect: 'follow' })
    if (!response.ok) return { error: `avatar 下载失败：HTTP ${response.status}` }
    const type = response.headers.get('content-type') || ''
    if (!type.startsWith('image/')) return { error: `avatar 不是图片：${type || '未知类型'}` }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length) return { error: 'avatar 内容为空' }
    await writeCache(openId, url, type, bytes)
    return { openId, url, contentType: type, at: Date.now(), bytes }
  } catch (error) {
    return { error: `avatar 下载异常：${String(error)}` }
  }
}

/** Refresh in the background, once at a time. */
function refresh(openId) {
  if (refreshing) return refreshing
  refreshing = download(openId)
    .catch(() => null)
    .then(() => {
      refreshing = null
    })
  return refreshing
}

/**
 * The avatar for one user, from cache when there is one.
 *
 * A cached picture is returned immediately; only the first ever call waits for
 * the download, and a stale one is refreshed behind the caller's back.
 *
 * @param openId - the signed-in user's open id.
 * @returns `{ bytes, contentType, at, url, error }` — `bytes` is null when there
 *   is no picture yet.
 */
export async function avatarFor(openId) {
  if (!openId) return { bytes: null, contentType: '', at: 0, url: '', error: '' }

  const meta = await readMeta()
  const bytes = meta && meta.openId === openId ? await readImage() : null

  if (bytes && bytes.length) {
    const age = Date.now() - (meta.at || 0)
    const failedRecently = meta.failedAt && Date.now() - meta.failedAt < RETRY
    if (age > TTL && !failedRecently) refresh(openId)
    return { bytes, contentType: meta.contentType || 'image/jpeg', at: meta.at || 0, url: meta.url || '', error: '' }
  }

  // Nothing usable on disk: the first open has to wait for the download.
  const fetched = await download(openId)
  if (fetched && fetched.bytes) {
    return { bytes: fetched.bytes, contentType: fetched.contentType, at: fetched.at, url: fetched.url, error: '' }
  }
  const error = (fetched && fetched.error) || 'avatar 获取失败'
  if (meta) {
    // Remember the failure so the next few opens do not retry a broken endpoint.
    try {
      await writeFile(META, JSON.stringify({ ...meta, failedAt: Date.now() }, null, 1))
    } catch (writeError) {
      /* the cache is an optimisation */
    }
  }
  return { bytes: null, contentType: '', at: (meta && meta.at) || 0, url: (meta && meta.url) || '', error }
}

/** Whatever picture is cached right now, without asking Feishu anything. */
export async function cachedAvatar() {
  const meta = await readMeta()
  const bytes = await readImage()
  if (!meta || !bytes || !bytes.length) return { bytes: null, contentType: '', at: 0 }
  return { bytes, contentType: meta.contentType || 'image/jpeg', at: meta.at || 0 }
}

/** When the cached picture was last confirmed with Feishu. */
export async function avatarUpdatedAt() {
  const meta = await readMeta()
  if (!meta) return 0
  try {
    const info = await stat(IMAGE)
    return info.size ? meta.at || 0 : 0
  } catch (error) {
    return 0
  }
}
