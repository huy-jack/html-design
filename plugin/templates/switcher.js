/* html-design switcher. Shared by every screen file; screen files carry no JS of their own.
 * Shows one state at a time in a frame of the chosen width, so the app's breakpoints react to the frame.
 * Link format: <screen>.html#<state>@<width>. Pure helpers are also loaded in node by the plugin scripts. */
;(function (root) {
  var WIDTHS = /*WIDTHS*/[1440, 1024, 375]
  var DARK = /*DARK*/{ kind: 'class', name: 'dark' }
  function applyTheme(el, theme) {
    if (DARK.kind === 'class') el.classList.toggle(DARK.name, theme === 'dark')
    else if (theme === 'dark') el.setAttribute(DARK.name, DARK.value); else el.removeAttribute(DARK.name)
  }
  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  }
  function parseHash(hash) {
    var m = /^#?([^@]*)(?:@(\d+))?$/.exec(hash || '')
    var w = m && m[2] ? Number(m[2]) : WIDTHS[0]
    return { id: m && m[1] ? decodeURIComponent(m[1]) : null, width: WIDTHS.indexOf(w) === -1 ? WIDTHS[0] : w }
  }
  // The app may build a different page at a narrower width: use that copy when the state has one.
  function pickHtml(state, width) {
    var html = state.html
    ;(state.variants || []).forEach(function (v) {
      if (width && v.widths.indexOf(width) !== -1) html = v.html
    })
    return html
  }
  function buildStateDoc(state, opts) {
    var a = state.attrs || {}
    // A plain stand-in for the root element, so the same applyTheme works with no DOM (node, string output).
    var toks = (a['data-html-class'] || '').split(/\s+/).filter(Boolean)
    var extra = {}
    applyTheme({
      classList: { toggle: function (n, on) { var i = toks.indexOf(n); if (on && i === -1) toks.push(n); if (!on && i !== -1) toks.splice(i, 1) } },
      setAttribute: function (n, v) { extra[n] = v },
      removeAttribute: function (n) { delete extra[n] },
    }, opts.theme)
    var attrs = ' class="' + esc(toks.join(' ')) + '"'
    Object.keys(extra).forEach(function (n) { attrs += ' ' + n + '="' + esc(extra[n]) + '"' })
    if (a['data-html-vars']) attrs += ' style="' + esc(a['data-html-vars']) + '"'
    return (
      '<!doctype html><html lang="' + esc(a['data-html-lang'] || 'en') + '"' + attrs + '><head><meta charset="utf-8">' +
      '<base href="' + esc(opts.base) + '"><link rel="stylesheet" href="../dist/design.css"><link rel="stylesheet" href="../fonts.css"><link rel="stylesheet" href="../page.css"></head>' +
      '<body class="' + esc(a['data-body-class'] || '') + '"' + (a['data-body-vars'] ? ' style="' + esc(a['data-body-vars']) + '"' : '') + '>' + pickHtml(state, opts.width) + '</body></html>'
    )
  }
  function restoreScroll(doc) {
    var els = doc.querySelectorAll('[data-scroll-top]')
    for (var i = 0; i < els.length; i++) els[i].scrollTop = Number(els[i].getAttribute('data-scroll-top'))
  }
  function stateOf(tpl) {
    var attrs = {}
    for (var i = 0; i < tpl.attributes.length; i++) attrs[tpl.attributes[i].name] = tpl.attributes[i].value
    var variants = Array.prototype.filter
      .call(tpl.ownerDocument.querySelectorAll('body > template[data-variant-of]'), function (v) { return v.getAttribute('data-variant-of') === tpl.id })
      .map(function (v) { return { widths: v.getAttribute('data-widths').split(' ').map(Number), html: v.innerHTML } })
    return { id: tpl.id, html: tpl.innerHTML, attrs: attrs, variants: variants }
  }

  // Previous / Next: the neighbour in file order; null at either end (an end is an end, no wrap).
  function stepState(ids, id, dir) {
    var i = ids.indexOf(id)
    if (i === -1) return ids.length ? ids[0] : null
    var j = i + dir
    return j < 0 || j >= ids.length ? null : ids[j]
  }
  // The block on screen: a width copy is named <state>@<its first width> (serializeScreen names it so).
  function shownBlockId(state, width) {
    var v = (state.variants || []).filter(function (x) { return x.widths.indexOf(width) !== -1 })[0]
    return v ? state.id + '@' + v.widths[0] : state.id
  }
  // A note's address: element-child positions from the state's top, 1-based. Works for a template's
  // content (a DocumentFragment) as well as the frame body, so the browser and node agree.
  function elementPath(el, top) {
    var path = []
    var cur = el
    while (cur && cur !== top) {
      var p = cur.parentNode
      if (!p || !p.children) return null
      path.unshift(Array.prototype.indexOf.call(p.children, cur) + 1)
      cur = p
    }
    return cur === top ? path : null
  }
  function resolvePath(top, path) {
    var cur = top
    for (var i = 0; i < path.length; i++) {
      cur = cur && cur.children ? cur.children[path[i] - 1] : null
      if (!cur) return null
    }
    return cur
  }
  function noteText(el) {
    return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  }
  function isTypingTarget(el) {
    if (!el || !el.tagName) return false
    var t = el.tagName.toLowerCase()
    return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable === true || el.getAttribute('contenteditable') === 'true'
  }
  function readLinks(doc) {
    var el = doc.getElementById('sd-links')
    if (!el) return { links: [], error: null }
    try {
      var v = JSON.parse(el.textContent)
      return Array.isArray(v) ? { links: v, error: null } : { links: [], error: 'The link list is not a list' }
    } catch (e) {
      return { links: [], error: 'The link list is not valid JSON' }
    }
  }
  function parseTarget(to) {
    var i = String(to).indexOf('#')
    return i === -1 ? { screen: null, state: String(to) } : { screen: to.slice(0, i), state: to.slice(i + 1) }
  }
  function linksForState(links, id) {
    var out = []
    for (var i = 0; i < links.length; i++) if (links[i].from === id) out.push({ link: links[i], index: i })
    return out
  }
  var INTERACTIVE = 'button,a,[role="button"],[role="tab"],[role="menuitem"],label,summary'
  // A button by its visible text or aria-label. A wrapper whose whole text is the same label also
  // matches; keep the innermost so one label gives one element. nth picks among the rest in page order.
  // A page that has layout skips elements with no box: screens hold a desktop and a mobile copy of a
  // control, and the width hides one of them. (Without layout, as in node tests, every element counts.)
  function findLinkElement(doc, link) {
    var all = doc.body.getElementsByTagName('*')
    var layout = typeof doc.body.getClientRects === 'function' && doc.body.getClientRects().length > 0
    var hits = []
    for (var i = 0; i < all.length; i++) {
      var el = all[i]
      if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') continue
      if (layout && el.getClientRects().length === 0) continue
      var text = String(el.textContent || '').replace(/\s+/g, ' ').trim()
      if (text !== link.button && el.getAttribute('aria-label') !== link.button) continue
      var pick = (el.closest && el.closest(INTERACTIVE)) || el
      if (hits.indexOf(pick) === -1) hits.push(pick)
    }
    hits = hits.filter(function (h) { return !hits.some(function (o) { return o !== h && h.contains(o) }) })
    return hits[(link.nth || 1) - 1] || null
  }
  // A link click swaps the state into the page already in the frame: a new page would end any motion.
  function swapState(doc, state, opts) {
    var a = state.attrs || {}
    doc.documentElement.className = a['data-html-class'] || ''
    applyTheme(doc.documentElement, opts.theme)
    doc.documentElement.lang = a['data-html-lang'] || 'en'
    doc.body.className = a['data-body-class'] || ''
    if (a['data-html-vars']) doc.documentElement.setAttribute('style', a['data-html-vars']); else doc.documentElement.removeAttribute('style')
    if (a['data-body-vars']) doc.body.setAttribute('style', a['data-body-vars']); else doc.body.removeAttribute('style')
    doc.body.innerHTML = pickHtml(state, opts.width)
  }
  var SLIDES = {
    'slide-left': ['translateX(-100%)', 'translateX(100%)'],
    'slide-right': ['translateX(100%)', 'translateX(-100%)'],
    'slide-up': ['translateY(-100%)', 'translateY(100%)'],
  }
  function motionCss(motion, ms) {
    var css = '::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation-duration:' + ms + 'ms}'
    var s = SLIDES[motion]
    if (s) {
      css += '@keyframes sd-out{to{transform:' + s[0] + '}}@keyframes sd-in{from{transform:' + s[1] + '}}' +
        '::view-transition-old(root){animation-name:sd-out}::view-transition-new(root){animation-name:sd-in}'
    }
    return css
  }
  // Morph: the first element with data-morph="<name>" on each side shares one transition name, so the
  // browser moves and resizes it between the two states. Names are checked by validateLinks.
  function nameMorphs(doc, names) {
    for (var i = 0; i < names.length; i++) {
      var el = doc.querySelector('[data-morph="' + names[i] + '"]')
      if (el) el.style.viewTransitionName = 'sd-' + names[i]
    }
  }
  function runSwap(doc, motion, ms, morph, fn) {
    if (motion === 'none' || typeof doc.startViewTransition !== 'function') {
      fn()
      return null
    }
    var style = doc.getElementById('sd-motion')
    if (!style) {
      style = doc.createElement('style')
      style.id = 'sd-motion'
      doc.head.appendChild(style)
    }
    style.textContent = motionCss(motion, ms)
    if (motion === 'morph') nameMorphs(doc, morph)
    var t = doc.startViewTransition(function () {
      fn()
      if (motion === 'morph') nameMorphs(doc, morph)
    })
    // Names left behind would make a later slide move those elements on their own, not with the page.
    if (motion === 'morph' && t && t.finished) {
      var clear = function () {
        for (var i = 0; i < morph.length; i++) {
          var el = doc.querySelector('[data-morph="' + morph[i] + '"]')
          if (el) el.style.viewTransitionName = ''
        }
      }
      t.finished.then(clear, clear)
    }
    return t
  }

  // The viewer's look (shared tokens with the plugin's home page and Copy window). Dark chrome, so the design is the brightest thing on screen.
  var CSS =
    "@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap');" +
    '.sd-app{--bg:#0c0c0d;--chrome:#121214;--raise:#18181b;--hover:#1f1f23;--line:#232327;--line2:#2e2e33;--ink:#ececee;--dim:#a1a1a8;--mute:#6b6b73;--accent:#4c8dff;--ok:#3ecf8e;--warn:#f5b84b;' +
    'position:fixed;inset:0;display:grid;grid-template-columns:264px minmax(0,1fr);background:var(--bg);color:var(--ink);font:13px/1.45 Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;color-scheme:dark}' +
    '.sd-app *{box-sizing:border-box}.sd-app svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}' +
    '.sd-side{background:var(--chrome);border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0}' +
    '.sd-scr{height:52px;display:flex;align-items:center;gap:8px;padding:0 12px 0 10px;border-bottom:1px solid var(--line);flex:none}' +
    '.sd-scr a{display:grid;place-items:center;width:26px;height:26px;border-radius:6px;color:var(--mute)}.sd-scr a:hover{background:var(--hover);color:var(--ink)}' +
    '.sd-scr b{flex:1;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sd-kbd{font:500 10.5px "Geist Mono",ui-monospace,monospace;color:var(--mute);border:1px solid var(--line2);border-radius:4px;padding:1px 4px;line-height:1.3}' +
    '.sd-find{position:relative;margin:12px 12px 4px;flex:none}.sd-find svg{position:absolute;left:10px;top:9px;color:var(--mute)}' +
    '.sd-find input{width:100%;height:32px;padding:0 10px 0 32px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;outline:none}' +
    '.sd-find input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(76,141,255,.18)}.sd-find input::placeholder{color:var(--mute)}' +
    '.sd-list{flex:1;overflow:auto;padding:0 0 12px}' +
    '.sd-grp{padding:14px 16px 6px;color:var(--mute);font-size:11px;font-weight:500;letter-spacing:.04em;text-transform:uppercase}' +
    '.sd-row{display:flex;align-items:center;gap:10px;width:calc(100% - 16px);margin:1px 8px;padding:0 8px;height:32px;border-radius:7px;color:var(--dim);background:none;border:0;font:inherit;text-align:left;cursor:pointer}' +
    '.sd-row:hover{background:var(--hover);color:var(--ink)}.sd-row[aria-current=true]{background:var(--hover);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line2)}' +
    '.sd-row i{font:500 11px "Geist Mono",ui-monospace,monospace;font-style:normal;color:var(--mute);min-width:18px;text-align:right}' +
    '.sd-row span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sd-row small{color:var(--mute);font-size:11px}' +
    '.sd-ndot{width:6px;height:6px;border-radius:50%;background:var(--warn);flex:none}' +
    '.sd-empty{padding:16px;color:var(--mute)}' +
    '.sd-foot{border-top:1px solid var(--line);padding:11px 16px;display:flex;justify-content:space-between;gap:8px;color:var(--mute);font-size:12px;flex:none}' +
    '.sd-main{display:flex;flex-direction:column;min-width:0;min-height:0}' +
    '.sd-bar{height:52px;flex:none;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid var(--line);background:var(--chrome)}' +
    '.sd-title{display:flex;flex-direction:column;line-height:1.25;min-width:0;flex:1}.sd-title b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sd-title span{color:var(--mute);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sd-bar button{height:30px;min-width:30px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 10px;border-radius:7px;color:var(--ink);border:1px solid var(--line2);background:var(--raise);font:inherit;cursor:pointer}' +
    '.sd-bar button:hover{background:var(--hover)}.sd-bar button:disabled{opacity:.4;cursor:default}' +
    '.sd-bar button[aria-pressed=true]{border-color:rgba(76,141,255,.5);background:rgba(76,141,255,.12);color:#cfe0ff}' +
    '.sd-seg{display:inline-flex;padding:2px;background:var(--bg);border:1px solid var(--line);border-radius:8px;gap:2px}' +
    '.sd-bar .sd-seg button{height:26px;border:0;background:none;color:var(--mute);font-size:12.5px;padding:0 9px}.sd-bar .sd-seg button:hover{color:var(--ink);background:none}' +
    '.sd-bar .sd-seg button[aria-pressed=true]{background:var(--hover);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line2)}' +
    '.sd-vr{width:1px;height:20px;background:var(--line);flex:none}' +
    '.sd-bar .sd-plain{border-color:transparent;background:none;color:var(--dim)}.sd-count{font:500 12px "Geist Mono",ui-monospace,monospace;color:var(--mute);min-width:34px;text-align:center}' +
    '[data-sd=notes]{color:var(--mute);font-size:12.5px;white-space:nowrap}[data-sd=notes].sd-has{color:var(--warn)}.sd-hint{color:var(--warn);font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sd-stage{flex:1;min-height:0;overflow:auto;background:#161618;background-image:radial-gradient(#26262b 1px,transparent 1px);background-size:16px 16px;padding:22px 32px 32px}' +
    '.sd-cap{display:flex;justify-content:space-between;gap:16px;color:var(--mute);font-size:12px;height:18px;line-height:18px;overflow:hidden;margin:0 auto 10px}.sd-cap b{font:500 12px "Geist Mono",ui-monospace,monospace;color:var(--dim)}' +
    '.sd-fit{margin:0 auto;position:relative;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.06),0 24px 60px -12px rgba(0,0,0,.6);background:#fff}' +
    '.sd-frame{position:absolute;top:0;left:0;border:0;background:#fff;transform-origin:0 0}' +
    '.sd-keys{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:10px 16px;border-top:1px solid var(--line);color:var(--mute);font-size:11.5px;flex:none}' +
    '.sd-keys>span{display:flex;gap:4px;align-items:center}' +
    '.sd-notebox{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;z-index:20;width:min(640px,calc(100vw - 32px));display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px;background:var(--chrome);color:var(--ink);border:1px solid var(--line2);border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.5)}' +
    '.sd-notebox>span{width:100%;color:var(--dim);font-size:12px}' +
    '.sd-notebox input{flex:1 1 240px;height:34px;border:1px solid var(--line2);border-radius:8px;background:var(--bg);color:inherit;padding:0 11px;font:inherit;outline:none}.sd-notebox input:focus{border-color:var(--accent)}' +
    '.sd-notebox button{height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--line2);background:var(--raise);color:var(--ink);font:inherit;cursor:pointer}.sd-notebox button[type=submit]{background:var(--ink);color:#0c0c0d;border-color:var(--ink);font-weight:500}' +
    'body{margin:0}' +
    '@media (max-width:900px){.sd-app{grid-template-columns:1fr}.sd-side{display:none}[data-sd=source]{display:none}.sd-stage{padding:16px}}'

  // Added to the frame's own page only: never part of a screen file or a match picture (render.mjs builds its own page).
  var PICK_CSS =
    '[data-sd-pick]{outline:2px solid #754aa1 !important;outline-offset:-2px !important;cursor:crosshair !important}' +
    '[data-sd-link]{cursor:pointer}[data-sd-flash]{outline:2px dashed #f59e0b !important;outline-offset:2px !important}'

  function init() {
    var doc = root.document
    var states = Array.prototype.map.call(doc.querySelectorAll('body > template[id]:not([data-variant-of])'), stateOf)
    if (!states.length) return
    var ids = states.map(function (s) { return s.id })
    // Pick and the note count need the view server; a double-clicked file has none.
    var served = /^https?:/.test(root.location.protocol)
    // Theme and Pick survive the reload that follows each design change (per tab, best effort).
    var saved = {}
    try { saved = JSON.parse(root.sessionStorage.getItem('sd-view') || '{}') || {} } catch (e) {}
    function saveView() {
      try { root.sessionStorage.setItem('sd-view', JSON.stringify({ theme: theme, picking: picking })) } catch (e) {}
    }
    var theme = saved.theme === 'dark' ? 'dark' : 'light'
    var current = null
    var picking = saved.picking === true
    var pendingReload = false
    var noteInput = null
    var hovered = null
    var noteBox = null
    var style = doc.createElement('style')
    style.textContent = CSS
    doc.head.appendChild(style)
    function button(label, key) {
      var b = doc.createElement('button')
      b.type = 'button'
      b.textContent = label
      if (key) b.setAttribute('data-sd', key)
      return b
    }
    function el(tag, cls, html) {
      var e = doc.createElement(tag)
      if (cls) e.className = cls
      if (html) e.innerHTML = html
      return e
    }
    var ICON = {
      back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
      next: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
      search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
      moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
      pick: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
      desktop: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
      tablet: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M11 18h2"/></svg>',
      phone: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>',
    }
    var app = el('div', 'sd-app')
    // Side: the screen, a filter, every state by group.
    var side = el('aside', 'sd-side')
    var head = el('div', 'sd-scr')
    if (served) {
      var home = el('a', '', ICON.back)
      home.href = '/'
      home.title = 'All screens'
      head.appendChild(home)
    }
    var screenName = doc.documentElement.getAttribute('data-screen') || ''
    var nameEl = el('b')
    nameEl.textContent = screenName || 'Screen'
    head.append(nameEl, el('span', 'sd-kbd', String(states.length)))
    var find = el('label', 'sd-find', ICON.search)
    var search = doc.createElement('input')
    search.type = 'search'
    search.placeholder = 'Filter states'
    search.setAttribute('aria-label', 'Search states')
    find.appendChild(search)
    var list = el('nav', 'sd-list')
    list.setAttribute('data-sd', 'list')
    list.setAttribute('aria-label', 'States')
    var foot = el('div', 'sd-foot')
    var footNotes = el('span')
    var footLinks = el('span')
    foot.append(footNotes, footLinks)
    // Main: the bar, then the stage with the design at its true width.
    var main = el('main', 'sd-main')
    var bar = el('div', 'sd-bar')
    var title = el('div', 'sd-title')
    var titleText = el('b')
    var note = el('span', 'sd-note')
    title.append(titleText, note)
    var linkWarn = el('span', 'sd-hint')
    linkWarn.setAttribute('data-sd', 'link-warn')
    var seg = el('div', 'sd-seg')
    var widthBtns = WIDTHS.map(function (w, i) {
      var b = doc.createElement('button')
      b.type = 'button'
      b.innerHTML = (w >= 1200 ? ICON.desktop : w >= 600 ? ICON.tablet : ICON.phone) + w
      b.title = 'Width ' + w + ' (' + (i + 1) + ')'
      b.dataset.width = String(w)
      seg.appendChild(b)
      return b
    })
    var themeBtn = doc.createElement('button')
    themeBtn.type = 'button'
    themeBtn.innerHTML = ICON.moon
    themeBtn.title = 'Dark (D)'
    themeBtn.setAttribute('aria-label', 'Dark')
    var pickBtn = button('', 'pick')
    pickBtn.innerHTML = ICON.pick + 'Pick'
    pickBtn.title = 'Pick an element and write a note (P)'
    pickBtn.setAttribute('aria-pressed', String(picking))
    var notesBadge = el('span')
    notesBadge.setAttribute('data-sd', 'notes')
    var prevBtn = button('', 'prev')
    prevBtn.innerHTML = ICON.back
    prevBtn.className = 'sd-plain'
    prevBtn.setAttribute('aria-label', 'Previous')
    var count = el('span', 'sd-count')
    var nextBtn = button('', 'next')
    nextBtn.innerHTML = ICON.next
    nextBtn.className = 'sd-plain'
    nextBtn.setAttribute('aria-label', 'Next')
    var read = readLinks(doc)
    var links = read.links
    var handled = false
    var parts = [title, linkWarn, seg, themeBtn]
    if (served) parts = parts.concat([el('span', 'sd-vr'), pickBtn, notesBadge])
    parts = parts.concat([el('span', 'sd-vr'), prevBtn, count, nextBtn])
    bar.append.apply(bar, parts)
    var stage = el('div', 'sd-stage')
    var cap = el('div', 'sd-cap')
    var size = el('span')
    size.setAttribute('data-sd', 'size')
    var source = el('span')
    source.setAttribute('data-sd', 'source')
    cap.append(size, source)
    var fitBox = el('div', 'sd-fit')
    var frame = doc.createElement('iframe')
    frame.className = 'sd-frame'
    frame.title = 'Design state'
    fitBox.appendChild(frame)
    stage.append(cap, fitBox)
    main.append(bar, stage)
    var keys = el('div', 'sd-keys', '<span><span class="sd-kbd">↑</span><span class="sd-kbd">↓</span>state</span><span><span class="sd-kbd">1</span><span class="sd-kbd">2</span><span class="sd-kbd">3</span>width</span><span><span class="sd-kbd">D</span>dark</span>' + (served ? '<span><span class="sd-kbd">P</span>pick</span>' : ''))
    side.append(head, find, list, foot, keys)
    app.append(side, main)
    doc.body.prepend(app)
    var notesBy = {}
    var filterText = ''

    function fill(filter) {
      filterText = filter
      list.textContent = ''
      var shown = 0
      var lastGroup = null
      states.forEach(function (s, i) {
        var text = s.attrs['data-label'] || s.id
        if (filter && text.toLowerCase().indexOf(filter) === -1 && s.id.toLowerCase().indexOf(filter) === -1) return
        var g = s.attrs['data-group'] || 'States'
        if (g !== lastGroup) {
          var gh = el('div', 'sd-grp')
          gh.textContent = g
          gh.setAttribute('data-sd-group', '')
          list.appendChild(gh)
          lastGroup = g
        }
        var row = doc.createElement('button')
        row.type = 'button'
        row.className = 'sd-row'
        row.setAttribute('data-sd-state', s.id)
        var n = el('i')
        n.textContent = String(i + 1)
        var label = el('span')
        label.textContent = text
        row.title = s.id
        row.append(n, label)
        if (notesBy[s.id]) {
          var dot = el('span', 'sd-ndot')
          dot.setAttribute('data-sd-notedot', '')
          dot.title = notesBy[s.id] + ' open note' + (notesBy[s.id] > 1 ? 's' : '')
          row.appendChild(dot)
        }
        var nl = linksForState(links, s.id).length
        if (nl) {
          var small = el('small')
          small.textContent = nl + (nl > 1 ? ' links' : ' link')
          row.appendChild(small)
        }
        if (current && current.s.id === s.id) row.setAttribute('aria-current', 'true')
        row.addEventListener('click', function () { go(s.id, current ? current.width : WIDTHS[0]) })
        list.appendChild(row)
        shown += 1
      })
      if (!shown) list.appendChild(el('div', 'sd-empty', 'No state matches.'))
    }
    function refreshNotes() {
      root
        .fetch('/__notes?screen=' + encodeURIComponent(screenName))
        .then(function (r) { return r.json() })
        .then(
          function (j) {
            notesBadge.textContent = j.error || j.open + ' open notes'
            notesBadge.className = j.error || j.open ? 'sd-has' : ''
            notesBy = j.byState || {}
            var here = 0
            for (var k in notesBy) here += notesBy[k]
            footNotes.textContent = here ? here + ' open note' + (here > 1 ? 's' : '') + ' here' : ''
            fill(filterText)
          },
          function () { notesBadge.textContent = '' },
        )
    }
    // Scale the true-width frame down to fit the stage; never up. The frame keeps its real width, so the
    // app's breakpoints see 1440, 1024 or 375, whatever the window size.
    function fit() {
      if (!current) return
      var w = current.width
      var avail = stage.clientWidth - 64
      var k = avail > 0 ? Math.min(1, avail / w) : 1
      var h = Math.max(900, Math.floor((stage.clientHeight - 64) / k))
      frame.style.width = w + 'px'
      frame.style.height = h + 'px'
      frame.style.transform = k < 1 ? 'scale(' + k + ')' : ''
      fitBox.style.width = Math.round(w * k) + 'px'
      fitBox.style.height = Math.round(h * k) + 'px'
      cap.style.width = Math.round(w * k) + 'px'
      size.innerHTML = '<b>' + w + ' px</b>' + (k < 1 ? ' · shown at ' + Math.round(k * 100) + '%' : '')
    }
    // The bar for the state on screen. Step 2's same-page swap calls this too.
    function syncBar(s, width) {
      current = { s: s, width: width }
      titleText.textContent = s.attrs['data-label'] || s.id
      note.textContent = s.attrs['data-note'] || s.id
      widthBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.width) === width)) })
      themeBtn.setAttribute('aria-pressed', String(theme === 'dark'))
      prevBtn.disabled = stepState(ids, s.id, -1) === null
      nextBtn.disabled = stepState(ids, s.id, 1) === null
      count.textContent = ids.indexOf(s.id) + 1 + '/' + ids.length
      source.textContent = s.attrs['data-url'] ? 'Copied from ' + s.attrs['data-url'] : ''
      Array.prototype.forEach.call(list.querySelectorAll('[data-sd-state]'), function (r) {
        if (r.getAttribute('data-sd-state') === s.id) {
          r.setAttribute('aria-current', 'true')
          if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' })
        } else r.removeAttribute('aria-current')
      })
      fit()
    }
    // saving: the note's POST, when the box closes on Save. A waiting reload goes after it, or it would cancel the save.
    function closeNoteBox(saving) {
      if (noteBox) noteBox.remove()
      noteBox = null
      noteInput = null
      if (!pendingReload) return
      if (saving && typeof saving.then === 'function') saving.then(reloadNow, reloadNow)
      else reloadNow()
    }
    function reloadNow() {
      saveView()
      root.location.reload()
    }
    // A design change reloads the page. Wait while the designer is typing a note, or the words are lost.
    function requestReload() {
      if (noteInput && noteInput.value.trim()) {
        pendingReload = true
        notesBadge.textContent = 'The page reloads after your note'
        return
      }
      reloadNow()
    }
    function postNote(n) {
      return root
        .fetch('/__notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(n) })
        .then(function (r) {
          return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'The note was not saved') })
        })
        .then(refreshNotes, function (err) { notesBadge.textContent = err.message })
    }
    function openNoteBox(el) {
      var path = elementPath(el, frame.contentDocument.body)
      if (!path || !path.length) return
      closeNoteBox()
      var at = current
      var text = noteText(el)
      var tag = el.tagName.toLowerCase()
      noteBox = doc.createElement('form')
      noteBox.className = 'sd-notebox'
      var label = doc.createElement('span')
      label.textContent = 'Note for ' + tag + (text ? ' "' + text + '"' : '')
      var input = doc.createElement('input')
      noteInput = input
      input.setAttribute('aria-label', 'Note')
      input.setAttribute('data-sd', 'note-input')
      var save = doc.createElement('button')
      save.type = 'submit'
      save.textContent = 'Save note'
      var cancel = button('Cancel')
      cancel.addEventListener('click', function () { closeNoteBox() })
      noteBox.append(label, input, save, cancel)
      noteBox.addEventListener('submit', function (e) {
        e.preventDefault()
        var words = input.value.trim()
        if (!words) return
        closeNoteBox(postNote({ screen: doc.documentElement.getAttribute('data-screen') || '', state: shownBlockId(at.s, at.width), width: at.width, theme: theme, path: path, text: text, tag: tag, note: words }))
      })
      doc.body.appendChild(noteBox)
      input.focus()
    }
    function onFrameClick(e) {
      if (e.target.closest && e.target.closest('a')) e.preventDefault()
      if (picking) {
        e.preventDefault()
        e.stopPropagation()
        openNoteBox(e.target)
        return
      }
      var hit = e.target.closest && e.target.closest('[data-sd-link]')
      if (hit) {
        e.preventDefault()
        follow(links[Number(hit.getAttribute('data-sd-link'))])
      } else flash(frame.contentDocument)
    }
    function onFrameHover(e) {
      if (hovered) hovered.removeAttribute('data-sd-pick')
      hovered = picking ? e.target : null
      if (hovered) hovered.setAttribute('data-sd-pick', '')
    }
    function markLinks(d, s, width) {
      var lost = []
      linksForState(links, s.id).forEach(function (x) {
        var el = findLinkElement(d, x.link)
        if (el) el.setAttribute('data-sd-link', String(x.index))
        else lost.push(x.link.button)
      })
      var lostText = lost.length === 1 ? '1 link lost its button: ' : lost.length + ' links lost their buttons: '
      linkWarn.textContent = read.error || (lost.length ? lostText + lost.join(', ') + ', on ' + s.id + ' @' + width : '')
    }
    function flash(d) {
      var els = d.querySelectorAll('[data-sd-link]')
      for (var i = 0; i < els.length; i++) els[i].setAttribute('data-sd-flash', '')
      root.setTimeout(function () {
        for (var j = 0; j < els.length; j++) els[j].removeAttribute('data-sd-flash')
      }, 600)
    }
    function follow(link) {
      var t = parseTarget(link.to)
      var width = current.width
      if (t.screen && t.screen !== screenName) {
        root.location.href = t.screen + '.html#' + encodeURIComponent(t.state) + '@' + width
        return
      }
      var target = states.filter(function (x) { return x.id === t.state })[0]
      if (!target) {
        linkWarn.textContent = 'Not designed yet: ' + t.state
        return
      }
      var d = frame.contentDocument
      runSwap(d, link.motion || 'none', link.ms || 300, link.morph || [], function () {
        swapState(d, target, { theme: theme, width: width })
        restoreScroll(d)
        markLinks(d, target, width)
      })
      // The address listener rebuilds the frame on every change; this change is already on screen.
      // Same address: no change event would come to clear the flag, so do not set it.
      var nextHash = '#' + encodeURIComponent(target.id) + '@' + width
      if (root.location.hash !== nextHash) {
        handled = true
        root.location.hash = nextHash
      }
      syncBar(target, width)
    }
    function onKey(e) {
      if (e.key === 'Escape') return closeNoteBox()
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        var to = stepState(ids, current.s.id, e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1)
        if (!to) return
        e.preventDefault()
        return go(to, current.width)
      }
      var n = Number(e.key)
      if (n >= 1 && n <= WIDTHS.length) return go(current.s.id, WIDTHS[n - 1])
      if (e.key === 'd' || e.key === 'D') return toggleTheme()
      if ((e.key === 'p' || e.key === 'P') && served) return togglePick()
    }
    function show() {
      var h = parseHash(root.location.hash)
      var s = states.filter(function (x) { return x.id === h.id })[0] || states[0]
      syncBar(s, h.width)
      frame.onload = function () {
        var d = frame.contentDocument
        restoreScroll(d)
        markLinks(d, s, h.width)
        var pickStyle = d.createElement('style')
        pickStyle.textContent = PICK_CSS
        d.head.appendChild(pickStyle)
        d.addEventListener('click', onFrameClick, true)
        d.addEventListener('mouseover', onFrameHover)
        d.addEventListener('keydown', onKey)
      }
      frame.srcdoc = buildStateDoc(s, { theme: theme, base: root.location.href.split('#')[0], width: h.width })
    }
    function go(id, width) {
      root.location.hash = encodeURIComponent(id) + '@' + width
    }
    function toggleTheme() {
      theme = theme === 'dark' ? 'light' : 'dark'
      saveView()
      show()
    }
    function togglePick() {
      picking = !picking
      saveView()
      pickBtn.setAttribute('aria-pressed', String(picking))
      if (!picking && hovered) hovered.removeAttribute('data-sd-pick')
      if (!picking) closeNoteBox()
    }
    search.addEventListener('input', function () { fill(search.value.trim().toLowerCase()) })
    widthBtns.forEach(function (b) { b.addEventListener('click', function () { go(current.s.id, Number(b.dataset.width)) }) })
    themeBtn.addEventListener('click', toggleTheme)
    prevBtn.addEventListener('click', function () { var to = stepState(ids, current.s.id, -1); if (to) go(to, current.width) })
    nextBtn.addEventListener('click', function () { var to = stepState(ids, current.s.id, 1); if (to) go(to, current.width) })
    pickBtn.addEventListener('click', togglePick)
    root.addEventListener('resize', fit)
    doc.addEventListener('keydown', onKey)
    root.addEventListener('hashchange', function () {
      if (handled) {
        handled = false
        return
      }
      show()
    })
    if (served) {
      try {
        var events = new root.EventSource('/__reload')
        events.onmessage = requestReload
        // A failed CSS build: the last good CSS stays, and the error shows as a red bar until the next good build.
        events.addEventListener('buildError', function (e) {
          var bar = doc.querySelector('[data-sd="build-error"]')
          if (!bar) {
            bar = doc.createElement('div')
            bar.setAttribute('data-sd', 'build-error')
            bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#b00020;color:#fff;font:13px/1.4 monospace;padding:8px 16px;white-space:pre-wrap'
            doc.body.appendChild(bar)
          }
          try { bar.textContent = JSON.parse(e.data) } catch (x) { bar.textContent = String(e.data) }
        })
      } catch (e) {}
      refreshNotes()
    }
    linkWarn.textContent = read.error || ''
    var total = links.length
    footLinks.textContent = total ? total + (total > 1 ? ' links' : ' link') : ''
    show()
    fill('')
  }

  root.HtmlDesign = {
    WIDTHS: WIDTHS, parseHash: parseHash, buildStateDoc: buildStateDoc, restoreScroll: restoreScroll,
    stepState: stepState, shownBlockId: shownBlockId, elementPath: elementPath, resolvePath: resolvePath,
    noteText: noteText, isTypingTarget: isTypingTarget,
    readLinks: readLinks, parseTarget: parseTarget, linksForState: linksForState, findLinkElement: findLinkElement,
    pickHtml: pickHtml, swapState: swapState, motionCss: motionCss, runSwap: runSwap,
  }
  if (root.document && root.document.addEventListener) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init)
    else init()
  }
})(typeof window !== 'undefined' ? window : globalThis)
