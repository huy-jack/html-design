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

  // The viewer's look: the same tokens as the plugin's home page and Copy tab. Light by default, dark when the
  // computer asks for it; data-ui on .sd-app is the user's own choice (key hd-ui). The design stays the brightest
  // thing on screen: tool colors stay outside the frame, except the Pick outline and tag while Pick is on.
  var UI_LIGHT = '--bg:#ffffff;--chrome:#f6f7f9;--raise:#ffffff;--hover:#eceef2;--line:#e4e4e7;--edge:#8e8e98;--ink:#18181b;--dim:#52525b;--mute:#63636b;--accent:#2563eb;--accent-h:#1d4ed8;--accent-p:#1e40af;--link:#2563eb;--sel:#eff4ff;--sel-ink:#1e40af;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;--bad-bg:#fef2f2;--stage:#e9ebef;--ring:#8e8e98;--pick:#e11d74;color-scheme:light'
  var UI_DARK = '--bg:#111113;--chrome:#18181b;--raise:#1f1f23;--hover:#2a2a2e;--line:#2a2a2e;--edge:#71717a;--ink:#f4f4f5;--dim:#a1a1aa;--mute:#8b8b94;--link:#7aa7ff;--sel:#1c2a4a;--sel-ink:#f4f4f5;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--bad-bg:#2c1515;--stage:#0b0b0d;--ring:#71717a;color-scheme:dark'
  var MONO = '"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace'
  var CSS =
    "@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap');" +
    '.sd-app{' + UI_LIGHT + ';position:fixed;inset:0;display:grid;grid-template-columns:264px minmax(0,1fr);background:var(--bg);color:var(--ink);font:14px/1.5 Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}' +
    '@media (prefers-color-scheme:dark){.sd-app:not([data-ui=light]){' + UI_DARK + '}}.sd-app[data-ui=dark]{' + UI_DARK + '}' +
    '.sd-app.sd-nolist{grid-template-columns:minmax(0,1fr)}.sd-nolist .sd-side{display:none}' +
    '.sd-app *{box-sizing:border-box}.sd-app [hidden]{display:none !important}.sd-app :focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
    '.sd-app svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}' +
    '.sd-side{background:var(--chrome);border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0}' +
    '.sd-scr{height:56px;display:flex;align-items:center;gap:8px;padding:0 12px 0 8px;border-bottom:1px solid var(--line);flex:none}' +
    '.sd-scr a{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;color:var(--dim)}.sd-scr a:hover{background:var(--hover);color:var(--ink)}' +
    '.sd-scr b{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sd-scr small{color:var(--dim);font-size:12px;white-space:nowrap}' +
    '.sd-kbd{font:500 12px/1.4 ' + MONO + ';color:var(--dim);border:1px solid var(--edge);border-radius:4px;padding:0 4px}' +
    '.sd-find{position:relative;margin:12px 12px 4px;flex:none;display:block}.sd-find svg{position:absolute;left:12px;top:10px;color:var(--mute)}' +
    '.sd-find input{width:100%;height:36px;padding:0 64px 0 36px;border:1px solid var(--edge);border-radius:8px;background:var(--raise);color:var(--ink);font:inherit;outline:none}' +
    '.sd-find input:focus{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}.sd-find input::placeholder{color:var(--mute)}' +
    '.sd-find [data-sd=filter-count]{position:absolute;right:10px;top:8px;font-size:12px;color:var(--dim);pointer-events:none}' +
    '.sd-list{flex:1;overflow:auto;padding:0 0 12px}' +
    '.sd-grp{padding:16px 16px 8px;color:var(--dim);font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase}' +
    '.sd-row{display:flex;align-items:center;gap:8px;width:calc(100% - 16px);margin:1px 8px;padding:0 8px;height:34px;border-radius:8px;color:var(--ink);background:none;border:0;font:inherit;text-align:left;cursor:pointer}' +
    '.sd-row:hover{background:var(--hover)}.sd-row[aria-current=true]{background:var(--sel);color:var(--sel-ink);font-weight:500;box-shadow:inset 3px 0 0 var(--accent)}' +
    '.sd-row i{font:500 12px ' + MONO + ';font-style:normal;color:var(--dim);min-width:20px;text-align:right}' +
    '.sd-row .sd-lab{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sd-row small{color:var(--dim);font-size:12px;font-weight:400}' +
    '.sd-ndot{width:8px;height:8px;border-radius:50%;background:var(--warn);flex:none}.sd-ncount{color:var(--warn);font-size:12px;font-weight:600;flex:none}' +
    '.sd-empty{padding:16px;color:var(--dim)}' +
    '.sd-foot{border-top:1px solid var(--line);padding:8px 16px;color:var(--dim);font-size:12px;flex:none}.sd-foot:empty{display:none}' +
    '.sd-main{display:flex;flex-direction:column;min-width:0;min-height:0;position:relative}' +
    '.sd-bar{height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--line);background:var(--chrome)}' +
    '.sd-title{display:flex;flex-direction:column;line-height:1.3;min-width:60px;flex:1}.sd-title b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sd-title span{color:var(--dim);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sd-bar button,.sd-bar select{height:34px;min-width:34px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 8px;border-radius:8px;color:var(--ink);border:1px solid var(--edge);background:var(--raise);font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap}' +
    '.sd-bar button:hover{background:var(--hover)}.sd-bar button:disabled{opacity:.45;cursor:not-allowed}' +
    '.sd-bar [data-sd=pick][aria-pressed=true]{background:var(--pick);border-color:var(--pick);color:#fff}' +
    '.sd-seg{display:inline-flex;padding:2px;background:var(--chrome);border:1px solid var(--edge);border-radius:8px;gap:2px}' +
    '.sd-bar .sd-seg button{height:28px;border:0;background:none;color:var(--dim);padding:0 8px}.sd-bar .sd-seg button:hover{color:var(--ink);background:var(--hover)}' +
    '.sd-bar .sd-seg button[aria-pressed=true]{background:var(--accent);color:#fff}' +
    '.sd-vr{width:1px;height:24px;background:var(--line);flex:none}' +
    '.sd-bar .sd-plain{border-color:transparent;background:none;padding:0}.sd-count{font:500 12px ' + MONO + ';color:var(--dim);min-width:40px;text-align:center}' +
    '.sd-bar [data-sd=notes].sd-has{color:var(--warn)}.sd-hint{color:var(--warn);font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '[data-sd=status]{font-size:12px;color:var(--dim);display:inline-flex;align-items:center;gap:8px;white-space:nowrap}' +
    '.sd-spin{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:sd-spin .8s linear infinite}@keyframes sd-spin{to{transform:rotate(360deg)}}' +
    '.sd-bar [data-sd=state-pick]{display:none;max-width:200px;padding:0 8px;margin-right:auto}' +
    '.sd-bar .sd-homebar{display:none;place-items:center;width:34px;height:34px;border-radius:8px;color:var(--dim);flex:none}.sd-bar .sd-homebar:hover{background:var(--hover);color:var(--ink)}' +
    '.sd-stage{flex:1;min-height:0;overflow:auto;background:var(--stage);padding:20px 32px 32px}' +
    '.sd-banners{display:grid;gap:8px;margin:0 auto}.sd-banners:not(:empty){margin-bottom:12px}' +
    '.sd-pickbar{background:var(--pick);color:#fff;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:500}' +
    '.sd-stopped{background:var(--raise);border:1px solid var(--edge);color:var(--ink);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:500}' +
    '.sd-buildcard{display:grid;grid-template-columns:auto 1fr;gap:4px 8px;background:var(--bad-bg);border:1px solid var(--bad);border-radius:12px;padding:12px 16px;font-size:13px}.sd-buildcard>svg{color:var(--bad);margin-top:2px}' +
    '.sd-buildcard details{grid-column:2}.sd-buildcard summary{cursor:pointer;color:var(--dim)}.sd-buildcard pre{white-space:pre-wrap;font:12px/1.5 ' + MONO + ';color:var(--dim);margin:8px 0 0}' +
    '.sd-cap{display:flex;align-items:center;justify-content:space-between;gap:16px;color:var(--dim);font-size:12px;min-height:28px;margin:0 auto 8px;overflow:hidden}.sd-cap b{font:500 12px ' + MONO + ';color:var(--ink)}' +
    '.sd-capl{display:flex;align-items:center;gap:8px}[data-sd=source]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sd-zoom{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--edge);border-radius:8px;background:var(--chrome)}' +
    '.sd-zoom button{height:24px;padding:0 8px;border:0;border-radius:6px;background:none;color:var(--dim);font:inherit;font-size:12px;font-weight:500;cursor:pointer}.sd-zoom button[aria-pressed=true]{background:var(--accent);color:#fff}' +
    '.sd-fit{margin:0 auto;position:relative;border-radius:12px;overflow:hidden;box-shadow:0 0 0 1px var(--ring),0 12px 32px -12px rgba(0,0,0,.3);background:#fff}' +
    '.sd-frame{position:absolute;top:0;left:0;border:0;background:#fff;transform-origin:0 0}' +
    '.sd-keys{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:8px 16px;border-top:1px solid var(--line);color:var(--dim);font-size:12px;flex:none}' +
    '.sd-keys>span{display:flex;gap:4px;align-items:center}' +
    '.sd-app .sd-btn{height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--edge);background:var(--raise);color:var(--ink);font:inherit;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap}.sd-app .sd-btn:hover{background:var(--hover)}' +
    '.sd-app .sd-primary{background:var(--accent);border-color:var(--accent);color:#fff}.sd-app .sd-primary:hover{background:var(--accent-h)}.sd-app .sd-primary:active{background:var(--accent-p)}.sd-app .sd-btn:disabled{opacity:.6;cursor:default}' +
    // The dock: a row under the stage for the note box, the notes list and the toast. The stage gets shorter,
    // so these never cover the design.
    '.sd-dock{flex:none;display:grid;gap:8px;justify-items:center;padding:12px 16px;border-top:1px solid var(--line);background:var(--chrome)}.sd-dock:not(:has(> :not([hidden]))){display:none}' +
    '.sd-notebox{width:min(720px,100%);display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--ink)}' +
    '.sd-notebox [data-sd=note-label]{width:100%;font-size:13px;font-weight:500;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sd-notebox input{flex:1 1 240px;height:38px;border:1px solid var(--edge);border-radius:8px;background:var(--raise);color:inherit;padding:0 12px;font:inherit;outline:none}.sd-notebox input:focus{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}' +
    '.sd-notebox [data-sd=note-error]{width:100%;margin:0;color:var(--bad);font-size:13px;font-weight:500}' +
    '.sd-notebox [data-sd=discard]{width:100%;display:flex;gap:8px;align-items:center}.sd-notebox [data-sd=discard] span{flex:1;font-weight:600}' +
    '.sd-toast{width:min(720px,100%);display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--ink);font-weight:500}' +
    '.sd-picktag{position:fixed;z-index:19;pointer-events:none;background:var(--pick);color:#fff;font-size:12px;font-weight:600;line-height:20px;padding:0 8px;border-radius:6px;white-space:nowrap}' +
    '.sd-nlist{width:min(720px,100%);max-height:40vh;overflow:auto;color:var(--ink)}' +
    '.sd-nlist h3{font-size:16px;font-weight:600;padding:2px 8px 8px;margin:0}.sd-nlist>p{margin:0;padding:8px;color:var(--dim);font-size:13px}' +
    '.sd-nrow{padding:8px 8px;border-top:1px solid var(--line)}.sd-ngo{background:none;border:0;padding:0;color:var(--link);font:inherit;font-size:13px;font-weight:500;cursor:pointer;text-align:left}' +
    '.sd-nrow p{margin:4px 0 8px;overflow-wrap:anywhere}.sd-nrow input{width:100%;height:36px;margin:8px 0 8px;border:1px solid var(--edge);border-radius:8px;background:var(--raise);color:inherit;padding:0 8px;font:inherit}' +
    '.sd-nact{display:flex;gap:8px}.sd-nact .sd-btn{height:30px;padding:0 8px;font-size:13px}' +
    '.sd-nlist .sd-nfoot{border-top:1px solid var(--line);margin-top:4px}' +
    'body{margin:0}' +
    '@media (max-width:1280px){.sd-bar .sd-seg svg{display:none}}' +
    '@media (max-width:900px){.sd-app,.sd-app.sd-nolist{grid-template-columns:minmax(0,1fr)}.sd-side{display:none}[data-sd=source]{display:none}.sd-stage{padding:16px}.sd-bar [data-sd=state-pick]{display:inline-flex}.sd-bar [data-sd=hide-list],.sd-bar .sd-title{display:none}.sd-bar .sd-homebar{display:grid}}'

  // Added to the frame's own page only: never part of a screen file or a match picture (render.mjs builds its own page).
  var PICK_CSS =
    '[data-sd-pick]{outline:2px dashed #e11d74 !important;outline-offset:-2px !important;cursor:crosshair !important}' +
    '[data-sd-picking] *{cursor:crosshair !important}' +
    '[data-sd-link]{cursor:pointer}[data-sd-flash]{outline:2px dashed #f59e0b !important;outline-offset:2px !important}'
  var STOPPED = 'Session stopped. Notes cannot be saved. In Claude Code, type /html-design start.'
  var PICK_TITLE = 'Pick an element and write a note (P)'

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
    // One-time flags across that reload: Updated in the bar, the note toast.
    function takeFlag(k) {
      try { var v = root.sessionStorage.getItem(k); root.sessionStorage.removeItem(k); return v === '1' } catch (e) { return false }
    }
    function setFlag(k) { try { root.sessionStorage.setItem(k, '1') } catch (e) {} }
    // Settings of the tool itself, shared by every plugin page of this server (home, Copy tab, viewer).
    function getLocal(k) { try { return root.localStorage.getItem(k) } catch (e) { return null } }
    function setLocal(k, v) { try { if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v) } catch (e) {} }
    var theme = saved.theme === 'dark' ? 'dark' : 'light'
    var current = null
    var picking = saved.picking === true
    var pendingReload = false
    var noteInput = null
    var hovered = null
    var noteBox = null
    var saving = false
    var stopped = false
    var listOpen = false
    var zoom = getLocal('hd-zoom') === '100' ? '100' : 'fit'
    var scale = 1
    // The open note box's own handlers (set while a box is open).
    var askDiscard = null
    var keepWriting = null
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
    function tagged(tag, cls, key, text) {
      var e = el(tag, cls)
      e.setAttribute('data-sd', key)
      if (text) e.textContent = text
      return e
    }
    var plural = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's') }
    var ICON = {
      back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
      next: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
      search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
      contrast: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/></svg>',
      moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
      sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
      side: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
      pick: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
      alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>',
      desktop: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
      tablet: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M11 18h2"/></svg>',
      phone: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>',
    }
    var app = el('div', 'sd-app')
    if (getLocal('hd-ui')) app.setAttribute('data-ui', getLocal('hd-ui'))
    // Side: the screen, a filter, every state by group.
    var side = el('aside', 'sd-side')
    var head = el('div', 'sd-scr')
    if (served) {
      var home = el('a', '', ICON.back)
      home.href = '/'
      home.title = 'All screens'
      home.setAttribute('aria-label', 'All screens')
      head.appendChild(home)
    }
    var screenName = doc.documentElement.getAttribute('data-screen') || ''
    var nameEl = el('b')
    nameEl.textContent = screenName || 'Screen'
    head.append(nameEl, tagged('small', '', 'states', plural(states.length, 'state')))
    var find = el('label', 'sd-find', ICON.search)
    var search = doc.createElement('input')
    search.type = 'search'
    search.placeholder = 'Filter states'
    search.setAttribute('aria-label', 'Search states')
    var findCount = tagged('span', '', 'filter-count')
    find.append(search, findCount)
    var list = el('nav', 'sd-list')
    list.setAttribute('data-sd', 'list')
    list.setAttribute('aria-label', 'States')
    var foot = el('div', 'sd-foot')
    // Main: the bar, then the stage with the design at its true width.
    var main = el('main', 'sd-main')
    var bar = el('div', 'sd-bar')
    var hideBtn = button('', 'hide-list')
    hideBtn.innerHTML = ICON.side
    hideBtn.className = 'sd-plain'
    var title = el('div', 'sd-title')
    var titleText = el('b')
    var note = el('span', 'sd-note')
    title.append(titleText, note)
    var status = tagged('span', '', 'status')
    status.setAttribute('role', 'status')
    var linkWarn = el('span', 'sd-hint')
    linkWarn.setAttribute('data-sd', 'link-warn')
    // Below 900 px the side list is gone: the states are a drop-down here.
    var statePick = tagged('select', '', 'state-pick')
    statePick.setAttribute('aria-label', 'State')
    states.forEach(function (s) {
      var o = doc.createElement('option')
      o.value = s.id
      o.textContent = s.attrs['data-label'] || s.id
      statePick.appendChild(o)
    })
    var seg = el('div', 'sd-seg')
    seg.setAttribute('role', 'group')
    seg.setAttribute('aria-label', 'Width')
    var widthBtns = WIDTHS.map(function (w, i) {
      var b = doc.createElement('button')
      b.type = 'button'
      b.innerHTML = (w >= 1200 ? ICON.desktop : w >= 600 ? ICON.tablet : ICON.phone) + w
      b.title = 'Width ' + w + ' (' + (i + 1) + ')'
      b.dataset.width = String(w)
      seg.appendChild(b)
      return b
    })
    // The design's own light or dark (D); the tool's theme is the separate ui-theme button.
    var themeBtn = doc.createElement('button')
    themeBtn.type = 'button'
    themeBtn.title = 'Design in dark (D)'
    themeBtn.setAttribute('aria-label', 'Design in dark')
    var pickBtn = button('', 'pick')
    pickBtn.innerHTML = ICON.pick + 'Pick'
    pickBtn.title = PICK_TITLE
    pickBtn.setAttribute('aria-pressed', String(picking))
    var notesBtn = button('', 'notes')
    notesBtn.title = 'Notes on this screen'
    notesBtn.setAttribute('aria-expanded', 'false')
    var prevBtn = button('', 'prev')
    prevBtn.innerHTML = ICON.back
    prevBtn.className = 'sd-plain'
    prevBtn.setAttribute('aria-label', 'Previous')
    var count = el('span', 'sd-count')
    var nextBtn = button('', 'next')
    nextBtn.innerHTML = ICON.next
    nextBtn.className = 'sd-plain'
    nextBtn.setAttribute('aria-label', 'Next')
    var uiBtn = button('', 'ui-theme')
    uiBtn.className = 'sd-plain'
    var read = readLinks(doc)
    var links = read.links
    var handled = false
    var parts = [hideBtn, title, status, linkWarn, statePick, seg, themeBtn]
    // Below 900 px the side list (and its link home) is gone: the bar has the way back.
    if (served) {
      var homeBar = el('a', 'sd-homebar', ICON.back)
      homeBar.href = '/'
      homeBar.title = 'All screens'
      homeBar.setAttribute('aria-label', 'All screens')
      homeBar.setAttribute('data-sd', 'home-bar')
      parts.unshift(homeBar)
    }
    if (served) parts = parts.concat([el('span', 'sd-vr'), pickBtn, notesBtn])
    parts = parts.concat([el('span', 'sd-vr'), prevBtn, count, nextBtn, uiBtn])
    bar.append.apply(bar, parts)
    var stage = el('div', 'sd-stage')
    // Above the frame, never over it: a stopped session, a failed build, Pick on.
    var banners = el('div', 'sd-banners')
    var stoppedBar = tagged('div', 'sd-stopped', 'stopped', STOPPED)
    stoppedBar.hidden = true
    var pickBar = tagged('div', 'sd-pickbar', 'pickbar', 'Pick is on. Click any part of the design to write a note. Press Esc or P to stop.')
    pickBar.hidden = true
    banners.append(stoppedBar, pickBar)
    var cap = el('div', 'sd-cap')
    var capLeft = el('span', 'sd-capl')
    var size = el('span')
    size.setAttribute('data-sd', 'size')
    var zoomSeg = tagged('span', 'sd-zoom', 'zoom')
    zoomSeg.setAttribute('role', 'group')
    zoomSeg.setAttribute('aria-label', 'Zoom')
    var zoomBtns = [['fit', 'Fit'], ['100', '100%']].map(function (z) {
      var b = button(z[1])
      b.setAttribute('data-zoom', z[0])
      zoomSeg.appendChild(b)
      return b
    })
    capLeft.append(size, zoomSeg)
    var source = el('span')
    source.setAttribute('data-sd', 'source')
    cap.append(capLeft, source)
    var fitBox = el('div', 'sd-fit')
    var frame = doc.createElement('iframe')
    frame.className = 'sd-frame'
    frame.title = 'Design state'
    fitBox.appendChild(frame)
    stage.append(banners, cap, fitBox)
    var nlist = tagged('div', 'sd-nlist', 'notes-list')
    nlist.hidden = true
    var pickTag = tagged('span', 'sd-picktag', 'picktag', 'Click to add a note')
    pickTag.hidden = true
    var dock = el('div', 'sd-dock')
    dock.appendChild(nlist)
    main.append(bar, stage, dock)
    var keys = el('div', 'sd-keys', '<span><span class="sd-kbd">↑</span><span class="sd-kbd">↓</span>state</span><span><span class="sd-kbd">1</span><span class="sd-kbd">2</span><span class="sd-kbd">3</span>width</span><span><span class="sd-kbd">D</span>dark</span><span><span class="sd-kbd">L</span>list</span>' + (served ? '<span><span class="sd-kbd">P</span>pick</span>' : ''))
    side.append(head, find, list, foot, keys)
    app.append(side, main, pickTag)
    doc.body.prepend(app)
    var notesBy = {}
    var filterText = ''
    var firstShown = null

    function fill(filter) {
      filterText = filter
      list.textContent = ''
      var shown = 0
      var lastGroup = null
      firstShown = null
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
        var label = el('span', 'sd-lab')
        label.textContent = text
        row.title = s.id
        row.append(n, label)
        if (notesBy[s.id]) {
          var dot = el('span', 'sd-ndot')
          dot.setAttribute('data-sd-notedot', '')
          var nc = el('span', 'sd-ncount')
          nc.textContent = String(notesBy[s.id])
          row.title = s.id + ': ' + plural(notesBy[s.id], 'open note')
          row.append(dot, nc)
        }
        var nl = linksForState(links, s.id).length
        if (nl) {
          var small = el('small')
          small.textContent = plural(nl, 'link')
          row.appendChild(small)
        }
        if (current && current.s.id === s.id) row.setAttribute('aria-current', 'true')
        row.addEventListener('click', function () { go(s.id, current ? current.width : WIDTHS[0]) })
        list.appendChild(row)
        if (!firstShown) firstShown = s.id
        shown += 1
      })
      findCount.textContent = filter ? shown + ' of ' + states.length : ''
      if (!shown) list.appendChild(el('div', 'sd-empty', 'No state matches.'))
    }
    function postJson(path, body) {
      return root
        .fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(
          function (r) {
            return r.json().catch(function () { return {} }).then(function (j) {
              if (!r.ok) throw new Error(j.error || 'The server said ' + r.status)
              return j
            })
          },
          function () { var e = new Error('the session is stopped'); e.down = true; throw e },
        )
    }
    // The count of this screen's open notes is a button; it opens the list (element, state, Edit, Delete).
    function refreshNotes() {
      return root
        .fetch('/__notes?screen=' + encodeURIComponent(screenName) + (listOpen ? '&list=1' : ''))
        .then(function (r) { return r.json() })
        .then(
          function (j) {
            notesBy = j.byState || {}
            var here = 0
            for (var k in notesBy) here += notesBy[k]
            notesBtn.textContent = j.error || plural(here, 'note')
            notesBtn.className = j.error || here ? 'sd-has' : ''
            fill(filterText)
            if (listOpen) drawList(j.list || [])
          },
          function () { notesBtn.textContent = '' },
        )
    }
    function drawList(items) {
      nlist.textContent = ''
      var h = el('h3')
      h.textContent = 'Notes on this screen'
      nlist.appendChild(h)
      if (!items.length) {
        var none = el('p')
        none.textContent = 'No open notes here. Press Pick, then click any part of the design.'
        nlist.appendChild(none)
      }
      items.forEach(function (n) {
        var row = el('div', 'sd-nrow')
        row.setAttribute('data-sd-note', n.id)
        var id = n.state.split('@')[0]
        var s = states.filter(function (x) { return x.id === id })[0]
        var where = el('button', 'sd-ngo')
        where.type = 'button'
        where.textContent = (n.text ? '"' + n.text + '"' : 'An area') + ' · ' + (s ? s.attrs['data-label'] || s.id : n.state) + ' · ' + n.width
        where.title = 'Show this state'
        where.addEventListener('click', function () { go(id, n.width) })
        var words = el('p')
        words.textContent = n.note
        var act = el('div', 'sd-nact')
        var edit = button('Edit', 'note-edit')
        edit.className = 'sd-btn'
        var del = button('Delete', 'note-delete')
        del.className = 'sd-btn'
        edit.addEventListener('click', function () {
          var input = doc.createElement('input')
          input.value = n.note
          input.setAttribute('aria-label', 'Note')
          var keep = button('Save', 'note-save')
          keep.className = 'sd-btn sd-primary'
          var back = button('Cancel')
          back.className = 'sd-btn'
          words.replaceWith(input)
          act.textContent = ''
          act.append(keep, back)
          keep.addEventListener('click', function () { if (input.value.trim()) change('/__notes/edit', { id: n.id, note: input.value }) })
          back.addEventListener('click', refreshNotes)
          input.focus()
        })
        // Two clicks: the first asks.
        del.addEventListener('click', function () {
          if (del.getAttribute('data-confirm') !== '1') { del.setAttribute('data-confirm', '1'); del.textContent = 'Click again to delete'; return }
          change('/__notes/delete', { id: n.id })
        })
        act.append(edit, del)
        row.append(where, words, act)
        nlist.appendChild(row)
      })
      var tip = el('p', 'sd-nfoot')
      tip.textContent = 'When you are done, say do my notes in Claude Code.'
      nlist.appendChild(tip)
    }
    function change(path, body) {
      return postJson(path, body).then(refreshNotes, function (err) {
        var p = el('p')
        p.style.color = 'var(--bad)'
        p.textContent = 'Not saved: ' + err.message
        nlist.appendChild(p)
      })
    }
    function toggleList(on) {
      listOpen = on === undefined ? !listOpen : on
      nlist.hidden = !listOpen
      notesBtn.setAttribute('aria-expanded', String(listOpen))
      if (listOpen) refreshNotes()
    }
    // Scale the true-width frame down to fit the stage; never up. The frame keeps its real width, so the
    // app's breakpoints see 1440, 1024 or 375, whatever the window size. 100%: no scaling, the stage scrolls.
    function fit() {
      if (!current) return
      var w = current.width
      var avail = stage.clientWidth - 64
      var k = zoom === '100' ? 1 : avail > 0 ? Math.min(1, avail / w) : 1
      var h = Math.max(900, Math.floor((stage.clientHeight - 64 - banners.offsetHeight) / k))
      scale = k
      frame.style.width = w + 'px'
      frame.style.height = h + 'px'
      frame.style.transform = k < 1 ? 'scale(' + k + ')' : ''
      fitBox.style.width = Math.round(w * k) + 'px'
      fitBox.style.height = Math.round(h * k) + 'px'
      cap.style.width = Math.round(w * k) + 'px'
      banners.style.width = Math.round(w * k) + 'px'
      size.innerHTML = '<b>' + w + ' px</b>' + (k < 1 ? ' · shown at ' + Math.round(k * 100) + '%' : '')
      zoomBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-zoom') === zoom)) })
      placeTag()
    }
    // The bar for the state on screen. Step 2's same-page swap calls this too.
    function syncBar(s, width) {
      current = { s: s, width: width }
      titleText.textContent = s.attrs['data-label'] || s.id
      note.textContent = s.attrs['data-note'] || s.id
      widthBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.width) === width)) })
      themeBtn.innerHTML = ICON.contrast + '<span>' + (theme === 'dark' ? 'Dark' : 'Light') + '</span>'
      themeBtn.setAttribute('aria-pressed', String(theme === 'dark'))
      statePick.value = s.id
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
    var statusTimer = null
    function setStatus(text, busy) {
      root.clearTimeout(statusTimer)
      status.innerHTML = busy ? '<span class="sd-spin" aria-hidden="true"></span>' : ''
      status.appendChild(doc.createTextNode(text))
    }
    function closeNoteBox() {
      if (noteBox) noteBox.remove()
      noteBox = null
      noteInput = null
      askDiscard = null
      keepWriting = null
      if (pendingReload) reloadNow()
    }
    // A box with typed words is never dropped without asking. next: what to do once the box is gone.
    function leaveNoteBox(next) {
      if (!noteBox) return next && next()
      if (saving) return
      if (noteInput.value.trim()) return askDiscard(next)
      closeNoteBox()
      if (next) next()
    }
    function reloadNow() {
      saveView()
      setFlag('sd-updated')
      root.location.reload()
    }
    // A design change reloads the page. Wait while the designer is typing or saving a note, or the words are lost.
    function requestReload() {
      if (saving || (noteInput && noteInput.value.trim())) {
        pendingReload = true
        setStatus('Updates after your note')
        return
      }
      reloadNow()
    }
    function copyText(text) {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) return root.navigator.clipboard.writeText(text)
      return Promise.reject(new Error('no clipboard'))
    }
    // After a saved note: the next step, which happens in Claude Code.
    function showToast() {
      var old = app.querySelector('[data-sd="toast"]')
      if (old) old.remove()
      var t = tagged('div', 'sd-toast', 'toast')
      t.setAttribute('role', 'status')
      var words = el('span')
      words.textContent = 'Note saved. When you are done, say do my notes in Claude Code.'
      var copy = button('Copy', 'toast-copy')
      copy.className = 'sd-btn'
      copy.title = 'Copy "do my notes"'
      copy.addEventListener('click', function () {
        copyText('do my notes').then(function () { copy.textContent = 'Copied' }, function () { copy.textContent = 'Type: do my notes' })
      })
      t.append(words, copy)
      dock.appendChild(t)
      root.setTimeout(function () { t.remove() }, 6000)
    }
    function openNoteBox(target) {
      if (stopped) return
      var path = elementPath(target, frame.contentDocument.body)
      if (!path || !path.length) return
      if (noteBox) return leaveNoteBox(function () { openNoteBox(target) })
      var old = app.querySelector('[data-sd="toast"]')
      if (old) old.remove()
      var at = current
      var text = noteText(target)
      var tag = target.tagName.toLowerCase()
      noteBox = doc.createElement('form')
      noteBox.className = 'sd-notebox'
      var label = tagged('span', '', 'note-label', text ? 'Note on: "' + text + '"' : 'Note on this area')
      var input = doc.createElement('input')
      noteInput = input
      input.setAttribute('aria-label', 'Note')
      input.setAttribute('data-sd', 'note-input')
      input.placeholder = 'What should change?'
      var save = doc.createElement('button')
      save.type = 'submit'
      save.className = 'sd-btn sd-primary'
      save.textContent = 'Save note'
      var cancel = button('Cancel', 'note-cancel')
      cancel.className = 'sd-btn'
      var err = tagged('p', '', 'note-error')
      err.setAttribute('role', 'alert')
      err.hidden = true
      var ask = tagged('div', '', 'discard')
      ask.hidden = true
      var askText = el('span')
      askText.textContent = 'Discard this note?'
      var keep = button('Keep writing', 'keep')
      keep.className = 'sd-btn sd-primary'
      var drop = button('Discard', 'discard-yes')
      drop.className = 'sd-btn'
      ask.append(askText, keep, drop)
      noteBox.append(label, input, save, cancel, err, ask)
      var after = null
      askDiscard = function (next) {
        after = next || null
        ask.hidden = false
        save.hidden = true
        cancel.hidden = true
        keep.focus()
      }
      keepWriting = function () {
        ask.hidden = true
        save.hidden = false
        cancel.hidden = false
        input.focus()
      }
      keep.addEventListener('click', keepWriting)
      drop.addEventListener('click', function () {
        var next = after
        closeNoteBox()
        if (next) next()
      })
      cancel.addEventListener('click', function () { leaveNoteBox() })
      // The box stays until the server has the note; on failure the words stay and the reason shows.
      noteBox.addEventListener('submit', function (e) {
        e.preventDefault()
        var words = input.value.trim()
        if (!words || saving) return
        saving = true
        save.disabled = true
        save.textContent = 'Saving…'
        err.hidden = true
        postNote({ screen: screenName, state: shownBlockId(at.s, at.width), width: at.width, theme: theme, path: path, text: text, tag: tag, note: words }).then(
          function () {
            saving = false
            if (pendingReload) setFlag('sd-toast')
            closeNoteBox()
            showToast()
            refreshNotes()
          },
          function (x) {
            saving = false
            save.disabled = false
            save.textContent = 'Save note'
            err.hidden = false
            err.textContent = x.down ? 'Not saved: the session is stopped. In Claude Code, type /html-design start, then press Save again.' : 'Not saved: ' + x.message
            input.focus()
          },
        )
      })
      dock.appendChild(noteBox)
      input.focus()
    }
    function postNote(n) { return postJson('/__notes', n) }
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
      placeTag()
    }
    // "Click to add a note" next to the outlined element, in the viewer's page (the frame is scaled).
    function placeTag() {
      if (!picking || !hovered || !hovered.getBoundingClientRect) { pickTag.hidden = true; return }
      var f = frame.getBoundingClientRect()
      var r = hovered.getBoundingClientRect()
      pickTag.hidden = false
      var w = pickTag.offsetWidth
      var box = { left: f.left + r.left * scale, right: f.left + r.right * scale, top: f.top + r.top * scale, bottom: f.top + r.bottom * scale }
      var right = Math.min(f.right, stage.getBoundingClientRect().right)
      // Beside the outlined element on its right; when there is no room, above it; else just under its top edge.
      if (box.right + 8 + w <= right) { pickTag.style.left = box.right + 8 + 'px'; pickTag.style.top = Math.max(f.top + 4, box.top) + 'px'; return }
      pickTag.style.left = Math.max(f.left + 4, Math.min(box.left, right - w - 4)) + 'px'
      pickTag.style.top = (box.top - 26 >= f.top ? box.top - 26 : Math.min(box.bottom + 4, f.bottom - 26)) + 'px'
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
    // Esc steps back one level: the discard question, the note box, the notes list, then Pick.
    function onKey(e) {
      if (e.key === 'Escape') {
        if (noteBox) {
          e.preventDefault()
          var ask = noteBox.querySelector('[data-sd="discard"]')
          return ask && !ask.hidden ? keepWriting() : leaveNoteBox()
        }
        if (listOpen) return toggleList(false)
        if (picking) return setPick(false)
        return
      }
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
      if (e.key === 'l' || e.key === 'L') return setList(!app.classList.contains('sd-nolist'))
      if ((e.key === 'p' || e.key === 'P') && served && !stopped) return setPick(!picking)
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
        if (picking) d.documentElement.setAttribute('data-sd-picking', '')
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
    function setPick(on) {
      if (!on && noteBox) return leaveNoteBox(function () { setPick(false) })
      picking = on && !stopped
      saveView()
      pickBtn.setAttribute('aria-pressed', String(picking))
      pickBar.hidden = !picking
      var d = frame.contentDocument
      if (d && d.documentElement) {
        if (picking) d.documentElement.setAttribute('data-sd-picking', '')
        else d.documentElement.removeAttribute('data-sd-picking')
      }
      if (!picking && hovered) {
        hovered.removeAttribute('data-sd-pick')
        hovered = null
      }
      fit()
    }
    function setList(hidden) {
      app.classList.toggle('sd-nolist', hidden)
      hideBtn.setAttribute('aria-pressed', String(hidden))
      hideBtn.title = (hidden ? 'Show' : 'Hide') + ' the state list (L)'
      hideBtn.setAttribute('aria-label', hidden ? 'Show list' : 'Hide list')
      setLocal('hd-list', hidden ? 'hidden' : null)
      fit()
    }
    function setStopped(on) {
      stopped = on
      stoppedBar.hidden = !on
      pickBtn.disabled = on
      pickBtn.title = on ? STOPPED : PICK_TITLE
      if (on && picking) {
        picking = false
        pickBtn.setAttribute('aria-pressed', 'false')
        pickBar.hidden = true
      }
      fit()
    }
    function uiDark() {
      var t = app.getAttribute('data-ui')
      return t ? t === 'dark' : !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches)
    }
    function uiShow() {
      var d = uiDark()
      uiBtn.innerHTML = d ? ICON.sun : ICON.moon
      uiBtn.title = d ? 'Use the light theme for this tool' : 'Use the dark theme for this tool'
      uiBtn.setAttribute('aria-label', uiBtn.title)
    }
    search.addEventListener('input', function () { fill(search.value.trim().toLowerCase()) })
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && firstShown) {
        e.preventDefault()
        go(firstShown, current ? current.width : WIDTHS[0])
      }
    })
    widthBtns.forEach(function (b) { b.addEventListener('click', function () { go(current.s.id, Number(b.dataset.width)) }) })
    zoomBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        zoom = b.getAttribute('data-zoom')
        setLocal('hd-zoom', zoom === '100' ? '100' : null)
        fit()
      })
    })
    statePick.addEventListener('change', function () { go(statePick.value, current ? current.width : WIDTHS[0]) })
    themeBtn.addEventListener('click', toggleTheme)
    hideBtn.addEventListener('click', function () { setList(!app.classList.contains('sd-nolist')) })
    uiBtn.addEventListener('click', function () {
      var t = uiDark() ? 'light' : 'dark'
      app.setAttribute('data-ui', t)
      setLocal('hd-ui', t)
      uiShow()
    })
    prevBtn.addEventListener('click', function () { var to = stepState(ids, current.s.id, -1); if (to) go(to, current.width) })
    nextBtn.addEventListener('click', function () { var to = stepState(ids, current.s.id, 1); if (to) go(to, current.width) })
    pickBtn.addEventListener('click', function () { setPick(!picking) })
    notesBtn.addEventListener('click', function () { toggleList() })
    frame.addEventListener('mouseleave', function () { pickTag.hidden = true })
    root.addEventListener('resize', fit)
    // The dock and the banners change the stage's height.
    if (root.ResizeObserver) new root.ResizeObserver(function () { fit() }).observe(stage)
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
        // Sent before the CSS build: the change is on its way.
        events.addEventListener('change', function () { setStatus('Updating…', true) })
        // A failed CSS build: the last good CSS stays, and a card says so until the next good build.
        events.addEventListener('buildError', function (e) {
          setStatus('')
          var card = doc.querySelector('[data-sd="build-error"]')
          if (!card) {
            card = tagged('div', 'sd-buildcard', 'build-error')
            card.setAttribute('role', 'alert')
            banners.prepend(card)
          }
          var raw
          try { raw = JSON.parse(e.data) } catch (x) { raw = String(e.data) }
          card.innerHTML = ICON.alert
          var b = el('b')
          b.textContent = 'The design styles did not build. The last good version is shown. In Claude Code, say: fix the build.'
          var details = el('details')
          var summary = el('summary')
          summary.textContent = 'Show details'
          var pre = el('pre')
          pre.textContent = raw
          details.append(summary, pre)
          card.append(b, details)
          fit()
        })
        // The stream drops: the server is gone, or only a moment. The status answer decides.
        events.onerror = function () {
          root.fetch('/__status', { cache: 'no-store' }).then(
            function (r) { if (!r.ok) throw new Error('down'); setStopped(false) },
            function () { setStopped(true) },
          )
        }
        events.onopen = function () { if (stopped) setStopped(false) }
      } catch (e) {}
      refreshNotes()
      if (takeFlag('sd-updated')) {
        setStatus('Updated')
        statusTimer = root.setTimeout(function () { setStatus('') }, 2000)
      }
      if (takeFlag('sd-toast')) showToast()
    }
    linkWarn.textContent = read.error || ''
    var total = links.length
    foot.textContent = total ? plural(total, 'link') + ' between states' : ''
    if (getLocal('hd-list') === 'hidden') setList(true)
    else hideBtn.setAttribute('aria-pressed', 'false')
    hideBtn.title = hideBtn.title || 'Hide the state list (L)'
    hideBtn.setAttribute('aria-label', hideBtn.getAttribute('aria-label') || 'Hide list')
    pickBar.hidden = !(picking && served)
    uiShow()
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
