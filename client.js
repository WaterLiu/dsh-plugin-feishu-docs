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
    const payload = encodeURIComponent(JSON.stringify({ phase, version: '3.2.0', ...(extra || {}) }))
    fetch(`/x-feishu-docs/log?d=${payload}`, { headers: { 'x-feishu-docs': 'popover' } }).catch(() => {})
  } catch (error) {
    /* ignore */
  }
}
/** Unconditional report, used only by the jump path (a handful of calls). */
function report(phase, extra) {
  try {
    const payload = encodeURIComponent(JSON.stringify({ phase, version: '3.2.0', ...(extra || {}) }))
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
    /**
     * Highlight the document's own text with the CSS Custom Highlight API.
     *
     * `CSS.highlights` lets the browser paint a Range with a `::highlight()` style:
     * no overlay, no rect maths, nothing inserted into DSH's DOM — and it moves with
     * the text because it *is* the text. Older engines fall back to the overlay.
     */
    const HIGHLIGHT_NAME = 'feishu-doc-hit'
    const canUseHighlights = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function'

    /** One injected stylesheet for the document mark. */
    let markStyles = false
    function ensureMarkStyles() {
      if (markStyles) return
      markStyles = true
      try {
        const style = document.createElement('style')
        style.textContent = `
          ::highlight(${HIGHLIGHT_NAME}) {
            background-color: rgba(255, 176, 32, 0.42);
            color: inherit;
          }
          .fd-doc-hl { position: fixed; z-index: 65; pointer-events: none; border-radius: 4px;
                       background: color-mix(in srgb, #FFB020 38%, transparent);
                       box-shadow: 0 0 0 2px color-mix(in srgb, #FFB020 52%, transparent);
                       transition: opacity .35s ease; }
          @keyframes fd-doc-hl-pulse {
            from { box-shadow: 0 0 0 2px color-mix(in srgb, #FFB020 62%, transparent); }
            to { box-shadow: 0 0 0 8px transparent; }
          }
          .fd-doc-hl[data-fresh] { animation: fd-doc-hl-pulse .8s ease-out 2; }
          .fd-doc-hl[data-out] { opacity: 0; }
        `
        document.head.appendChild(style)
      } catch (error) {
        /* styling is best effort */
      }
    }

    /**
     * The row DSH rendered for one message, when it is mounted.
     *
     * `data-chat-node-id` and `data-chat-seq` are what this plugin asks DSH to
     * expose (see `contrib/upstream-data-chat-node-id.md`); until that lands, the
     * router key and the turn are the only identifiers a row carries, so both are
     * tried. Forward-compatible by construction: the extra attributes simply make
     * the first selector succeed.
     */
    function rowByMessageId(mid, seq) {
      if (!mid && seq == null) return null
      const selectors = []
      if (mid) selectors.push(`[data-chat-node-id="${mid}"]`)
      if (seq != null) selectors.push(`[data-chat-seq="${seq}"]`)
      if (mid) selectors.push(`[data-chat-node-key*="${mid}"]`, `[data-chat-anchor-key*="${mid}"]`)
      for (const selector of selectors) {
        try {
          const found = document.querySelector(selector)
          if (found) return found
        } catch (error) {
          /* an invalid selector is not fatal: try the next one */
        }
      }
      return null
    }

    
    /** The highlight layer, and the timers that place and retire it. */
    let markNode = null
    let markTimer = null
    let markFrame = 0
    let markFollowers = []

    /** How long we look for the link, and the overlay's fade. */
    const MARK_LOOK = 5000
    const MARK_FADE = 380

    /** Remove the highlight and every timer/listener it installed. */
    function clearDocMark() {
      if (markTimer) {
        window.clearInterval(markTimer)
        markTimer = null
      }
      if (markFrame) {
        window.cancelAnimationFrame(markFrame)
        markFrame = 0
      }
      for (const [event, handler, options] of markFollowers) {
        window.removeEventListener(event, handler, options || true)
      }
      markFollowers = []
      if (canUseHighlights) {
        try { CSS.highlights.delete(HIGHLIGHT_NAME) } catch (error) { /* ignore */ }
      }
      if (markNode) {
        markNode.remove()
        markNode = null
      }
    }

    /**
     * Where a document lives on screen: the link, and the row it sits in.
     *
     * `[data-chat-turn]` is on hundreds of elements — steps, tool rows, the turn
     * itself — not only the message. Picking the first one gave a 27px step row, so
     * scrolling moved a few hundred pixels and looked like nothing had happened.
     * The block is therefore found by the token, and among those matches the link
     * with a real rect wins, then the tallest row.
     *
     * @param doc - the document, with `turn` recorded at its first mention.
     * @param strict - when true, only the recorded turn is searched. Paging relies
     *   on this: a loose search would find a later copy of the document and report
     *   success before the first mention had been loaded.
     * @returns `{ anchor, row }` — either may be null.
     */
    function docTarget(doc, strict) {
      const token = String((doc && doc.u) || '').split('/').pop()
      if (!token) return { anchor: null, row: null }

      const sized = (el) => {
        const box = el.getBoundingClientRect()
        return box.width > 4 && box.height > 4
      }
      // A document can be rendered as its URL *or* as a label (`[名称](url)`), and in
      // the label case the token is nowhere in the text — the recorded title is.
      const title = String((doc && doc.t) || '').trim()
      const usableTitle = title && !/^[A-Za-z0-9_-]{16,}$/.test(title)
      const holds = (el) => {
        const href = el.getAttribute('href') || ''
        if (href.includes(token)) return true
        const text = el.textContent || ''
        return text.includes(token) || Boolean(usableTitle && text.includes(title))
      }

      const turn = Number(doc && doc.turn)
      const scoped = turn ? [...document.querySelectorAll(`[data-chat-turn="${turn}"]`)] : []
      if (!scoped.length && strict) return { anchor: null, row: null }
      const roots = scoped.length ? scoped : [...document.querySelectorAll('[data-chat-turn]')]

      const anchor = roots
        .flatMap((root) => [...root.querySelectorAll('a[href]')])
        .find((el) => sized(el) && holds(el))
      if (anchor) return { anchor, row: anchor.closest('[data-chat-turn]') }

      const rows = roots.filter((root) => holds(root) && sized(root))
      rows.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)
      if (rows.length) return { anchor: null, row: rows[0] }

      // Nothing in the rendered text mentions it: fall back to the exact message row.
      const exact = rowByMessageId(doc && doc.mid, doc && doc.seq)
      return { anchor: null, row: exact }
    }

    /**
     * Put the layer over the document's link, or over the block when it has none.
     *
     * The layer is its own element rather than a class on the app's node: DSH
     * re-renders rows while a turn streams, which strips any class we add and made
     * the highlight blink. A rect re-read every 120ms cannot blink — it is either
     * over the link or it is gone.
     *
     * @returns whether there is something to cover right now.
     */
    function placeDocMark(doc) {
      const { anchor, row } = docTarget(doc, true)
      const el = anchor || row
      if (!el) return false
      const box = el.getBoundingClientRect()
      if (box.width < 4 || box.height < 4) return false

      if (!markNode) {
        markNode = document.createElement('div')
        markNode.className = 'fd-doc-hl'
        markNode.dataset.fresh = ''
        document.body.appendChild(markNode)
      }
      markNode.style.top = `${Math.round(box.top - 2)}px`
      markNode.style.left = `${Math.round(box.left - 2)}px`
      markNode.style.width = `${Math.round(box.width + 4)}px`
      markNode.style.height = `${Math.round(box.height + 4)}px`
      return true
    }

    /**
     * Dismiss the mark. There is no timer: the mark stays until the reader does
     * something else, which is the only signal that it is no longer needed.
     */
    function dismissOnInteraction() {
      clearDocMark()
    }

    /**
     * A Range over the document as the reader sees it.
     *
     * When the message rendered a link, the *whole* link is highlighted — the URL in
     * full, or the label when the message wrote `[名称](url)`. Without a link, the
     * first text node holding the token or the recorded title is used instead.
     *
     * @param doc - the document the jump targeted.
     * @returns a Range, or null when the document is not rendered.
     */
    function tokenRange(doc) {
      const token = String((doc && doc.u) || '').split('/').pop()
      const title = String((doc && doc.t) || '').trim()
      const usableTitle = title && !/^[A-Za-z0-9_-]{16,}$/.test(title)
      const { anchor } = docTarget(doc, true)

      if (anchor && (anchor.textContent || '').trim()) {
        const whole = document.createRange()
        try {
          whole.selectNodeContents(anchor)
          return whole
        } catch (error) {
          /* fall through to the text search */
        }
      }

      const needles = [token, usableTitle ? title : ''].filter(Boolean)
      const root = anchor || transcript()
      if (!root || !needles.length) return null
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue || ''
        const host = node.parentElement
        if (!host || host.closest('pre, code')) continue
        for (const needle of needles) {
          const at = text.indexOf(needle)
          if (at < 0) continue
          const range = document.createRange()
          try {
            range.setStart(node, at)
            range.setEnd(node, at + needle.length)
          } catch (error) {
            continue
          }
          return range
        }
      }
      return null
    }

    /** Paint the mark, whichever way this engine supports. */
    function paintDocMark(doc) {
      if (!canUseHighlights) return placeDocMark(doc)
      const range = tokenRange(doc)
      if (!range) return false
      try {
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range))
      } catch (error) {
        return false
      }
      return true
    }

    /**
     * Highlight the document's link, and keep it until the reader acts.
     *
     * With the Custom Highlight API this is a Range over the existing text: no
     * overlay, no rect maths, and it follows scrolling by construction. The overlay
     * remains only for engines without `CSS.highlights`.
     *
     * @param doc - the document the jump targeted.
     */
    function markDocument(doc) {
      clearDocMark()
      ensureMarkStyles()

      const token = String((doc && doc.u) || '').split('/').pop()
      const deadline = Date.now() + MARK_LOOK
      let reported = false

      const tick = () => {
        if (paintDocMark(doc)) {
          if (!reported) {
            reported = true
            report('mark', {
              token, turn: doc && doc.turn, mid: Boolean(doc && doc.mid),
              via: canUseHighlights ? 'css-highlight' : 'overlay',
            })
          }
          return
        }
        if (Date.now() > deadline) {
          if (!reported) report('mark-miss', { token, turn: doc && doc.turn, mid: Boolean(doc && doc.mid) })
          clearDocMark()
        }
      }

      tick()
      // Re-register while it is up: a re-render replaces the text node, which breaks
      // the Range. Cheap — nothing is measured.
      markTimer = window.setInterval(tick, canUseHighlights ? 400 : 300)

      // Any deliberate interaction retires it — a press, a key, a wheel, a touch.
      // Scrolling alone does not: reading means scrolling.
      const options = { capture: true, passive: true }
      const listeners = [
        ['pointerdown', dismissOnInteraction, options],
        ['keydown', dismissOnInteraction, options],
        ['wheel', dismissOnInteraction, options],
        ['touchstart', dismissOnInteraction, options],
      ]
      for (const [event, handler, opts] of listeners) window.addEventListener(event, handler, opts)
      markFollowers = listeners
    }



    /**
     * Ask the transcript for more history by moving it to the top.
     *
     * This build loads older messages when its own scroll reaches the top, and it
     * exposes no other loader to a plugin: the history button is not always there
     * and `conversation.loadOlder()` is not always reachable. So this stays, but the
     * caller must put the view back — leaving it at the top is what looked like
     * "the jump did nothing".
     *
     * @returns whether the transcript actually moved.
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
     * Ask for newer history by moving the transcript to its bottom.
     *
     * The window slides both ways: after paging to the start, rows near the tail are
     * unloaded, so a jump to a *later* turn has to travel down. Paging only upwards
     * left those jumps stuck at "not loaded".
     *
     * @returns whether the transcript actually moved.
     */
    function nudgeBottom() {
      const scroller = transcript()
      if (!scroller) return false
      const before = scroller.scrollTop
      scroller.scrollTop = scroller.scrollHeight
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      return Math.abs(scroller.scrollTop - before) > 2
    }

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
      const scroller = transcript() || scrollerFor(row)
      if (!scroller) return false

      const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))
      const frame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()))

      // Take scroll ownership away from "follow the tail" first. Without this the
      // app restores `scrollTop` on the next frame — the trace showed three
      // identical samples and a jump that only moved on its third, hard attempt.
      try {
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }))
      } catch (error) {
        /* no WheelEvent in this engine */
      }
      await sleep(60)

      const offset = () => {
        const box = row.getBoundingClientRect()
        const port = scroller.getBoundingClientRect()
        return box.top - port.top + box.height / 2 - port.height / 2
      }

      const before = scroller.scrollTop
      const seen = []
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const delta = offset()
        if (Math.abs(delta) < 8) break
        scroller.scrollTop += delta
        await frame()
        await sleep(50)
        seen.push(Math.round(scroller.scrollTop))
        if (Math.abs(offset()) < 24) break
      }

      // Still off? Let the browser centre it, then confirm.
      if (Math.abs(offset()) > 24) {
        try { row.scrollIntoView({ block: 'center', behavior: 'instant' }) } catch (error) { /* ignore */ }
        await frame()
        await sleep(60)
      }

      const centred = Math.abs(offset()) < 24
      const moved = Math.abs(scroller.scrollTop - before) > 2
      report('reveal', {
        before: Math.round(before), after: Math.round(scroller.scrollTop), seen,
        centred, moved, rowHeight: Math.round(row.getBoundingClientRect().height),
        isTranscript: scroller === transcript(),
      })
      return centred || moved
    }

    /** The transcript's own "load earlier" control, when history remains. */
    function historyButton() {
      const host = document.querySelector('[data-chat-history]')
      const button = host && host.querySelector('button')
      return button && !button.disabled ? button : null
    }

    /** Has the transcript actually grown since `before`? */
    function grewSince(before) {
      const scroller = transcript()
      return Boolean(scroller) && scroller.scrollHeight > before + 4
    }

    /**
     * Ask for one more page of history, and prove it arrived.
     *
     * Three loaders exist, and each must be *verified*: a history button can be
     * present but disabled, and `loadOlder()` can resolve without adding anything.
     * Returning "true" unverified is why jumps to old messages stopped loading at
     * all — the top-of-scroll trigger was never reached.
     *
     * @returns whether the transcript actually grew.
     */
    async function loadOlderOnce() {
      const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))
      const scroller = transcript()
      const before = scroller ? scroller.scrollHeight : 0

      const button = historyButton()
      if (button) {
        try { button.click() } catch (error) { /* a click that throws changed nothing */ }
        await sleep(260)
        if (grewSince(before)) {
          report('jump-click-older', { ok: true, state: document.querySelector('[data-chat-history]')?.getAttribute('data-chat-history') })
          return true
        }
      }

      let failure = ''
      try {
        // Two possible service names depending on the build; both are optional, so
        // this is a runtime lookup rather than an `inject` dependency (a missing
        // service in `inject` would block the whole plugin from activating).
        const api = (pluginCtx && (pluginCtx.conversation || pluginCtx.uiConversation)) || null
        if (api && typeof api.loadOlder === 'function') {
          await Promise.race([
            Promise.resolve(api.loadOlder()),
            new Promise((resolve) => window.setTimeout(resolve, 1500)),
          ])
          await sleep(200)
          if (grewSince(before)) {
            report('jump-loadolder', { ok: true, via: 'api' })
            return true
          }
        }
      } catch (error) {
        failure = String(error)
      }

      // This build loads history by reaching its top; the caller waits for growth.
      const nudged = nudgeTop()
      report('jump-loadolder', { ok: grewSince(before), nudged, failure })
      return nudged || grewSince(before)
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

    /** The lowest and highest turn rendered right now, or null. */
    function turnBounds() {
      const turns = [...document.querySelectorAll('[data-chat-turn]')]
        .map((el) => Number(el.getAttribute('data-chat-turn')))
        .filter((n) => Number.isFinite(n))
      if (!turns.length) return null
      return { min: Math.min(...turns), max: Math.max(...turns) }
    }

    /** Which turn numbers are actually rendered right now, as a range. */
    function turnRange() {
      const turns = [...document.querySelectorAll('[data-chat-turn]')]
        .map((el) => Number(el.getAttribute('data-chat-turn')))
        .filter((n) => Number.isFinite(n))
      if (!turns.length) return ''
      return `${Math.min(...turns)}-${Math.max(...turns)}`
    }

    /** A few rendered row keys, for the trace: does a key carry the message id? */
    function keySample() {
      try {
        return [...document.querySelectorAll('[data-chat-node-key]')]
          .slice(0, 3)
          .map((el) => String(el.getAttribute('data-chat-node-key') || '').slice(0, 60))
      } catch (error) {
        return []
      }
    }

    
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
    /**
     * The row (or link) that shows a document, loading history until it exists.
     *
     * `data-chat-node-key` is the router's own key — the message id and the event
     * `seq` are in the view node but not in the DOM — so the reliable anchors are
     * the turn number and the token text. The recorded turn is the first mention,
     * which makes "earliest" exact rather than a search order.
     *
     * @param doc - the document, with `turn` recorded at its first mention.
     * @param onProgress - called with the attempt count while paging history.
     * @returns the element to scroll to, or null when it never loads.
     */
    async function ensureFirstMention(doc, onProgress) {
      // Ready means "the block that holds the document is rendered", not merely "a
      // row with that turn exists": turns carry steps and tool rows too.
      const ready = docTarget(doc, true)
      if (ready.anchor || ready.row) return ready

      // Loading means the transcript has to reach its top (this build's trigger), so
      // the original position is remembered and restored if the block never arrives.
      const scroller = transcript()
      const restore = scroller ? scroller.scrollTop : 0
      const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

      for (let attempt = 0; attempt < 16; attempt += 1) {
        onProgress?.(attempt + 1)
        const heightBefore = scroller ? scroller.scrollHeight : 0
        // Direction matters: a target below the loaded window needs newer history,
        // and this build loads it by reaching the bottom.
        const bounds = turnBounds()
        const turn = Number(doc.turn)
        // The turn is rendered but its link is not (a collapsed block, say): no
        // amount of paging helps, so land on the block itself.
        if (bounds && turn >= bounds.min && turn <= bounds.max) {
          const row = findTurnRow(turn)
          if (row) {
            report('jump-block-only', { turn, block: doc.block })
            return { anchor: null, row }
          }
        }
        const wantNewer = bounds && turn > bounds.max
        if (wantNewer) nudgeBottom()
        else await loadOlderOnce()
        for (let wait = 0; wait < 8; wait += 1) {
          await sleep(120)
          const probe = docTarget(doc, true)
          if (probe.anchor || probe.row) break
          if (scroller && scroller.scrollHeight !== heightBefore) break
        }
        const found = docTarget(doc, true)
        if (found.anchor || found.row) {
          report('jump-first-found', {
            attempt: attempt + 1, block: doc.block, anchor: Boolean(found.anchor),
            mid: Boolean(doc.mid), domTurns: turnRange(),
          })
          return found
        }
        if (scroller && scroller.scrollHeight === heightBefore && attempt > 0) break
      }

      // Could not reach it: put the reader back, then report what is there.
      if (scroller) {
        try { scroller.scrollTop = restore } catch (error) { /* ignore */ }
      }
      // History could not be paged far enough: a later copy is better than nothing,
      // but the caller is told so it can say "最近可加载的位置".
      const fallback = docTarget(doc, false)
      report('jump-first-exhausted', {
        found: Boolean(fallback.anchor || fallback.row), block: doc && doc.block,
        turn: doc && doc.turn, mid: Boolean(doc && doc.mid), domTurns: turnRange(), keys: keySample(),
      })
      return fallback
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
        // Close the panel first. While it is open it covers the top-right of the
        // transcript — exactly where a centred link can land — and it is a scroll
        // container of its own, which muddies who owns the scroll. Jumping with it
        // closed is the layout the feature was designed against.
        setOpen(false)
        const target = await ensureFirstMention(doc, (n) => console.info(`[feishu-docs] loading older history… ${n}`))
        // The link is the thing to centre; the row is only a fallback for a block
        // whose link is not rendered.
        const focus = target.anchor || target.row
        if (!focus) {
          // Nothing to jump to: reopen the panel so the reason is actually readable.
          copyText(`${doc.t || ''} · 第 ${doc.turn || '?'} 轮 · ${doc.hm || ''}`)
          setOpen(true)
          flash(`第 ${doc.turn} 轮仍未加载（当前 ${turnRange() || '无'} 轮）· 已复制位置`, 3200)
          return
        }
        await revealRow(focus, doc)
        markDocument(doc)
        // The panel is closed, so the highlight is the feedback; keep the trace for
        // the record and leave the popover shut until the reader asks for it.
        report('jump-done', { turn: doc.turn, anchor: Boolean(target.anchor), block: doc.block })
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
        console.info('[feishu-docs] client apply, version 3.2.0')
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
