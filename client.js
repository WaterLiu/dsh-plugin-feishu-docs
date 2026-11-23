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
    fetch('/x-feishu-docs/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phase, version: '2.0.0', ...(extra || {}) }),
    }).catch(() => {})
  } catch (error) {
    /* ignore */
  }
}
/** Unconditional report, used only by the jump path (a handful of calls). */
function report(phase, extra) {
  try {
    fetch('/x-feishu-docs/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phase, version: '2.0.0', ...(extra || {}) }),
    }).catch(() => {})
  } catch (error) {
    /* ignore */
  }
}

beacon('module-eval')

window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-feishu-docs',
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
    /** One injected stylesheet for the landing highlight. */
    let landingStyles = false
    function ensureLandingStyles() {
      if (landingStyles) return
      landingStyles = true
      try {
        const style = document.createElement('style')
        style.textContent = `
          @keyframes fd-land-in { from { opacity: 0 } to { opacity: 1 } }
          .fd-landing-row { position: fixed; z-index: 65; pointer-events: none;
                            border-radius: 12px; opacity: 1; box-sizing: border-box;
                            background: color-mix(in srgb, #3370ff 5%, transparent);
                            border: 2px solid color-mix(in srgb, #3370ff 55%, transparent);
                            box-shadow: inset 3px 0 0 #3370ff,
                                        0 0 0 3px color-mix(in srgb, #3370ff 10%, transparent);
                            animation: fd-land-in .18s ease-out; }
          .fd-landing-row[data-leaving] { opacity: 0; transition: opacity .2s ease-in; }
          .fd-landing-tag { position: absolute; top: 6px; left: 10px; display: inline-flex; align-items: center;
                            gap: 4px; max-width: calc(100% - 20px); padding: 1px 8px 1px 6px;
                            border-radius: 9px; font-size: 10.5px; line-height: 16px; color: #fff;
                            background: #3370ff; white-space: nowrap; overflow: hidden;
                            text-overflow: ellipsis;
                            box-shadow: 0 2px 6px color-mix(in srgb, #3370ff 40%, transparent); }
        `
        document.head.appendChild(style)
      } catch (error) {
        /* styling is best effort */
      }
    }

    /**
     * The bounding box of one whole turn.
     *
     * A turn is the reader's message plus everything that answered it, spread
     * over many rows that all carry `data-chat-turn`; framing one row would only
     * cover the input. The union of those rows is the unit the reader calls "one
     * message".
     *
     * @param turn - the turn number.
     * @param fallback - row to use when the turn's rows are not measurable.
     * @returns a viewport rectangle, or null.
     */
    function turnRect(turn, fallback) {
      const rows = turn
        ? [...document.querySelectorAll(`[data-chat-turn="${turn}"]`)]
        : []
      let top = Infinity
      let bottom = -Infinity
      let left = Infinity
      let right = -Infinity
      for (const el of rows) {
        const box = el.getBoundingClientRect()
        if (box.height < 2) continue
        if (box.top < top) top = box.top
        if (box.bottom > bottom) bottom = box.bottom
        if (box.left < left) left = box.left
        if (box.right > right) right = box.right
      }
      if (!Number.isFinite(top)) {
        if (!fallback) return null
        const box = fallback.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right }
      }
      return { top, bottom, left, right }
    }

    /** The active highlight, so a new jump or any interaction can retire it. */
    let landing = null

    /** Retire the highlight and every listener it installed. */
    function clearLanding() {
      if (!landing) return
      const { node, interval, listeners, dispose } = landing
      landing = null
      dispose?.()
      window.clearInterval(interval)
      for (const [event, handler, options] of listeners) {
        window.removeEventListener(event, handler, options)
      }
      node.dataset.leaving = ''
      window.setTimeout(() => node.remove(), 220)
    }

    /**
     * Mark the whole message a jump landed on.
     *
     * The message can be taller than the viewport, so the tint covers the
     * intersection of its rectangle with the viewport and follows it until the
     * reader interacts: any wheel, touch, pointer, key or scroll retires it.
     *
     * @param row - the element the jump centred.
     * @param label - the document title, when the caller has one.
     */
    function showLandingCard(row, label, turn) {
      if (!row && !turn) return
      clearLanding()
      ensureLandingStyles()

      const node = document.createElement('div')
      node.className = 'fd-landing-row'

      if (label) {
        const tag = document.createElement('span')
        tag.className = 'fd-landing-tag'
        tag.textContent = label
        node.appendChild(tag)
      }

      const tag = node.firstElementChild

      const place = () => {
        const rect = turnRect(turn, row)
        if (!rect) return
        const height = rect.bottom - rect.top
        if (height < 8) {
          node.style.display = 'none'
          return
        }
        node.style.display = ''
        const left = Math.max(rect.left, 0)
        node.style.top = `${Math.round(rect.top)}px`
        node.style.left = `${Math.round(left)}px`
        node.style.width = `${Math.round(Math.min(rect.right - rect.left, window.innerWidth - left))}px`
        node.style.height = `${Math.round(height)}px`

        if (tag) {
          // Keep the label attached to whichever part of the turn is on screen.
          tag.style.top = `${Math.round(Math.max(0, -rect.top) + 8)}px`
        }
      }

      document.body.appendChild(node)
      place()

      const interval = window.setInterval(place, 150)

      const options = { capture: true, passive: true }
      const dismiss = () => clearLanding()
      const listeners = [
        ['wheel', dismiss, options],
        ['touchstart', dismiss, options],
        ['pointerdown', dismiss, options],
        ['keydown', dismiss, options],
      ]
      for (const [event, handler, opts] of listeners) window.addEventListener(event, handler, opts)

      // The jump itself scrolls; start honouring scroll once it has settled.
      const scrollGuard = window.setTimeout(() => {
        window.addEventListener('scroll', dismiss, options)
        listeners.push(['scroll', dismiss, options])
      }, 450)

      landing = {
        node,
        interval,
        listeners,
        dispose() { window.clearTimeout(scrollGuard) },
      }
    }

    /** The scroll container that actually scrolls this row. */
    function scrollerFor(row) {
      let parent = row && row.parentElement
      for (let depth = 0; parent && depth < 12; depth += 1) {
        if (parent.scrollHeight > parent.clientHeight + 4) return parent
        parent = parent.parentElement
      }
      return transcript()
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
    async function revealRow(row, label, turn) {
      const scroller = scrollerFor(row)
      if (!scroller) return false

      const before = scroller.scrollTop
      try {
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }))
      } catch (error) {
        /* no WheelEvent in this engine */
      }

      const centre = () => {
        const box = row.getBoundingClientRect()
        const port = scroller.getBoundingClientRect()
        scroller.scrollTop += box.top - port.top + box.height / 2 - port.height / 2
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      }

      let attempts = []
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        centre()
        await new Promise((resolve) => window.setTimeout(resolve, 90))
        attempts.push(Math.round(scroller.scrollTop))
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
        before: Math.round(before), after: Math.round(scroller.scrollTop),
        attempts, moved, rowHeight: Math.round(row.getBoundingClientRect().height),
        isScroller: scroller === transcript(),
      })

      showLandingCard(row, label, turn)
      return moved
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
    function HeaderChip(props) {
      const fullId = String((props && (props.sessionId || (props.standard && props.standard.sessionId))) || '')
      const shortId = fullId.slice(0, 20)
      const [data, setData] = useState(null)
      const [doctor, setDoctor] = useState(null)
      const [open, setOpen] = useState(false)
      const [rect, setRect] = useState(null)
      const [note, setNote] = useState('')
      const chipRef = React.useRef(null)
      const popRef = React.useRef(null)
      const renderBeaconed = React.useRef(0)

      useEffect(() => {
        let alive = true
        fetch('/x-feishu-docs/doctor.json', { cache: 'no-store' })
          .then((r) => r.json())
          .then((report) => { if (alive) setDoctor(report) })
          .catch(() => {})
        return () => { alive = false }
      }, [])

      useEffect(() => {
        let alive = true
        loadSession(fullId)
          .then((d) => { if (alive) setData(d) })
          .catch(() => {})
        return () => { alive = false }
      }, [fullId])

      const docs = useMemo(() => (data && data.docs) || [], [data])

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

      const go = async (doc) => {
        report('jump-start', { turn: doc.turn, mid: doc.mid || '', ...pageFacts() })
        const immediate = findTurnRow(doc.turn)
        if (immediate) {
          setOpen(false)
          const moved = await revealRow(immediate, doc.t, doc.turn)
          flash(moved ? `已定位到第 ${doc.turn} 轮` : `第 ${doc.turn} 轮已就位，但页面没能滚动`, 2600)
          return
        }

        flash('正在加载更早的消息…', 20000)
        let row = null
        try {
          row = await ensureTurnLoaded(doc.turn, (n) => flash(`正在加载更早的消息…第 ${n} 次`, 20000))
        } catch (error) {
          report('jump-error', { message: String(error) })
          row = findTurnRow(doc.turn)
        }
        if (row) {
          setOpen(false)
          const moved = await revealRow(row, doc.t, doc.turn)
          flash(moved ? `已定位到第 ${doc.turn} 轮` : `第 ${doc.turn} 轮已就位，但页面没能滚动`, 2600)
          return
        }
        copyText(`${doc.t || ''} · 第 ${doc.turn || '?'} 轮 · ${doc.hm || ''}`)
        flash(`第 ${doc.turn} 轮仍未加载 · 已复制位置`, 2600)
      }

      const toggle = () => {
        if (!open) {
          // A document may have been mentioned since the last render: re-read the
          // Session so the popover never shows a stale list.
          loadSession(fullId, true)
            .then((d) => { setData(d) })
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
              h('div', { className: 'fd-pop-head' },
                h('span', null, '本会话云文档'),
                h('span', { style: { marginLeft: 'auto' } }, `${docs.length} 篇`),
              ),
              h('div', { className: 'fd-pop-body' },
                docs.length === 0
                  ? h('div', { className: 'fd-pop-empty' },
                      data && data.error
                        ? '读取会话记录失败，稍后重试。'
                        : data
                          ? '这个会话里还没有飞书文档'
                          : '读取中…')
                  : null,
                docs.map((d, i) => h('div', { key: d.u },
                  (i === 0 || docs[i - 1].d !== d.d)
                    ? h('div', { className: 'fd-pop-day' }, dayLabel(d.d))
                    : null,
                  h('div', { className: 'fd-pop-row' },
                    h(TypeIcon, { type: d.ty }),
                    h('a', { href: d.u, target: '_blank', rel: 'noreferrer', title: d.t }, d.t),
                    d.by ? h('span', { className: 'fd-by' }, d.by) : null,
                    d.new ? h('span', { className: 'fd-pop-new' }, '新建') : null,
                    h(JumpButton, { doc: d, onTrigger: () => go(d) }),
                  ),
                )),
              ),
              h('div', { className: 'fd-pop-foot' },
                h('span', { className: 'fd-pop-hint' },
                  note || (doctor && doctor.missing && doctor.missing.length
                    ? `数据为快照 · 缺少 ${doctor.missing.map((m) => m.cmd).join(' / ')}，无法重跑扫描器`
                    : '点标题打开飞书，点 ⊙ 定位到该轮'),
                ),
                doctor && doctor.missing && doctor.missing.length
                  ? h('button', {
                      className: 'fd-pop-setup', type: 'button',
                      title: doctor.missing.map((m) => `${m.cmd}：${m.why}\n${m.hint}`).join('\n\n'),
                      onClick: (e) => {
                        e.preventDefault()
                        copyText(doctor.missing.map((m) => `${m.cmd}\t${m.hint}`).join('\n'))
                        flash('已复制安装命令')
                      },
                    }, '依赖')
                  : null,
              ),
            )
          : null,
      )
    }

    return {
      inject: ['slots', 'sidebarRightTabs'],
      apply(ctx) {
        pluginCtx = ctx
        console.info('[feishu-docs] client apply, version 2.0.0')
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
