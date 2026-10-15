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

  var CSS =
    '.sd-bar{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;background:#1f1f24;color:#f4f4f5;font:13px/1.4 system-ui,sans-serif}' +
    '.sd-bar input,.sd-bar select,.sd-bar button{font:inherit;border:1px solid #52525b;border-radius:6px;background:#27272a;color:inherit;padding:4px 8px;min-height:32px}' +
    '.sd-bar button[aria-pressed=true]{background:#754aa1;border-color:#754aa1}' +
    '.sd-note{color:#a1a1aa}.sd-stage{display:flex;justify-content:center;padding:16px;background:#e4e4e7;min-height:calc(100vh - 48px)}' +
    '.sd-frame{border:0;height:900px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);max-width:100%}' +
    'body{margin:0}' +
    '.sd-bar button:disabled{opacity:.5;cursor:default}.sd-hint{color:#fbbf24}' +
    '.sd-notebox{position:fixed;left:16px;right:16px;bottom:16px;z-index:20;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px;background:#1f1f24;color:#f4f4f5;border-radius:8px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.3)}' +
    '.sd-notebox input{flex:1 1 240px;font:inherit;border:1px solid #52525b;border-radius:6px;background:#27272a;color:inherit;padding:4px 8px;min-height:32px}' +
    '.sd-notebox button{font:inherit;border:1px solid #52525b;border-radius:6px;background:#27272a;color:inherit;padding:4px 8px;min-height:32px}'
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
    var bar = doc.createElement('div')
    bar.className = 'sd-bar'
    var search = doc.createElement('input')
    search.type = 'search'
    search.placeholder = 'Search states'
    search.setAttribute('aria-label', 'Search states')
    var select = doc.createElement('select')
    select.setAttribute('aria-label', 'State')
    var prevBtn = button('Previous', 'prev')
    var nextBtn = button('Next', 'next')
    var widthBtns = WIDTHS.map(function (w) {
      var b = button(String(w))
      b.dataset.width = String(w)
      return b
    })
    var themeBtn = button('Dark')
    var note = doc.createElement('span')
    note.className = 'sd-note'
    var pickBtn = button('Pick', 'pick')
    pickBtn.setAttribute('aria-pressed', String(picking))
    var notesBadge = doc.createElement('span')
    notesBadge.setAttribute('data-sd', 'notes')
    var linkWarn = doc.createElement('span')
    linkWarn.className = 'sd-hint'
    linkWarn.setAttribute('data-sd', 'link-warn')
    var read = readLinks(doc)
    var links = read.links
    var handled = false
    var screenName = doc.documentElement.getAttribute('data-screen') || ''
    var parts = [search, select, prevBtn, nextBtn].concat(widthBtns, [themeBtn, note, linkWarn])
    if (served) parts = parts.concat([pickBtn, notesBadge])
    bar.append.apply(bar, parts)
    var stage = doc.createElement('div')
    stage.className = 'sd-stage'
    var frame = doc.createElement('iframe')
    frame.className = 'sd-frame'
    frame.title = 'Design state'
    stage.appendChild(frame)
    doc.body.prepend(bar, stage)

    function fill(filter) {
      select.textContent = ''
      var groups = {}
      states.forEach(function (s) {
        var text = (s.attrs['data-label'] || s.id)
        if (filter && text.toLowerCase().indexOf(filter) === -1 && s.id.indexOf(filter) === -1) return
        var g = s.attrs['data-group'] || 'States'
        if (!groups[g]) {
          groups[g] = doc.createElement('optgroup')
          groups[g].label = g
          select.appendChild(groups[g])
        }
        var o = doc.createElement('option')
        o.value = s.id
        o.textContent = text
        groups[g].appendChild(o)
      })
    }
    function refreshNotes() {
      root
        .fetch('/__notes')
        .then(function (r) { return r.json() })
        .then(
          function (j) { notesBadge.textContent = j.error || j.open + ' open notes' },
          function () { notesBadge.textContent = '' },
        )
    }
    // The bar for the state on screen. Step 2's same-page swap calls this too.
    function syncBar(s, width) {
      current = { s: s, width: width }
      select.value = s.id
      widthBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.width) === width)) })
      themeBtn.setAttribute('aria-pressed', String(theme === 'dark'))
      note.textContent = s.attrs['data-note'] || ''
      prevBtn.disabled = stepState(ids, s.id, -1) === null
      nextBtn.disabled = stepState(ids, s.id, 1) === null
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
      if (isTypingTarget(e.target)) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      var to = stepState(ids, current.s.id, e.key === 'ArrowLeft' ? -1 : 1)
      if (!to) return
      e.preventDefault()
      go(to, current.width)
    }
    function show() {
      var h = parseHash(root.location.hash)
      var s = states.filter(function (x) { return x.id === h.id })[0] || states[0]
      syncBar(s, h.width)
      frame.style.width = h.width + 'px'
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
    search.addEventListener('input', function () { fill(search.value.trim().toLowerCase()) })
    select.addEventListener('change', function () { go(select.value, parseHash(root.location.hash).width) })
    widthBtns.forEach(function (b) { b.addEventListener('click', function () { go(select.value, Number(b.dataset.width)) }) })
    themeBtn.addEventListener('click', function () { theme = theme === 'dark' ? 'light' : 'dark'; saveView(); show() })
    prevBtn.addEventListener('click', function () { var to = stepState(ids, current.s.id, -1); if (to) go(to, current.width) })
    nextBtn.addEventListener('click', function () { var to = stepState(ids, current.s.id, 1); if (to) go(to, current.width) })
    pickBtn.addEventListener('click', function () {
      picking = !picking
      saveView()
      pickBtn.setAttribute('aria-pressed', String(picking))
      if (!picking && hovered) hovered.removeAttribute('data-sd-pick')
      if (!picking) closeNoteBox()
    })
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
    fill('')
    show()
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
