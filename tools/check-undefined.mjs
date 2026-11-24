#!/usr/bin/env node
/**
 * Fail when a file calls a function that is neither declared in it nor a known global.
 *
 * This is the check that would have caught two shipped regressions: a helper
 * renamed while call sites stayed behind (`docTarget is not defined`) and one
 * deleted outright (`nudgeTop is not defined`). `node --check` only parses, so it
 * sees neither.
 *
 *   node tools/check-undefined.mjs client.js index.js …
 *
 * It is deliberately textual rather than a real parser: comments, strings, template
 * literals and regex literals are blanked (keeping line numbers), declared names are
 * collected from functions, variables, destructuring and parameters, and every
 * remaining `name(` that is not one of those is reported.
 *
 * @author WaterLiu
 */
import { readFileSync } from 'node:fs'

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'new', 'delete',
  'void', 'in', 'of', 'else', 'try', 'do', 'case', 'throw', 'yield', 'super', 'import', 'class',
  'const', 'let', 'var', 'with', 'instanceof', 'async', 'static', 'get', 'set', 'using',
])

const GLOBALS = new Set([
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'console', 'JSON', 'Math', 'Number',
  'String', 'Boolean', 'Array', 'Object', 'Promise', 'Date', 'RegExp', 'Error', 'TypeError',
  'RangeError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Reflect', 'Proxy', 'BigInt',
  'Function', 'isFinite', 'isNaN', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'window', 'document', 'navigator',
  'localStorage', 'atob', 'btoa', 'structuredClone', 'reportError', 'URL', 'URLSearchParams',
  'Request', 'Response', 'Headers', 'Blob', 'FormData', 'AbortController', 'TextEncoder',
  'TextDecoder', 'NodeFilter', 'Range', 'WheelEvent', 'Event', 'MutationObserver',
  'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'Buffer', 'process', 'require',
  'module', 'exports', 'globalThis', 'Intl', 'AggregateError', 'FinalizationRegistry',
  'CSS', 'Highlight', 'CustomEvent', 'DOMParser', 'Notification', 'performance', 'crypto',
])

/** Characters that may precede a `/` that starts a regex literal. */
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '\n', ''])

/** Blank comments, strings, templates and regex literals, keeping line numbers. */
function blank(text) {
  let out = ''
  let i = 0
  let prev = ''
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]

    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i += 1 }
      continue
    }
    if (ch === '/' && next === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' '
        i += 1
      }
      out += '  '
      i += 2
      continue
    }
    if (ch === '/' && REGEX_PRECEDERS.has(prev)) {
      out += ' '
      i += 1
      let inClass = false
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue }
        if (text[i] === '[') inClass = true
        else if (text[i] === ']') inClass = false
        else if (text[i] === '/' && !inClass) { i += 1; break }
        else if (text[i] === '\n') break
        i += 1
      }
      out += ' '
      prev = '/'
      continue
    }
    // A spread (`...name(`) must not look like a property access to the call
    // regex below — blanking it keeps `pageFacts()` visible as a bare call.
    if (ch === '.' && next === '.' && text[i + 2] === '.') {
      out += '   '
      i += 3
      prev = '.'
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      out += ' '
      i += 1
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i += 1
        if (text[i] === '\n') out += '\n'
        i += 1
      }
      out += ' '
      i += 1
      prev = quote
      continue
    }

    out += ch
    if (ch !== ' ' && ch !== '\t' && ch !== '\n') prev = ch
    i += 1
  }
  return out
}

/** Every name the file may legally reference. */
function collectDeclared(text) {
  const declared = new Set()

  for (const m of text.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1])
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1])
  for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().replace(/=.*/, '').replace(/\.\.\./, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name)
    }
  }
  for (const m of text.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.replace(/=.*/, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name)
    }
  }
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(/\s+as\s+/).pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name)
    }
  }
  for (const m of text.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from/g)) {
    if (m[1]) declared.add(m[1])
    if (m[2]) declared.add(m[2])
  }
  // every parameter list we can see: functions, methods, arrows
  for (const m of text.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split('=')[0].replace(/[{}[\]…]/g, '').split(':').pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name)
    }
  }
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1])
  // Object/class member shorthand: `name(` at the start of a line. Deliberately
  // strict — a looser rule treated `{ ..., missingFn() }` as a method definition and
  // hid a genuinely undefined call.
  for (const m of text.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) declared.add(m[1])

  return declared
}

let failures = 0
for (const file of process.argv.slice(2)) {
  const text = blank(readFileSync(file, 'utf8'))
  const declared = collectDeclared(text)
  const missing = new Map()
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    for (const m of lines[index].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[1]
      if (KEYWORDS.has(name) || GLOBALS.has(name) || declared.has(name)) continue
      if (!missing.has(name)) missing.set(name, index + 1)
    }
  }
  if (missing.size) {
    failures += missing.size
    console.log(`${file}: ${[...missing].map(([name, line]) => `${name} (line ${line})`).join(', ')}`)
  } else {
    console.log(`${file}: ok`)
  }
}
if (failures) console.log(`\n${failures} undefined call(s)`)
process.exit(failures ? 1 : 0)
