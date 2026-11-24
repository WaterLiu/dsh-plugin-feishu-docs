#!/usr/bin/env node
/**
 * Generate `index.json` — a format-1 DSH plugin market index listing this bundle.
 *
 * A market index is one JSON file at an https URL; Discover reads it and installs
 * whatever it lists. This script derives the entry from the repository itself, so
 * the commit SHA and version are never transcribed by hand.
 *
 *   node tools/make-index.mjs            # git source, pinned to HEAD
 *   node tools/make-index.mjs --npm      # registry source instead
 *
 * Writes `index.json` beside the repository root.
 *
 * @author WaterLiu
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const args = new Set(process.argv.slice(2))
const useNpm = args.has('--npm')

/** `https://github.com/owner/repo` from `repository.url`, or fail. */
function repoUrl() {
  const raw = manifest.repository && (manifest.repository.url || manifest.repository)
  if (typeof raw !== 'string' || !raw) {
    throw new Error('package.json needs a repository.url, e.g. git+https://github.com/you/dsh-plugin-feishu-docs.git')
  }
  const cleaned = raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
  if (!/^https:\/\/[^/]+\/[^/]+\/[^/]+$/.test(cleaned)) {
    throw new Error(`repository.url must look like https://github.com/owner/repo, got ${raw}`)
  }
  return cleaned
}

const url = repoUrl()
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`not a full commit SHA: ${commit}`)
if (commit.startsWith('YOUR')) throw new Error('commit placeholder')

const index = {
  format: 1,
  title: { en: 'Feishu documents', zh: '飞书云文档' },
  description: {
    en: 'Feishu cloud documents of each session, listed from its own log.',
    zh: '按会话列出其消息中出现过的飞书云文档。',
  },
  metadata: {
    categories: {
      productivity: { title: { en: 'Productivity', zh: '效率' } },
      documents: { title: { en: 'Documents', zh: '文档' } },
    },
    labels: {
      feishu: { title: { en: 'Feishu', zh: '飞书' } },
      offline: { title: { en: 'Works offline', zh: '离线可用' } },
    },
  },
  plugins: [
    {
      name: manifest.name,
      title: {
        en: 'Feishu documents',
        zh: '飞书云文档',
      },
      description: {
        en: 'A ☁ chip in the session header listing the Feishu documents its messages mention, with creator and a jump to the turn.',
        zh: '会话标题栏的 ☁ 胶囊，列出该会话消息中出现的飞书文档，含创建者并可跳转到对应轮次。',
      },
      author: 'your-name',
      homepage: url,
      repository: { url },
      metadata: {
        category: 'documents',
        labels: ['feishu', 'offline'],
        keywords: ['feishu', 'lark', 'documents', 'session'],
      },
      versions: [
        {
          version: manifest.version,
          publishTimestamp: Math.floor(Date.now() / 1000),
          source: useNpm
            ? { type: 'npm' }
            : { type: 'git', url, commit, path: '.' },
          engines: { dsh: '>=0.2.0' },
        },
      ],
    },
  ],
}

// Mirrors the rules @deepseek-ai/dsh-plugin-market-index enforces, so a mistake
// surfaces here rather than in a reader's Discover tab.
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:\d*[a-zA-Z-][0-9a-zA-Z-]*|\d+)(?:\.(?:\d*[a-zA-Z-][0-9a-zA-Z-]*|\d+))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/
if (index.format !== 1) throw new Error('format must be 1')
if (!index.plugins.length) throw new Error('plugins must not be empty')
for (const plugin of index.plugins) {
  if (!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(plugin.name)) throw new Error(`bad package name ${plugin.name}`)
  if (!plugin.versions.length) throw new Error('versions must not be empty')
  for (const version of plugin.versions) {
    if (!SEMVER.test(version.version)) throw new Error(`not exact SemVer: ${version.version}`)
    if (!Number.isInteger(version.publishTimestamp) || version.publishTimestamp < 0) throw new Error('publishTimestamp must be integer seconds')
    if (version.source.type === 'git' && !/^[0-9a-f]{40}$/.test(version.source.commit)) throw new Error('git commit must be 40 lowercase hex')
  }
}

writeFileSync(join(ROOT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
console.log(`wrote index.json — ${manifest.name}@${manifest.version} (${useNpm ? 'npm' : `git ${commit.slice(0, 7)}`})`)
