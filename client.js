/**
 * Feishu documents for the Session on screen: a header chip and its popover.
 *
 * The chip sits in `conversation.session.header.utilities` and counts the
 * documents this Session touched; clicking it opens a popover anchored to the
 * chip, grouped by day, with each row's creator and a jump to the turn it
 * appeared in. Nothing here registers a right-sidebar tab.
 *
 * Both data and DOM contracts were verified against this build:
 * - the host half serves `/x-feishu-docs/index.json`;
 * - Chat rows carry `data-chat-turn="N"` (the input row also carries
 *   `data-chat-flow-kind="user"`), and `[data-conversation-scroll]` is the
 *   transcript scrollport;
 * - DSH exposes no public scroll-to-turn or switch-session API, so a row outside
 *   this Session copies a citation instead of navigating.
 */
/**
 * Best-effort beacon to the host half, so loading can be diagnosed headlessly.
 * Silent unless `localStorage['feishu-docs-debug'] === '1'`.
 */
function beacon(phase, extra) {
  try {
    if (localStorage.getItem('feishu-docs-debug') !== '1') return
  } catch (error) {
    return
  }
  try {
    const payload = encodeURIComponent(JSON.stringify({ phase, version: '2.8.3', ...(extra || {}) }))
    fetch(`/x-feishu-docs/log?d=${payload}`, { headers: { 'x-feishu-docs': 'popover' } }).catch(() => {})
  } catch (error) {
    /* ignore */
  }
}
/** Unconditional report, used only by the jump path (a handful of calls). */
function report(phase, extra) {
  try {
    const payload = encodeURIComponent(JSON.stringify({ phase, version: '2.8.3', ...(extra || {}) }))
    fetch(`/x-feishu-docs/log?d=${payload}`, { headers: { 'x-feishu-docs': 'popover' } }).catch(() => {})
  } catch (error) {
    /* ignore */
  }
}

beacon('module-eval')

window.__ModuleLoader__.load({
  // Must equal the package name: the host composes this bundle into a boot
  // graph row whose id is the package name, and the browser module system
  // materializes a row by looking up the factory registered under that id.
  id: 'dsh-plugin-feishu-docs',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo } = React

    /** Feishu-like glyph colours, one per document kind. */
    const TINT = {
      docx: '#3370FF',
      docs: '#3370FF',
      sheet: '#34C724',
      bitable: '#8E5CF7',
      wiki: '#4E83FD',
      slides: '#FF8800',
      mindnote: '#00C2A8',
    }

    /** Client context captured at apply, for actions a row triggers. */
    let pluginCtx = null

    /**
     * One Session's documents, read from that Session's own log on demand.
     *
     * The result is cached per Session so opening the popover twice does not
     * re-read the log, and invalidated when the popover opens so a document
     * mentioned a minute ago is already there.
     */
    const sessionCache = new Map()
    function loadSession(sessionId, force) {
      if (!sessionId) return Promise.resolve({ docs: [] })
      const cached = sessionCache.get(sessionId)
      if (cached && !force) return cached
      const request = fetch(`/x-feishu-docs/session.json?sid=${encodeURIComponent(sessionId)}&v=${Date.now()}`, { cache: 'no-store' })
        .then((r) => r.json())
        .catch((error) => ({ error: String(error), docs: [] }))
      sessionCache.set(sessionId, request)
      return request
    }

    /**
     * One 16×16 glyph per document kind, drawn from primitives so no external
     * artwork is needed: a page for documents, a grid for tables, a book for the
     * wiki, a slide frame, and a node graph for mind notes.
     */
    function TypeIcon(props) {
      const kind = props.type
      const tint = TINT[kind] || '#8A9099'
      const common = {
        width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true,
        style: { flex: 'none', display: 'block', marginTop: 1 },
      }

      if (kind === 'sheet') {
        return h('svg', common,
          h('rect', { x: 2.2, y: 2.2, width: 11.6, height: 11.6, rx: 2, fill: tint, opacity: 0.14 }),
          h('rect', { x: 2.2, y: 2.2, width: 11.6, height: 11.6, rx: 2, stroke: tint, strokeWidth: 1.2, fill: 'none' }),
          h('path', { d: 'M2.6 6.2h10.8M2.6 10h10.8M6.2 2.6v10.8M10 2.6v10.8', stroke: tint, strokeWidth: 1, opacity: 0.85 }),
        )
      }
      if (kind === 'bitable') {
        return h('svg', common,
          h('rect', { x: 2.2, y: 2.2, width: 11.6, height: 11.6, rx: 2, fill: tint, opacity: 0.14 }),
          h('rect', { x: 2.2, y: 2.2, width: 11.6, height: 11.6, rx: 2, stroke: tint, strokeWidth: 1.2, fill: 'none' }),
          h('path', { d: 'M2.6 5.8h10.8M6.4 2.6v10.8', stroke: tint, strokeWidth: 1, opacity: 0.85 }),
          h('circle', { cx: 9.6, cy: 9.4, r: 1.5, fill: tint }),
        )
      }
      if (kind === 'wiki') {
        return h('svg', common,
          h('path', { d: 'M3 3.4c0-.6.5-1.1 1.1-1.1h7.8c.6 0 1.1.5 1.1 1.1v9.2c0 .6-.5 1.1-1.1 1.1H4.1c-.6 0-1.1-.5-1.1-1.1z', fill: tint, opacity: 0.14 }),
          h('path', { d: 'M3 3.4c0-.6.5-1.1 1.1-1.1h7.8c.6 0 1.1.5 1.1 1.1v9.2c0 .6-.5 1.1-1.1 1.1H4.1c-.6 0-1.1-.5-1.1-1.1z', stroke: tint, strokeWidth: 1.2, fill: 'none' }),
          h('path', { d: 'M5.2 2.5v11', stroke: tint, strokeWidth: 1.2, opacity: 0.9 }),
          h('path', { d: 'M7.2 5.6h3.2M7.2 8.2h3.2', stroke: tint, strokeWidth: 1, opacity: 0.75 }),
        )
      }
      if (kind === 'slides') {
        return h('svg', common,
          h('rect', { x: 1.8, y: 3, width: 12.4, height: 8.6, rx: 1.8, fill: tint, opacity: 0.14 }),
          h('rect', { x: 1.8, y: 3, width: 12.4, height: 8.6, rx: 1.8, stroke: tint, strokeWidth: 1.2, fill: 'none' }),
          h('path', { d: 'M6.4 5.6l3.6 1.9-3.6 1.9z', fill: tint }),
          h('path', { d: 'M5.6 13.2h4.8', stroke: tint, strokeWidth: 1.2, strokeLinecap: 'round' }),
        )
      }
      if (kind === 'mindnote') {
        return h('svg', common,
          h('circle', { cx: 8, cy: 8, r: 5.6, fill: tint, opacity: 0.14 }),
          h('circle', { cx: 8, cy: 8, r: 1.7, fill: tint }),
          h('circle', { cx: 3.6, cy: 4.4, r: 1.2, fill: tint, opacity: 0.9 }),
          h('circle', { cx: 12.4, cy: 4.4, r: 1.2, fill: tint, opacity: 0.9 }),
          h('circle', { cx: 12.4, cy: 11.6, r: 1.2, fill: tint, opacity: 0.9 }),
          h('path', { d: 'M4.6 5.3l2 1.6M11.4 5.3l-2 1.6M11.4 10.7l-2.1-1.6', stroke: tint, strokeWidth: 1, opacity: 0.6 }),
        )
      }
      return h('svg', common,
        h('path', { d: 'M4 2.2h5l3 3v8.6c0 .5-.4.9-.9.9H4c-.5 0-.9-.4-.9-.9V3.1c0-.5.4-.9.9-.9z', fill: tint, opacity: 0.14 }),
        h('path', { d: 'M4 2.2h5l3 3v8.6c0 .5-.4.9-.9.9H4c-.5 0-.9-.4-.9-.9V3.1c0-.5.4-.9.9-.9z', stroke: tint, strokeWidth: 1.2, fill: 'none' }),
        h('path', { d: 'M9 2.4v3h3', stroke: tint, strokeWidth: 1.1, fill: 'none', opacity: 0.9 }),
        h('path', { d: 'M4.9 7.4h5.6M4.9 9.6h5.6M4.9 11.8h3.4', stroke: tint, strokeWidth: 1, opacity: 0.8 }),
      )
    }

    /** 12×12 「enter」 glyph: an arrow crossing into a bracket, as the jump action. */
    function JumpIcon() {
      return h('svg', {
        width: 13, height: 13, viewBox: '0 0 12 12', 'aria-hidden': true,
        style: { flex: 'none', display: 'block' },
      },
        // The bracket the arrow enters.
        h('path', {
          d: 'M8.6 2.2h1.1a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1H8.6',
          stroke: 'currentColor', strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round',
        }),
        // The arrow.
        h('path', {
          d: 'M1.4 6h5.6M4.9 3.9 7 6l-2.1 2.1',
          stroke: 'currentColor', strokeWidth: 1.2, fill: 'none',
          strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      )
    }

    /** 14×14 cloud glyph for the header chip. */
    function CloudIcon() {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true,
        style: { flex: 'none', display: 'block' },
      },
        h('path', {
          d: 'M4.6 12.2a2.9 2.9 0 0 1-.3-5.8 3.9 3.9 0 0 1 7.4.9 2.5 2.5 0 0 1-.4 4.9z',
          stroke: 'currentColor', strokeWidth: 1.3, fill: 'none', strokeLinejoin: 'round',
        }),
      )
    }

    function dayLabel(day) {
      if (!day) return '未知日期'
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      if (day === today) return '今天'
      const [, m, d] = day.split('-')
      return `${Number(m)}月${Number(d)}日`
    }

    /** The transcript scrollport (Chat's own container). */
    function transcript() {
      return document.querySelector('[data-conversation-scroll]')
    }

    /** What the page currently has, for the jump report. */
    function pageFacts() {
      const turns = [...document.querySelectorAll('[data-chat-turn]')]
        .map((el) => Number(el.getAttribute('data-chat-turn')))
        .filter((v) => !Number.isNaN(v))
      const scroller = transcript()
      return {
        rows: turns.length,
        minTurn: turns.length ? Math.min(...turns) : null,
        maxTurn: turns.length ? Math.max(...turns) : null,
        scroller: Boolean(scroller),
        scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
        scrollHeight: scroller ? scroller.scrollHeight : null,
        clientHeight: scroller ? scroller.clientHeight : null,
      }
    }

    /** A row that actually occupies space; paging anchors have zero height. */
    function isVisibleRow(el) {
      if (!el) return false
      try {
        const box = el.getBoundingClientRect()
        return box.height > 4 && box.width > 4
      } catch (error) {
        return false
      }
    }

    /** The row of one turn, preferring the turn's own input row. */
    function findTurnRow(turn) {
      const n = Number(turn)
      if (!n) return null
      const rows = [...document.querySelectorAll(`[data-chat-turn="${n}"]`)].filter(isVisibleRow)
      if (!rows.length) return null
      return rows.find((el) => el.getAttribute('data-chat-flow-kind') === 'user') || rows[0]
    }

    /**
     * The row where the document actually appeared.
     *
     * The turn's input row is only its opening line; a turn here can span
     * hundreds of rows, so a document mentioned in a later tool result is far
     * from it. Chat node keys embed the message identity, which the index keeps
     * per document, so that row can be found exactly.
     *
     * @param doc - index row with `turn` and optional `mid`.
     * @returns the exact row when found, else the turn's input row.
     */
    function findDocRow(doc) {
      // A tool row is keyed by its callId; a message row by its message id.
      const ids = [doc && doc.cid, doc && doc.mid].filter(Boolean)
      for (const id of ids) {
        for (const attr of ['data-chat-node-key', 'data-chat-anchor-key', 'data-chat-flow-key']) {
          let el = null
          try {
            el = document.querySelector(`[${attr}*="${id}"]`)
          } catch (error) {
            el = null
          }
          if (isVisibleRow(el)) return el
        }
      }
      return findTurnRow(doc && doc.turn)
    }

    /** Collapse whitespace and quotes so titles compare across renderings. */
    function normalize(text) {
      return String(text || '').replace(/[\s"'「」『』《》|]+/g, '')
    }

    /**
     * The row that actually mentions the document.
     *
     * Keys are unreliable (a tool row's key may carry a call id, not the message
     * id) and the transcript virtualizes, so this falls back to the document's
     * own title: scan the turn's mounted rows, then scroll through the turn until
     * the row carrying that title is mounted.
     *
     * @param doc - index row with `turn`, `t` and optional `mid`.
     * @param onProgress - called with the scroll step while searching.
     * @returns the matching row, or the turn's input row.
     */
    async function findDocRowDeep(doc, onProgress) {
      const exact = findDocRow(doc)
      const key = doc && (doc.cid || doc.mid)
      if (exact && key) {
        const nodeKey = String(exact.getAttribute('data-chat-node-key') || exact.getAttribute('data-chat-anchor-key') || '')
        if (nodeKey.includes(key)) return exact
      }

      const needle = normalize(doc && doc.t).slice(0, 20)
      const turn = Number(doc && doc.turn)
      const scan = () => {
        if (!needle) return null
        const rows = [...document.querySelectorAll(`[data-chat-turn="${turn}"]`)].filter(isVisibleRow)
        return rows.find((row) => normalize(row.textContent).includes(needle)) || null
      }

      const mounted = scan()
      if (mounted) return mounted

      const first = findTurnRow(turn)
      if (!first) return null
      revealRow(first)
      await new Promise((resolve) => window.setTimeout(resolve, 120))

      for (let step = 0; step < 12; step += 1) {
        const found = scan()
        if (found) return found
        onProgress?.(step + 1)
        const scroller = transcript()
        if (!scroller) break
        const before = scroller.scrollTop
        scroller.scrollTop = Math.min(before + Math.round(scroller.clientHeight * 0.7), scroller.scrollHeight)
        await new Promise((resolve) => window.setTimeout(resolve, 120))
        if (scroller.scrollTop === before) break
        const turns = [...document.querySelectorAll('[data-chat-turn]')]
          .map((el) => Number(el.getAttribute('data-chat-turn')))
          .filter((v) => !Number.isNaN(v))
        if (turns.length && Math.min(...turns) > turn) break
      }
      return findTurnRow(turn)
    }

    /**
     * Centre one row inside the transcript.
     *
     * `scrollIntoView` is unreliable here: the transcript clips overflow and the
     * row can sit inside nested scroll containers, so the call may scroll some
     * other ancestor — or nothing at all. Computing the offset against the
     * transcript's own scrollport and assigning `scrollTop` is explicit.
     *
     * @param row - the element to centre.
     * @returns whether the viewport actually moved.
     */
    /** One injected stylesheet for the document mark. */
    let markStyles = false
    function ensureMarkStyles() {
      if (markStyles) return
      markStyles = true
      try {
        const style = document.createElement('style')
        style.textContent = `
          .fd-doc-hit { background: color-mix(in srgb, #FFB020 38%, transparent) !important;
                        border-radius: 4px; box-decoration-break: clone;
                        box-shadow: 0 0 0 2px color-mix(in srgb, #FFB020 50%, transparent);
                        transition: background .35s ease, box-shadow .35s ease; }
          @keyframes fd-doc-hit-pulse {
            from { box-shadow: 0 0 0 2px color-mix(in srgb, #FFB020 60%, transparent); }
            to { box-shadow: 0 0 0 8px transparent; }
          }
          .fd-doc-hit[data-fresh] { animation: fd-doc-hit-pulse .8s ease-out 2; }
          .fd-doc-hit[data-out] { background: transparent !important; box-shadow: 0 0 0 2px transparent; }
        `
        document.head.appendChild(style)
      } catch (error) {
        /* styling is best effort */
      }
    }

    /** The row DSH rendered for one message id, when it is mounted. */
    function rowByMessageId(mid) {
      if (!mid) return null
      try {
        return document.querySelector(`[data-chat-node-key*="${mid}"], [data-chat-anchor-key*="${mid}"]`)
      } catch (error) {
        return null
      }
    }

    
    /** The marked elements, and the timers that keep and retire the mark. */
    let marked = []
    let markTimer = null
    let markHold = null
    let markKey = null

    /** How long the mark stays once it is on screen, and how long we hunt for it. */
    const MARK_HOLD = 2000
    const MARK_LOOK = 4000
    const MARK_FADE = 380

    /** A container this tall is a message, not the document inside it. */
    const MARK_MAX_HEIGHT = 120

    /** Remove the mark and every timer/listener it installed. */
    function clearDocMark() {
      if (markTimer) {
        window.clearInterval(markTimer)
        markTimer = null
      }
      if (markHold) {
        window.clearTimeout(markHold)
        markHold = null
      }
      if (markKey) {
        window.removeEventListener('keydown', markKey, true)
        markKey = null
      }
      for (const el of marked) {
        el.classList.remove('fd-doc-hit')
        delete el.dataset.fresh
        delete el.dataset.out
      }
      // Anything a re-render duplicated keeps its class; sweep the document.
      for (const el of document.querySelectorAll('.fd-doc-hit')) {
        el.classList.remove('fd-doc-hit')
        delete el.dataset.fresh
        delete el.dataset.out
      }
      marked = []
    }

    /**
     * The element that shows a document, tight enough to paint.
     *
     * A link is the best target — it is the document, it is small, and it scrolls
     * with the message, so no coordinates are involved at all. Without a link, the
     * first text node holding the token is used, provided its parent is a line and
     * not the whole message. Code is skipped: a URL inside a fence or backticks is
     * a log line, not the document the chat shows.
     *
     * @param doc - the document the jump targeted.
     * @returns an element, or null when nothing tight enough exists.
     */
    function docElement(doc) {
      const token = String((doc && doc.u) || '').split('/').pop()
      if (!token) return null
      const root = transcript() || document
      const holds = (el) => {
        const href = el.getAttribute && el.getAttribute('href')
        return Boolean((href && href.includes(token)) || (el.textContent || '').includes(token))
      }

      // 1. The exact message that first showed it, by message id.
      const first = rowByMessageId(doc && doc.mid)
      if (first) {
        const anchor = [...first.querySelectorAll('a[href]')].find(holds)
        if (anchor) return anchor
      }

      // 2. Any link in the transcript, in document order (the earliest mention).
      const link = [...root.querySelectorAll('a[href]')].find(holds)
      if (link) return link

      // 3. Text without a link: the line that carries it.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue || !node.nodeValue.includes(token)) continue
        const host = node.parentElement
        if (!host || host.closest('pre, code')) continue
        const box = host.getBoundingClientRect()
        if (box.height > MARK_MAX_HEIGHT || box.width < 4) continue
        return host
      }
      return null
    }

    /** Fade the mark out, then forget it. */
    function fadeDocMark() {
      for (const el of marked) el.dataset.out = ''
      markHold = window.setTimeout(clearDocMark, MARK_FADE)
    }

    /**
     * Highlight the document inside the message it first appears in.
     *
     * The mark is a class on the element itself, so it cannot drift away from the
     * text: it moves with the message, survives scrolling, and needs no geometry.
     * A re-render replaces the element, so the mark is re-applied while it is up.
     *
     * @param doc - the document the jump targeted.
     */
    function markDocument(doc) {
      clearDocMark()
      ensureMarkStyles()

      const token = String((doc && doc.u) || '').split('/').pop()
      const deadline = Date.now() + MARK_LOOK
      let reported = false
      let holding = false

      const paint = () => {
        if (holding && marked.length && marked.every((el) => el.isConnected && el.classList.contains('fd-doc-hit'))) return
        const el = docElement(doc)
        if (!el) {
          if (Date.now() > deadline) {
            if (!reported) report('mark-miss', { token, turn: doc && doc.turn, mid: Boolean(doc && doc.mid) })
            clearDocMark()
          }
          return
        }
        if (!marked.includes(el)) marked.push(el)
        // Marked but off-screen helps nobody: bring the element into view when the
        // jump's own scroll did not manage it.
        const box = el.getBoundingClientRect()
        if (box.height > 4 && (box.bottom < 0 || box.top > window.innerHeight)) {
          try { el.scrollIntoView({ block: 'center', behavior: 'auto' }) } catch (error) { /* ignore */ }
        }
        el.classList.add('fd-doc-hit')
        if (!el.dataset.fresh) el.dataset.fresh = ''
        if (!reported) {
          reported = true
          report('mark', { token, tag: el.tagName, turn: doc && doc.turn, mid: Boolean(doc && doc.mid) })
        }
        if (!holding) {
          holding = true
          markHold = window.setTimeout(fadeDocMark, MARK_HOLD)
        }
      }

      paint()
      markTimer = window.setInterval(paint, 250)

      const onKey = (event) => {
        if (event.key === 'Escape') clearDocMark()
      }
      markKey = onKey
      window.addEventListener('keydown', onKey, true)
    }


    /**
     * Centre one visible row.
     *
     * The transcript follows its tail while the reader is at the bottom, and that
     * follow logic overwrites `scrollTop` on the next frame. A synthetic wheel
     * gesture hands ownership back to the reader first; the offset is then
     * applied up to three times, reporting what the container actually did.
     *
     * @param row - the visible element to centre.
     * @returns whether the container ended up moving.
     */
    /** The nearest scrollable ancestor of a row, else the transcript itself. */
    function scrollerFor(row) {
      let parent = row && row.parentElement
      for (let depth = 0; parent && depth < 12; depth += 1) {
        if (parent.scrollHeight > parent.clientHeight + 4) return parent
        parent = parent.parentElement
      }
      return transcript()
    }

    /**
     * Nudge the transcript to its top so the app's own infinite scroll loads more.
     *
     * The last resort in {@link loadOlderOnce}: upstream called this without ever
     * defining it, so paging history threw `nudgeTop is not defined` — the path only
     * reached when a jump has to load older messages.
     *
     * @returns whether anything moved.
     */
    function nudgeTop() {
      const scroller = transcript()
      if (!scroller) return false
      const before = scroller.scrollTop
      try {
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }))
      } catch (error) {
        /* no WheelEvent in this engine */
      }
      scroller.scrollTop = 0
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      return Math.abs(scroller.scrollTop - before) > 2
    }

    /**
     * Scroll one element into the middle of the transcript.
     *
     * Two candidate scrollers are tried in turn: the element DSH documents as the
     * transcript (`[data-conversation-scroll]`), then the nearest scrollable
     * ancestor of the row. Either can be the real one depending on the layout, and
     * guessing wrong is what "第 N 轮已就位，但页面没能滚动" actually reported.
     *
     * @param row - the element to centre.
     * @returns whether the page actually moved.
     */
    async function revealRow(row, doc) {
      const tryScroll = async (scroller) => {
        if (!scroller) return false
        const before = scroller.scrollTop
        const centre = () => {
          const box = row.getBoundingClientRect()
          const port = scroller.getBoundingClientRect()
          scroller.scrollTop += box.top - port.top + box.height / 2 - port.height / 2
          scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
        }

        const seen = []
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          centre()
          await new Promise((resolve) => window.setTimeout(resolve, 90))
          seen.push(Math.round(scroller.scrollTop))
          if (Math.abs(scroller.scrollTop - before) > 2) break
          // Escalate: the browser's own scroll, then a hard assignment.
          try { row.scrollIntoView({ block: 'center', behavior: 'auto' }) } catch (error) { /* ignore */ }
          if (attempt === 2) {
            const box = row.getBoundingClientRect()
            const port = scroller.getBoundingClientRect()
            const target = scroller.scrollTop + (box.top - port.top) - port.height / 3
            scroller.scrollTop = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight))
          }
        }

        const moved = Math.abs(scroller.scrollTop - before) > 2
        report('reveal', {
          before: Math.round(before), after: Math.round(scroller.scrollTop), seen, moved,
          rowHeight: Math.round(row.getBoundingClientRect().height),
          isTranscript: scroller === transcript(),
        })
        return moved
      }

      const primary = transcript()
      const fallback = scrollerFor(row)
      if (!primary && !fallback) return false
      if (await tryScroll(primary)) return true
      if (fallback && fallback !== primary && await tryScroll(fallback)) return true

      // Neither scrolled: the row may simply already be in place, which is not a
      // failure. Report it as settled so the caller does not claim otherwise.
      const box = row.getBoundingClientRect()
      return box.height > 4 && box.bottom > 0 && box.top < window.innerHeight
    }

    /** The transcript's own "load earlier" control, when history remains. */
    function historyButton() {
      const host = document.querySelector('[data-chat-history]')
      const button = host && host.querySelector('button')
      return button && !button.disabled ? button : null
    }

    async function loadOlderOnce() {
      // The transcript's own control is the dependable path: it is what a reader
      // would press, and it reports progress through `data-chat-history`.
      const button = historyButton()
      if (button) {
        button.click()
        report('jump-click-older', { state: document.querySelector('[data-chat-history]')?.getAttribute('data-chat-history') })
        return true
      }

      let settled = false
      let failure = ''
      try {
        // Reading the scope-addressed service can itself throw for a context
        // without a Session tag, so the access belongs inside this guard.
        const api = pluginCtx && pluginCtx.conversation
        if (api && typeof api.loadOlder === 'function') {
          await Promise.race([
            Promise.resolve(api.loadOlder()).then(() => { settled = true }),
            new Promise((resolve) => window.setTimeout(resolve, 1200)),
          ])
        }
      } catch (error) {
        failure = String(error)
      }
      report('jump-loadolder', { settled, failure })
      if (settled) return true
      const nudged = nudgeTop()
      report('jump-nudge', { nudged })
      return nudged
    }

    /**
     * Page history back until the given turn renders.
     *
     * @param turn - 1-based turn number from the index.
     * @param onProgress - called with the attempt count while loading.
     * @returns the row, or null when history runs out.
     */
    async function ensureTurnLoaded(turn, onProgress) {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const row = findTurnRow(turn)
        if (row) { report('jump-found', { attempt, ...pageFacts() }); return row }
        onProgress?.(attempt + 1)
        report('jump-attempt', { attempt: attempt + 1, turn, ...pageFacts() })
        await loadOlderOnce()
        await new Promise((resolve) => window.setTimeout(resolve, 260))
      }
      const last = findTurnRow(turn)
      report('jump-exhausted', { turn, found: Boolean(last), ...pageFacts() })
      return last
    }

    /** Sessions whose history has already been paged to the top. */
    const pagedToTop = new Set()

    
    /**
     * Bring the first mention of a document into the DOM.
     *
     * The transcript is windowed, so the earliest mention is usually not mounted
     * when the popover opens. Paging back until the recorded message id appears is
     * the only way to be sure a jump lands on the *first* mention; searching for
     * "some visible link" finds the nearest later copy instead.
     *
     * @param doc - the document, carrying `mid` (first message) and `turn`.
     * @param onProgress - called with the attempt count while paging.
     * @returns the element to scroll to, or null when history runs out.
     */
    async function ensureFirstMention(doc, onProgress, sessionId) {
      // The earliest mention can only be known once nothing older remains: the
      // transcript is windowed, so any link found before that is merely the
      // earliest *loaded* copy. Paging to the top once per Session is what makes
      // "第一个出现的位置" a fact rather than a guess.
      if (sessionId && !pagedToTop.has(sessionId)) {
        let reachedTop = false
        for (let attempt = 0; attempt < 60; attempt += 1) {
          // The recorded message id is proof enough: once that row exists, nothing
          // older needs loading. Only a build whose row keys lack the id has to be
          // paged all the way back.
          if (attempt > 0 && rowByMessageId(doc.mid)) break
          onProgress?.(attempt + 1)
          const more = await loadOlderOnce()
          await new Promise((resolve) => window.setTimeout(resolve, 180))
          if (!more) {
            reachedTop = true
            break
          }
        }
        // Only a Session actually paged to the start may skip this next time.
        if (reachedTop) pagedToTop.add(sessionId)
        report('jump-paged', { sessionId, reachedTop })
      }

      // After paging to the start, "first in document order" is the first mention
      // by definition — and `docElement` also handles a mention rendered as text.
      return rowByMessageId(doc.mid) || findTurnRow(doc.turn) || docElement(doc)
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {})
        return
      }
      const box = document.createElement('textarea')
      box.value = text
      box.style.position = 'fixed'
      box.style.opacity = '0'
      document.body.appendChild(box)
      box.select()
      try { document.execCommand('copy') } catch (error) { /* clipboard unavailable */ }
      document.body.removeChild(box)
    }

    /**
     * The icon-only jump control: hovering or focusing it shows the specific
     * target right away — a native `title` would wait a second and cannot show
     * the day or the creator.
     */
    function JumpButton(props) {
      const { doc, onTrigger } = props
      const ref = React.useRef(null)
      const [tip, setTip] = useState(null)
      const who = doc.by ? ` · ${doc.by} 创建` : ''
      const label = `跳到第 ${doc.turn || '?'} 轮${doc.hm ? ` · ${doc.hm}` : ''}${who}`

      const show = () => {
        const box = ref.current && ref.current.getBoundingClientRect()
        if (!box) return
        const center = box.left + box.width / 2
        setTip({ top: box.top - 8, left: Math.min(window.innerWidth - 12, Math.max(12, center)) })
      }

      return h('span', { style: { display: 'inline-flex' } },
        h('button', {
          ref, className: 'fd-jump', type: 'button', 'aria-label': label,
          onMouseEnter: show, onMouseLeave: () => setTip(null),
          onFocus: show, onBlur: () => setTip(null),
          onClick: (e) => { e.preventDefault(); e.stopPropagation(); setTip(null); onTrigger() },
        }, h(JumpIcon, null)),
        tip
          ? h('div', { className: 'fd-tip', role: 'tooltip', style: { top: `${tip.top}px`, left: `${tip.left}px` } }, label)
          : null,
      )
    }

    /**
     * Header chip plus its popover: the Session's documents, where the
     * conversation is, so no cross-Session navigation is involved.
     */
    /**
     * Read a JSON body without throwing.
     *
     * The host answers some requests with an empty body (a method it does not
     * accept, a route mismatch), and `response.json()` turns that into a
     * SyntaxError the user cannot act on.
     */
    async function readJson(response) {
      const text = await response.text()
      try {
        return JSON.parse(text)
      } catch (error) {
        return { error: text ? `响应异常（HTTP ${response.status}）` : `响应为空（HTTP ${response.status}）` }
      }
    }

    /** Magnifier for the search field. */
    function SearchIcon() {
      return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': true, style: { flex: 'none', opacity: 0.55 } },
        h('circle', { cx: 7, cy: 7, r: 4.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M10.2 10.2 13.4 13.4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
      )
    }

    /** Chevron for the creator select. */
    function CaretIcon() {
      return h('svg', { width: 10, height: 10, viewBox: '0 0 16 16', 'aria-hidden': true, style: { flex: 'none', opacity: 0.5 } },
        h('path', { d: 'M4 6.2 8 10.2 12 6.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /**
     * What the popover shows when there is nothing to list.
     *
     * One centred block instead of a header saying "0 篇", a bare line of text and
     * a footer about clicking things that are not there.
     */
    function EmptyState(props) {
      const state = (props && props.state) || 'empty'
      const title = state === 'loading' ? '读取中…' : state === 'error' ? '读取会话记录失败' : '这个会话还没有飞书文档'
      const hint = state === 'loading'
        ? ''
        : state === 'error'
          ? '稍后重新打开浮层再试一次'
          : '对话里出现飞书链接后，会自动收录到这里'
      return h('div', { className: 'fd-empty' },
        h('svg', {
          className: 'fd-empty-icon', width: 30, height: 30, viewBox: '0 0 16 16', 'aria-hidden': true,
        },
          h('path', {
            d: 'M4.6 12.2a2.9 2.9 0 0 1-.3-5.8 3.9 3.9 0 0 1 7.4.9 2.5 2.5 0 0 1-.4 4.9z',
            stroke: 'currentColor', strokeWidth: 1.1, fill: 'none',
            strokeLinejoin: 'round', strokeLinecap: 'round',
          }),
        ),
        h('div', { className: 'fd-empty-title' }, title),
        hint ? h('div', { className: 'fd-empty-hint' }, hint) : null,
      )
    }

    /** A small amber badge for the "still needs something" card. */
    function WarnIcon() {
      return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': true, style: { flex: 'none' } },
        h('path', { d: 'M8 1.8 15 14H1z', fill: 'none', stroke: '#B26B00', strokeWidth: 1.3, strokeLinejoin: 'round' }),
        h('path', { d: 'M8 6.2v3.4', stroke: '#B26B00', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('circle', { cx: 8, cy: 11.6, r: 0.85, fill: '#B26B00' }),
      )
    }

    /** The placeholder shown in the avatar slot while nobody is signed in. */
    function UserGlyph(props) {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': true,
        style: { display: 'block', opacity: props && props.dim ? 0.7 : 1 },
      },
        h('circle', { cx: 8, cy: 5.4, r: 2.7, fill: 'currentColor', opacity: 0.85 }),
        h('path', { d: 'M2.6 14.2c0-2.6 2.4-4.3 5.4-4.3s5.4 1.7 5.4 4.3z', fill: 'currentColor', opacity: 0.85 }),
      )
    }

    /** One character for a user whose avatar Feishu would not hand over. */
    function initialOf(name) {
      const text = String(name || '').trim()
      return text ? Array.from(text)[0].toUpperCase() : '飞'
    }

    /**
     * Wrap the parts of `text` that match `needle` in a <mark>.
     *
     * Index-based rather than regex-based so a query full of `.*+?` is matched
     * literally, and `needle` arrives already lowercased by the caller.
     *
     * @param text - what the row displays.
     * @param needle - lowercased query.
     * @returns a string, or an array of strings and <mark> elements.
     */
    function highlight(text, needle) {
      const raw = String(text || '')
      if (!needle) return raw
      const haystack = raw.toLowerCase()
      if (!haystack.includes(needle)) return raw
      const parts = []
      let from = 0
      for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, from)) {
        if (at > from) parts.push(raw.slice(from, at))
        parts.push(h('mark', { className: 'fd-hit', key: `hit-${at}` }, raw.slice(at, at + needle.length)))
        from = at + needle.length
      }
      if (from < raw.length) parts.push(raw.slice(from))
      return parts
    }

    /** An unresolved owner is shown as its id, shortened so it cannot eat the row. */
    function shortBy(by) {
      const text = String(by || '')
      if (!text.startsWith('ou_') || text.length <= 16) return text
      return `${text.slice(0, 11)}…${text.slice(-4)}`
    }

    function HeaderChip(props) {
      const fullId = String((props && (props.sessionId || (props.standard && props.standard.sessionId))) || '')
      const shortId = fullId.slice(0, 20)
      const [data, setData] = useState(null)
      const [doctor, setDoctor] = useState(null)
      const [authFlow, setAuthFlow] = useState({ busy: false, url: '', deviceCode: '', error: '' })
      const [logoutAsk, setLogoutAsk] = useState(false)
      const [avatarBroken, setAvatarBroken] = useState(false)
      const [query, setQuery] = useState('')
      const [creator, setCreator] = useState('')
      // The log version this list was built from, so a poll can say "nothing new".
      const revRef = React.useRef('')
      const applyData = (next) => {
        revRef.current = (next && next.rev) || ''
        setData(next)
      }
      const [open, setOpen] = useState(false)
      const [rect, setRect] = useState(null)
      const [note, setNote] = useState('')
      const chipRef = React.useRef(null)
      const popRef = React.useRef(null)
      const renderBeaconed = React.useRef(0)

      // A different Session is a different list: an old query would filter it
      // against documents it was never about.
      useEffect(() => {
        setQuery('')
        setCreator('')
        // A mark belongs to the Session it was drawn in.
        clearDocMark()
      }, [fullId])

      /**
       * Ask the host whether this Session's log grew.
       *
       * The host answers `{ unchanged }` from a stat, so this is cheap enough to
       * poll; the list and the chip number then follow new messages on their own
       * instead of waiting for the popover to be reopened.
       */
      const pullSession = async () => {
        if (!fullId) return
        try {
          const answer = await readJson(await fetch(`/x-feishu-docs/session.json?sid=${encodeURIComponent(fullId)}&rev=${encodeURIComponent(revRef.current)}&v=${Date.now()}`, { cache: 'no-store' }))
          if (answer.unchanged) return
          if (Array.isArray(answer.docs)) applyData(answer)
        } catch (error) {
          /* a dropped poll is not worth surfacing */
        }
      }

      useEffect(() => {
        if (!fullId) return undefined
        // Faster while the list is on screen, gentler in the background; both only
        // cost a stat until the log actually changes.
        const timer = window.setInterval(pullSession, open ? 2500 : 6000)
        return () => window.clearInterval(timer)
      }, [fullId, open])

      /** Re-read readiness, so a first run and a lapsed login both surface here. */
      const refreshDoctor = () => fetch('/x-feishu-docs/doctor.json', { cache: 'no-store' })
        .then((r) => r.json())
        .then((report) => setDoctor(report))
        .catch(() => {})

      useEffect(() => { refreshDoctor() }, [])

      // Opening the popover re-checks readiness and re-reads this Session, so a
      // document mentioned a minute ago, or a scope granted a minute ago, shows up.
      useEffect(() => {
        if (!open) return undefined
        refreshDoctor()
        let alive = true
        loadSession(fullId, true).then((d) => { if (alive) applyData(d) }).catch(() => {})
        return () => { alive = false }
      }, [open, fullId])

      /** Start the device-code login and show the link the user must open. */
      const startAuth = async (scopes) => {
        setAuthFlow({ busy: true, url: '', deviceCode: '', error: '' })
        try {
          const wanted = Array.isArray(scopes) && scopes.length ? scopes.join(',') : ''
          const answer = await readJson(await fetch(`/x-feishu-docs/auth/start?scopes=${encodeURIComponent(wanted)}`, {
            headers: { 'x-feishu-docs': 'popover' },
            cache: 'no-store',
          }))
          if (!answer.url) {
            setAuthFlow({ busy: false, url: '', deviceCode: '', error: answer.error || '发起授权失败' })
            return
          }
          setAuthFlow({ busy: true, url: answer.url, deviceCode: answer.deviceCode, error: '' })
          try { window.open(answer.url, '_blank', 'noreferrer') } catch (error) { /* the link is shown anyway */ }
          pollAuth(answer.deviceCode)
        } catch (error) {
          setAuthFlow({ busy: false, url: '', deviceCode: '', error: String(error) })
        }
      }

      /** Stop the authorization poll (done, expired, or the chip unmounted). */
      const pollRef = React.useRef(null)
      const stopPolling = () => {
        if (pollRef.current) {
          window.clearTimeout(pollRef.current)
          pollRef.current = null
        }
      }
      useEffect(() => stopPolling, [])

      /** Everything the popover must re-read once the token exists. */
      const afterAuth = () => {
        flash('飞书授权完成', 2600)
        refreshDoctor()
        loadSession(fullId, true).then(applyData).catch(() => {})
      }

      /**
       * Keep asking the host whether the device flow finished.
       *
       * The user is in a browser tab; nothing here is a click away, so the popover
       * polls instead of asking them to come back and press a button.
       */
      const pollAuth = (deviceCode) => {
        stopPolling()
        if (!deviceCode) return
        const deadline = Date.now() + 5 * 60 * 1000
        const tick = async () => {
          pollRef.current = null
          if (Date.now() > deadline) {
            setAuthFlow({ busy: false, url: '', deviceCode: '', error: '授权超时，请重新点「登录」' })
            return
          }
          try {
            const answer = await readJson(await fetch(`/x-feishu-docs/auth/finish?device=${encodeURIComponent(deviceCode)}`, {
              headers: { 'x-feishu-docs': 'popover' },
              cache: 'no-store',
            }))
            if (answer.ok) {
              setAuthFlow({ busy: false, url: '', deviceCode: '', error: '' })
              afterAuth()
              return
            }
            // `pending` is the normal answer until the user confirms; a real
            // error stops the loop and keeps the reason on screen.
            if (answer.error) {
              setAuthFlow({ busy: false, url: '', deviceCode: '', error: String(answer.error) })
              return
            }
          } catch (error) {
            /* a transient failure is not a reason to stop waiting */
          }
          pollRef.current = window.setTimeout(tick, 2500)
        }
        pollRef.current = window.setTimeout(tick, 1500)
      }

      /**
       * Sign out of Feishu.
       *
       * The first press only arms the button: losing the token costs the
       * creator and title columns, so the second press is the one that does it.
       */
      const confirmLogout = async () => {
        if (!logoutAsk) {
          setLogoutAsk(true)
          window.setTimeout(() => setLogoutAsk(false), 6000)
          return
        }
        setLogoutAsk(false)
        try {
          const answer = await readJson(await fetch('/x-feishu-docs/auth/logout', {
            headers: { 'x-feishu-docs': 'popover' },
            cache: 'no-store',
          }))
          if (!answer.ok) {
            flash(answer.error || '退出失败', 3200)
            return
          }
          flash('已退出飞书账号', 2600)
          refreshDoctor()
          loadSession(fullId, true).then(applyData).catch(() => {})
        } catch (error) {
          flash(String(error), 3200)
        }
      }

      /** Finish it once the user says they confirmed in the browser. */
      const finishAuth = async () => {
        setAuthFlow((prev) => ({ ...prev, busy: true, error: '' }))
        try {
          const answer = await readJson(await fetch(`/x-feishu-docs/auth/finish?device=${encodeURIComponent(authFlow.deviceCode || '')}`, {
            headers: { 'x-feishu-docs': 'popover' },
            cache: 'no-store',
          }))
          if (!answer.ok && answer.pending) {
            flash('还没收到授权，继续等待…', 2600)
            if (authFlow.deviceCode) pollAuth(authFlow.deviceCode)
            return
          }
          if (!answer.ok) {
            setAuthFlow((prev) => ({ ...prev, busy: false, error: answer.error || '授权未完成' }))
            return
          }
          stopPolling()
          setAuthFlow({ busy: false, url: '', deviceCode: '', error: '' })
          afterAuth()
        } catch (error) {
          setAuthFlow((prev) => ({ ...prev, busy: false, error: String(error) }))
        }
      }

      useEffect(() => {
        let alive = true
        loadSession(fullId)
          .then((d) => { if (alive) applyData(d) })
          .catch(() => {})
        return () => { alive = false }
      }, [fullId])

      const docs = useMemo(() => (data && data.docs) || [], [data])
      const user = (doctor && doctor.user) || {}
      // Signed out, the account card's 登录 button is the entry — repeating it as a
      // warning would be the same instruction twice.
      const setupItems = (doctor && Array.isArray(doctor.items) ? doctor.items : [])
        .filter((entry) => entry.fix && !(entry.id === 'auth' && !user.available))

      // Who appears in this Session's list, for the 来自用户 filter.
      const creators = useMemo(() => [...new Set(docs.map((d) => d.by).filter(Boolean))].sort(), [docs])
      const needle = query.trim().toLowerCase()
      const shown = useMemo(() => docs.filter((d) => {
        if (creator && d.by !== creator) return false
        if (!needle) return true
        // Title and the token in its URL: a row still showing a bare token is
        // findable that way. The creator is not searched — 来自用户 filters by it.
        return [d.t, d.u].some((field) => String(field || '').toLowerCase().includes(needle))
      }), [docs, creator, needle])
      // A new account means the previous failure no longer applies.
      useEffect(() => { setAvatarBroken(false) }, [user.avatarAt])
      /** Scopes to request from the avatar's login button, honouring the diagnosis. */
      const loginScopes = () => {
        const authItem = doctor && Array.isArray(doctor.items) && doctor.items.find((item) => item.id === 'auth')
        return (authItem && authItem.fix && authItem.fix.scopes) || ['drive:drive.metadata:readonly', 'contact:user:search']
      }

      // Close on an outside press or Escape; both listeners live only while open.
      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          const inChip = chipRef.current && chipRef.current.contains(event.target)
          const inPop = popRef.current && popRef.current.contains(event.target)
          if (!inChip && !inPop) setOpen(false)
        }
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      if (renderBeaconed.current < 5) {
        renderBeaconed.current += 1
        beacon('render', { n: renderBeaconed.current, docs: docs.length, hasData: Boolean(data), sessionId: shortId })
      }

      // The entry stays visible even with nothing to list: an invisible chip is
      // indistinguishable from a broken plugin.
      const flash = (text, ms = 1600) => {
        setNote(text)
        window.setTimeout(() => setNote(''), ms)
      }

      /** Run one jump, and never fail silently: an exception becomes a visible note. */
      const go = async (doc) => {
        report('jump-start', { turn: doc.turn, mid: doc.mid || '', ...pageFacts() })
        try {
          await jumpTo(doc)
        } catch (error) {
          report('jump-exception', { message: String(error), turn: doc.turn })
          setOpen(true)
          flash(`跳转失败：${String(error && error.message || error)}`, 5000)
        }
      }

      const jumpTo = async (doc) => {
        // Page to the start of history first (once per Session), so the target we
        // pick really is the first mention — never a later copy that happens to be
        // the nearest one loaded.
        flash('正在定位到首次出现的位置…', 20000)
        const target = await ensureFirstMention(doc, (n) => flash(`正在加载更早的消息…第 ${n} 次`, 20000), fullId)
        if (!target) {
          copyText(`${doc.t || ''} · 第 ${doc.turn || '?'} 轮 · ${doc.hm || ''}`)
          flash(`第 ${doc.turn} 轮仍未加载 · 已复制位置`, 2600)
          return
        }
        await revealRow(target, doc)
        markDocument(doc)
        flash(`已定位到第 ${doc.turn} 轮`, 2200)
      }

      const toggle = () => {
        if (!open) {
          // A document may have been mentioned since the last render: re-read the
          // Session so the popover never shows a stale list.
          loadSession(fullId, true)
            .then(applyData)
            .catch(() => {})
        }
        const box = chipRef.current && chipRef.current.getBoundingClientRect()
        setRect(box ? { top: box.bottom + 6, right: Math.max(8, window.innerWidth - box.right) } : { top: 56, right: 12 })
        setOpen(!open)
      }

      return h('span', { style: { display: 'inline-flex' } },
        h('style', null, `
          .fd-chip { display:inline-flex; align-items:center; gap:4px; height:26px; padding:0 9px;
                     border-radius:13px; cursor:pointer; font:inherit; font-size:12px; color:inherit;
                     background:color-mix(in srgb, currentColor 5%, transparent);
                     border:1px solid color-mix(in srgb, currentColor 14%, transparent); opacity:.85; }
          .fd-chip:hover, .fd-chip[aria-expanded="true"] { opacity:1; background:color-mix(in srgb, currentColor 11%, transparent); }
          .fd-pop { position:fixed; z-index:60; width:400px; max-height:min(62vh, 520px); display:flex; flex-direction:column;
                    border-radius:10px; overflow:hidden; font-size:12.5px; color:inherit;
                    background:var(--dsw-alias-bg-elevated, #fff);
                    border:1px solid color-mix(in srgb, currentColor 14%, transparent);
                    box-shadow:0 8px 28px color-mix(in srgb, #000 18%, transparent); }
          .fd-pop-head { display:flex; align-items:center; gap:6px; padding:8px 10px; font-size:11.5px; opacity:.6;
                         border-bottom:1px solid color-mix(in srgb, currentColor 10%, transparent); }
          .fd-pop-body { overflow:auto; min-height:0; }
          .fd-search { display:flex; align-items:center; gap:7px; margin:8px 10px 0; padding:0 9px;
                       height:30px; border-radius:8px;
                       background:var(--dsw-alias-bg-elevated, #fff);
                       border:1px solid color-mix(in srgb, currentColor 16%, transparent); }
          .fd-search:focus-within { border-color:#3370FF;
                                    box-shadow:0 0 0 2px color-mix(in srgb, #3370FF 16%, transparent); }
          .fd-search-input { flex:1 1 auto; min-width:0; border:0; outline:0; background:transparent;
                             font:inherit; font-size:12px; color:inherit; }
          .fd-search-input::placeholder { color:inherit; opacity:.4; }
          .fd-search-input::-webkit-search-cancel-button { display:none; }
          .fd-filters { display:flex; align-items:center; gap:8px; padding:7px 10px 8px; }
          .fd-select-wrap { position:relative; display:inline-flex; align-items:center; }
          .fd-select { appearance:none; height:24px; padding:0 20px 0 9px; border-radius:6px; cursor:pointer;
                       font:inherit; font-size:11px; color:inherit; background:transparent;
                       border:1px solid color-mix(in srgb, currentColor 18%, transparent); }
          .fd-select:hover { background:color-mix(in srgb, currentColor 6%, transparent); }
          .fd-select-wrap > svg { position:absolute; right:6px; pointer-events:none; }
          .fd-clear { height:24px; padding:0 9px; border-radius:6px; cursor:pointer; font:inherit;
                      font-size:11px; color:inherit; opacity:.7; background:transparent; border:0; }
          .fd-clear:hover { opacity:1; text-decoration:underline; }
          .fd-none { padding:16px 12px; text-align:center; font-size:11.5px; opacity:.5; }
          .fd-hit { background:color-mix(in srgb, #FFB020 42%, transparent); color:inherit;
                    border-radius:2px; padding:0 1px; }
          .fd-empty { display:flex; flex-direction:column; align-items:center; gap:5px;
                      padding:20px 18px 22px; text-align:center; }
          .fd-empty-icon { opacity:.26; }
          .fd-empty-title { font-size:12px; opacity:.7; }
          .fd-empty-hint { font-size:10.5px; opacity:.42; line-height:1.45; max-width:250px; }
          .fd-pop-day { padding:4px 10px; font-size:10.5px; opacity:.45;
                        background:color-mix(in srgb, currentColor 4%, transparent); }
          .fd-pop-row { display:flex; align-items:center; gap:7px; padding:6px 10px; min-width:0; }
          .fd-pop-row:hover { background:color-mix(in srgb, currentColor 6%, transparent); }
          .fd-pop-row a { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
                          color:inherit; text-decoration:none; }
          .fd-pop-row a:hover { text-decoration:underline; }
          .fd-by { flex:none; font-size:10px; line-height:14px; padding:0 4px; border-radius:4px;
                   opacity:.6; background:color-mix(in srgb, currentColor 8%, transparent); }
          .fd-pop-new { flex:none; font-size:10px; padding:0 4px; border-radius:4px;
                        color:#0B7A3B; background:color-mix(in srgb, #34C724 22%, transparent); }
          .fd-pop-gone a { opacity:.5; text-decoration:line-through; }
          .fd-pop-del { flex:none; font-size:10px; padding:0 4px; border-radius:4px;
                        color:#B42318; background:color-mix(in srgb, #F04438 16%, transparent); }
          .fd-setup { margin:8px 10px; padding:9px 11px 10px; border-radius:10px;
                      display:flex; flex-direction:column; gap:8px;
                      background:color-mix(in srgb, #FFB020 7%, transparent);
                      border:1px solid color-mix(in srgb, #E8A33D 30%, transparent); }
          .fd-setup-title { display:flex; align-items:center; gap:6px;
                            font-size:11.5px; font-weight:600; color:#8A5A00; }
          .fd-setup-item { display:flex; align-items:center; gap:8px; min-width:0; }
          .fd-setup-text { flex:1 1 auto; min-width:0; }
          .fd-setup-name { font-size:11.5px; line-height:1.35; }
          .fd-setup-detail { font-size:10.5px; line-height:1.35; opacity:.6;
                             overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .fd-setup-go { flex:none; height:22px; padding:0 10px; border-radius:11px; cursor:pointer;
                         font:inherit; font-size:11px; color:#8A5A00;
                         background:color-mix(in srgb, #FFB020 18%, transparent);
                         border:1px solid color-mix(in srgb, #E8A33D 45%, transparent); }
          .fd-setup-go:hover { background:color-mix(in srgb, #FFB020 30%, transparent); }
          .fd-setup-link { display:flex; align-items:center; gap:6px; font-size:11px; flex-wrap:wrap; }
          .fd-user-auth { margin:8px 10px; padding:8px 11px; border-radius:10px;
                          justify-content:space-between;
                          background:color-mix(in srgb, #3370FF 6%, transparent);
                          border:1px solid color-mix(in srgb, #3370FF 26%, transparent); }
          .fd-user-auth a { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
                            white-space:nowrap; }
          .fd-user-auth .fd-auth-go { color:#fff; background:#3370FF; border-color:#3370FF; }
          .fd-user-auth .fd-auth-go:hover { background:#245CE0; border-color:#245CE0; }
          .fd-setup-link a { color:#3370FF; text-decoration:underline; word-break:break-all; }
          .fd-setup-err { font-size:11px; color:#B42318; }
          .fd-user { display:flex; align-items:center; gap:8px; padding:9px 10px;
                     border-bottom:1px solid color-mix(in srgb, currentColor 10%, transparent); }
          .fd-user-avatar { flex:none; width:28px; height:28px; border-radius:50%; object-fit:cover; }
          .fd-user-initial { display:flex; align-items:center; justify-content:center;
                             font-size:12.5px; font-weight:600; color:#fff;
                             background:linear-gradient(135deg, #3370FF, #7C4DFF); }
          .fd-user-dim { color:#8A9099; background:#EDEFF2;
                         border:1px solid color-mix(in srgb, #8A9099 25%, transparent); }
          .fd-user-signin { flex:none; height:22px; padding:0 10px; border-radius:11px; cursor:pointer;
                            font:inherit; font-size:11px; color:#fff; background:#3370FF;
                            border:1px solid #3370FF; }
          .fd-user-signin:hover { background:#245CE0; border-color:#245CE0; }
          .fd-user-text { flex:1 1 auto; min-width:0; }
          .fd-user-name { font-size:12.5px; font-weight:600; line-height:1.3;
                          overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .fd-user-sub { font-size:10.5px; opacity:.55; line-height:1.3;
                         overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .fd-user-out { flex:none; height:22px; padding:0 9px; border-radius:11px; cursor:pointer;
                         font:inherit; font-size:11px; color:#B42318;
                         background:color-mix(in srgb, #F04438 10%, transparent);
                         border:1px solid color-mix(in srgb, #F04438 35%, transparent); }
          .fd-user-out:hover { background:color-mix(in srgb, #F04438 20%, transparent); }
          .fd-user-armed { color:#fff; background:#D92D20; border-color:#D92D20; }
          .fd-user-cancel { flex:none; height:22px; padding:0 8px; border-radius:11px; cursor:pointer;
                            font:inherit; font-size:11px; color:inherit;
                            background:color-mix(in srgb, currentColor 8%, transparent);
                            border:1px solid color-mix(in srgb, currentColor 18%, transparent); }
          .fd-jump { display:inline-flex; align-items:center; justify-content:center; flex:none;
                     width:22px; height:22px; padding:0; border-radius:50%; cursor:pointer;
                     color:inherit; opacity:.72;
                     background:color-mix(in srgb, currentColor 6%, transparent);
                     border:1px solid color-mix(in srgb, currentColor 16%, transparent); }
          .fd-jump:hover { opacity:1; background:color-mix(in srgb, currentColor 14%, transparent); }
          .fd-tip { position:fixed; z-index:80; width:max-content; max-width:min(320px, 46vw);
                    padding:6px 11px; border-radius:8px;
                    transform:translate(-50%, -100%);
                    font-size:12px; line-height:1.35; text-align:center; white-space:nowrap;
                    overflow:hidden; text-overflow:ellipsis; pointer-events:none;
                    background:#23262b; color:#ffffff;
                    box-shadow:0 6px 18px color-mix(in srgb, #000 26%, transparent); }
          .fd-tip::after { content:''; position:absolute; left:50%; bottom:-5px; transform:translateX(-50%);
                           width:0; height:0; border-left:5px solid transparent;
                           border-right:5px solid transparent; border-top:5px solid #23262b; }
          .fd-pop-foot { display:flex; gap:8px; align-items:center; padding:7px 10px; font-size:11.5px;
                         opacity:.6; border-top:1px solid color-mix(in srgb, currentColor 10%, transparent); }
          .fd-pop-hint { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .fd-pop-setup { flex:none; margin-left:auto; height:20px; padding:0 7px; border-radius:10px;
                          cursor:pointer; font:inherit; font-size:10.5px; color:inherit;
                          background:color-mix(in srgb, #FF8800 16%, transparent);
                          border:1px solid color-mix(in srgb, #FF8800 40%, transparent); }
        `),
        h('button', {
          ref: chipRef, className: 'fd-chip', type: 'button',
          'aria-expanded': String(open), title: `本会话涉及 ${docs.length} 篇飞书云文档`,
          onClick: toggle,
        },
          h(CloudIcon, null),
          h('span', null, String(docs.length)),
        ),
        open && rect
          ? h('div', { ref: popRef, className: 'fd-pop', style: { top: `${rect.top}px`, right: `${rect.right}px` } },
              h('div', { className: 'fd-user' },
                user.available
                  ? (user.hasAvatar && !avatarBroken
                      ? h('img', {
                          className: 'fd-user-avatar',
                          src: `/x-feishu-docs/avatar?v=${user.avatarAt || 0}`,
                          alt: '',
                          onError: () => setAvatarBroken(true),
                        })
                      : h('div', { className: 'fd-user-avatar fd-user-initial' }, initialOf(user.name)))
                  : h('div', { className: 'fd-user-avatar fd-user-initial fd-user-dim' }, h(UserGlyph, null)),
                h('div', { className: 'fd-user-text' },
                  h('div', { className: 'fd-user-name' }, user.name || '未登录飞书'),
                  h('div', { className: 'fd-user-sub' },
                    user.available
                      ? `${user.brand === 'lark' ? 'Lark' : '飞书'}个人用户`
                      : '点右侧「登录」授权飞书'),
                ),
                user.available
                  ? h('button', {
                      className: logoutAsk ? 'fd-user-out fd-user-armed' : 'fd-user-out',
                      type: 'button',
                      title: logoutAsk ? '再点一次确认退出' : '退出飞书账号',
                      onClick: (e) => { e.preventDefault(); confirmLogout() },
                    }, logoutAsk ? '确认退出' : '退出')
                  : null,
                logoutAsk
                  ? h('button', {
                      className: 'fd-user-cancel', type: 'button',
                      onClick: (e) => { e.preventDefault(); setLogoutAsk(false) },
                    }, '取消')
                  : null,
                user.available
                  ? null
                  : h('button', {
                      className: 'fd-user-signin', type: 'button',
                      title: '登录飞书账号',
                      onClick: (e) => { e.preventDefault(); if (!authFlow.busy) startAuth(loginScopes()) },
                    }, authFlow.busy ? '等待授权…' : '登录'),
              ),
              setupItems.length
                ? h('div', { className: 'fd-setup' },
                    h('div', { className: 'fd-setup-title' },
                      h(WarnIcon, null),
                      h('span', null, `还差 ${setupItems.length} 项设置`),
                    ),
                    setupItems.map((item) => h('div', { key: item.id, className: 'fd-setup-item' },
                      h('div', { className: 'fd-setup-text' },
                        h('div', { className: 'fd-setup-name' }, item.title),
                        h('div', { className: 'fd-setup-detail', title: item.detail }, item.detail),
                      ),
                      item.fix.kind === 'command'
                        ? h('button', {
                            className: 'fd-setup-go', type: 'button',
                            onClick: (e) => { e.preventDefault(); copyText(item.fix.command); flash(`已复制：${item.fix.command}`, 2600) },
                          }, '复制命令')
                        : h('button', {
                            className: 'fd-setup-go', type: 'button',
                            onClick: (e) => { e.preventDefault(); if (!authFlow.busy) startAuth(item.fix.scopes) },
                          }, authFlow.busy ? '发起中…' : '去授权'),
                    )),
                  )
                : null,
              // The authorization link lives here, right under the account, so it
              // shows whether it came from the avatar's 登录 or from the panel.
              authFlow.url || authFlow.error
                ? h('div', { className: 'fd-setup-link fd-user-auth' },
                    authFlow.url
                      ? h('a', { href: authFlow.url, target: '_blank', rel: 'noreferrer' }, '打开飞书授权页')
                      : null,
                    authFlow.url
                      ? h('button', {
                          className: 'fd-setup-go fd-auth-go', type: 'button',
                          onClick: (e) => { e.preventDefault(); if (!authFlow.busy) finishAuth() },
                        }, authFlow.busy ? '确认中…' : '我已授权')
                      : null,
                    authFlow.error ? h('span', { className: 'fd-setup-err' }, authFlow.error) : null,
                  )
                : null,
              docs.length
                ? h('div', { className: 'fd-search' },
                    h(SearchIcon, null),
                    h('input', {
                      className: 'fd-search-input', type: 'search', value: query,
                      placeholder: '搜索文档名称', spellCheck: false,
                      'aria-label': '搜索本文档列表',
                      onChange: (e) => setQuery(e.target.value),
                      onKeyDown: (e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setQuery('')
                        }
                      },
                    }),
                  )
                : null,
              // No known creator means nothing to filter by: signed out, every row
              // has an empty 来自用户, so the pill would offer a single pointless option.
              docs.length && (creators.length || needle || creator)
                ? h('div', { className: 'fd-filters' },
                    h('div', { className: 'fd-select-wrap' },
                      h('select', {
                        className: 'fd-select', value: creator, 'aria-label': '按创建者筛选',
                        onChange: (e) => setCreator(e.target.value),
                      },
                        h('option', { value: '' }, '来自用户'),
                        creators.map((name) => h('option', { key: name, value: name }, name)),
                      ),
                      h(CaretIcon, null),
                    ),
                    needle || creator
                      ? h('button', {
                          className: 'fd-clear', type: 'button',
                          onClick: (e) => { e.preventDefault(); setQuery(''); setCreator('') },
                        }, '清除')
                      : null,
                  )
                : null,
              docs.length
                ? h('div', { className: 'fd-pop-head' },
                    h('span', null, '本会话云文档'),
                    h('span', { style: { marginLeft: 'auto' } },
                      shown.length === docs.length ? `${docs.length} 篇` : `${shown.length} / ${docs.length} 篇`),
                  )
                : null,
              docs.length === 0
                ? h(EmptyState, { state: data ? (data.error ? 'error' : 'empty') : 'loading' })
                : null,
              docs.length
                ? h('div', { className: 'fd-pop-body' },
                shown.length === 0
                  ? h('div', { className: 'fd-none' }, '没有匹配的文档')
                  : null,
                shown.map((d, i) => h('div', { key: d.u },
                  (i === 0 || shown[i - 1].d !== d.d)
                    ? h('div', { className: 'fd-pop-day' }, dayLabel(d.d))
                    : null,
                  h('div', { className: d.deleted ? 'fd-pop-row fd-pop-gone' : 'fd-pop-row' },
                    h(TypeIcon, { type: d.ty }),
                    h('a', { href: d.u, target: '_blank', rel: 'noreferrer', title: d.deleted ? `${d.t}（已删除）` : d.t },
                      highlight(d.t, needle)),
                    d.deleted ? h('span', { className: 'fd-pop-del' }, '已删除') : null,
                    d.by ? h('span', { className: 'fd-by', title: d.by }, shortBy(d.by)) : null,
                    d.new ? h('span', { className: 'fd-pop-new' }, '新建') : null,
                    h(JumpButton, { doc: d, onTrigger: () => go(d) }),
                  ),
                )),
                  )
                : null,
              // The footer exists only to show a transient result (a copied command,
              // a finished authorization). Standing advice about how to click a row
              // was noise: the rows say that themselves.
              note
                ? h('div', { className: 'fd-pop-foot' },
                    h('span', { className: 'fd-pop-hint' }, note),
                  )
                : null,
            )
          : null,
      )
    }

    return {
      inject: ['slots', 'sidebarRightTabs'],
      apply(ctx) {
        pluginCtx = ctx
        console.info('[feishu-docs] client apply, version 2.5.0')
        beacon('apply')

        try {
          // A LIST seat, not the corner one: `conversation.session.header.corner`
          // is single-occupant and the right-panel toggle claims it whenever the
          // panel is closed, which made this chip appear and vanish with the
          // sidebar. Utilities coexist with the other header controls.
          ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
            name: 'conversation.session.header.utilities', id: 'feishu-docs', order: 60,
          }, HeaderChip))
          console.info('[feishu-docs] header chip registered')
          beacon('registered')
        } catch (error) {
          console.error('[feishu-docs] header chip registration failed', error)
          beacon('register-failed', { message: String(error) })
        }
      },
    }
  },
})
