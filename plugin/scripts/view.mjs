// usage: node view.mjs [--port 8900] [--data <dir>]  (run in the project root)
// Local server for the design folder: rebuilds the CSS on start and when screens or the Tailwind source change,
// then tells open pages to reload. Serves the Copy window and the copy endpoints. 127.0.0.1 only.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import { basename, extname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { buildCssInChild } from './build-css.mjs'
import { projectRoot, readConfig } from './config.mjs'
import { readNotes, writeNotes } from './notes.mjs'
import { isMain } from './deps.mjs'
import { setDataDir } from './runtime.mjs'
import { parseScreen, slugScreen } from './screen-file.mjs'
import { loadSwitcher } from './switcher-node.mjs'
import { adapterFor } from './styles/index.mjs'

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8' }
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const BODY_LIMIT = 16 * 1024
const DEBOUNCE_MS = 100
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let noteSeq = 0

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const STATE_ID = /^[\w.-]{1,120}$/
export function validNote(n, widths) {
  if (!n || typeof n !== 'object') return 'the note is not an object'
  if (typeof n.screen !== 'string' || !/^[a-z0-9-]{1,80}$/.test(n.screen)) return 'screen must be a screen file name'
  if (typeof n.state !== 'string' || !/^[\w@.-]{1,120}$/.test(n.state)) return 'state must be a state id'
  if (!widths.includes(n.width)) return `width must be one of ${widths.join(', ')}`
  if (n.theme !== 'light' && n.theme !== 'dark') return 'theme must be light or dark'
  if (!Array.isArray(n.path) || !n.path.length || n.path.length > 64 || !n.path.every((p) => isInt(p, 1, 10000))) return 'path must name an element inside the state'
  if (typeof n.text !== 'string' || n.text.length > 60) return 'text must be at most 60 characters'
  if (typeof n.tag !== 'string' || !/^[a-z][a-z0-9-]{0,30}$/.test(n.tag)) return 'tag must be an element name'
  if (typeof n.note !== 'string' || !n.note.trim() || n.note.length > 2000) return 'note must be 1 to 2000 characters'
  return null
}

function validCopy(b) {
  if (!b || typeof b !== 'object') return 'the body is not an object'
  if (typeof b.screen !== 'string' || !b.screen.trim() || b.screen.length > 80) return 'screen must be 1 to 80 characters'
  if (!slugScreen(b.screen)) return 'screen needs at least one letter or digit'
  if (typeof b.state !== 'string' || !STATE_ID.test(b.state)) return 'state must be a state id (letters, digits, - _ .)'
  if (b.label != null && (typeof b.label !== 'string' || b.label.length > 200)) return 'label must be at most 200 characters'
  if (b.replace != null && typeof b.replace !== 'boolean') return 'replace must be true or false'
  if (b.tab != null && !isInt(b.tab, 0, 1000) && !(typeof b.tab === 'string' && /^(t-\d{1,9}|target:[A-Za-z0-9]{1,64})$/.test(b.tab))) return 'tab must be a tab id from the tabs list, target:<CDP target id>, or a tab number'
  if (b.delay != null && !isInt(b.delay, 1, 10)) return 'delay must be whole seconds, 1 to 10'
  return null
}

function readBody(req, limit) {
  return new Promise((ok, fail) => {
    let size = 0
    let tooBig = false
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) tooBig = true
      else chunks.push(c)
    })
    req.on('end', () => ok({ text: Buffer.concat(chunks).toString('utf8'), tooBig }))
    req.on('error', fail)
  })
}

// Shared look of the plugin's own pages (home, Copy window). The switcher in each screen file carries the same tokens.
const FONT_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">'
const CHROME_CSS = `:root{--bg:#0c0c0d;--chrome:#121214;--raise:#18181b;--hover:#1f1f23;--line:#232327;--line2:#2e2e33;--ink:#ececee;--dim:#a1a1a8;--mute:#6b6b73;--accent:#4c8dff;--ok:#3ecf8e;--warn:#f5b84b;--bad:#ff6b6b;color-scheme:dark}
*{box-sizing:border-box;margin:0}body{font:13px/1.45 Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}
.mono{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
.kbd{font:500 10.5px "Geist Mono",ui-monospace,monospace;color:var(--mute);border:1px solid var(--line2);border-radius:4px;padding:1px 4px;line-height:1.3}
.ib{height:30px;min-width:30px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 10px;border-radius:7px;color:var(--ink);border:1px solid var(--line2);background:var(--raise);font:inherit;cursor:pointer}
.ib:hover{background:var(--hover)}.ib:disabled{opacity:.45;cursor:default}
.ib.p{background:var(--ink);color:#0c0c0d;border-color:var(--ink);font-weight:500}.ib.p:hover{background:#fff}
.seg{display:inline-flex;padding:2px;background:var(--bg);border:1px solid var(--line);border-radius:8px;gap:2px}
.seg>button{height:26px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border-radius:6px;color:var(--mute);font:inherit;font-size:12.5px;background:none;border:0;cursor:pointer}
.seg>button:hover{color:var(--ink)}.seg>button[aria-pressed=true]{background:var(--hover);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line2)}
.dot{width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(62,207,142,.14);flex:none}.dot.off{background:var(--mute);box-shadow:none}
.field{height:34px;width:100%;padding:0 11px;border:1px solid var(--line2);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;outline:none}
.field:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(76,141,255,.18)}.field::placeholder{color:var(--mute)}
select.field{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6b73' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}`
const ICONS = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
}
const STYLE_NAMES = { tw4: 'Tailwind 4', tw3: 'Tailwind 3', css: 'CSS' }
// "5 min ago": the page fills <time data-mtime> in the viewer's own clock.
const AGO_JS = `function ago(t){var s=(Date.now()-t)/1000;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+' min ago';if(s<86400)return Math.floor(s/3600)+' h ago';if(s<172800)return 'yesterday';return new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`

export function homePage(screens, { project = '', style = '' } = {}) {
  const total = screens.reduce((n, s) => n + (s.states || 0), 0)
  const cards = screens
    .map((s) => {
      const name = s.file.replace(/\.html$/, '')
      if (s.error) return `<a class="card" href="/screens/${esc(s.file)}" data-search="${esc(name.toLowerCase())}" data-name="${esc(name)}" data-mtime="0" data-states="0"><div class="th bad">${esc(s.error)}</div><div class="nm">${esc(name)}</div></a>`
      const href = `/screens/${esc(s.file)}${s.first ? `#${esc(encodeURIComponent(s.first))}` : ''}`
      const thumb = s.first ? `<iframe src="/__state/${esc(name)}/${esc(encodeURIComponent(s.first))}" loading="lazy" tabindex="-1" aria-hidden="true" scrolling="no" title=""></iframe>` : ''
      const notes = s.notes ? `<span class="badge">${s.notes} note${s.notes > 1 ? 's' : ''}</span>` : ''
      const search = [name, ...(s.labels ?? [])].join(' ').toLowerCase()
      return `<a class="card" href="${href}" data-search="${esc(search)}" data-name="${esc(name)}" data-mtime="${s.mtime ?? 0}" data-states="${s.states}"><div class="th">${thumb}</div><div class="nm"><span>${esc(name)}</span>${notes}</div><div class="mt"><span>${s.states} states</span><span>·</span><time data-mtime="${s.mtime ?? 0}"></time></div></a>`
    })
    .join('')
  const body = screens.length
    ? `<div class="grid" id="grid">${cards}</div><p class="none" id="none" hidden>No screen matches.</p>`
    : `<div class="empty"><h2>No screens yet</h2><p>Open the <a href="/__copy">Copy window</a>, bring your app to a state, and press Copy. The screen shows up here.</p></div>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Designs</title>${FONT_LINK}<style>${CHROME_CSS}
.top{height:52px;border-bottom:1px solid var(--line);background:var(--chrome);display:flex;align-items:center;padding:0 20px;gap:14px;position:sticky;top:0;z-index:2}
.mark{width:20px;height:20px;border-radius:5px;background:var(--ink);position:relative;flex:none}.mark:after{content:"";position:absolute;inset:5px 5px 9px;border:1.6px solid var(--bg);border-radius:2px}
.crumb{display:flex;align-items:center;gap:8px;color:var(--mute);white-space:nowrap}.crumb b{color:var(--ink);font-weight:500}
.sp{flex:1}.status{display:flex;align-items:center;gap:8px;color:var(--dim);font-size:12.5px;padding:0 11px;height:30px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}
.search{position:relative;width:300px}.search svg{position:absolute;left:10px;top:9px;color:var(--mute)}.search .field{padding-left:32px;height:30px}.search .kbd{position:absolute;right:8px;top:7px}
.wrap{padding:28px 32px 48px}.head{display:flex;align-items:flex-end;gap:16px;margin-bottom:22px}
h1{font-size:22px;font-weight:600;letter-spacing:-.02em}.sub{color:var(--mute);margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:24px 20px}
.card{display:block;border-radius:12px;outline:none}
.th{aspect-ratio:16/10;border-radius:10px;overflow:hidden;background:#fff;border:1px solid var(--line);position:relative;transition:border-color .15s,transform .15s}
.th iframe{position:absolute;top:0;left:0;width:1440px;height:900px;border:0;transform-origin:0 0;transform:scale(var(--k,.16));pointer-events:none;background:#fff}
.th.bad{background:var(--raise);color:var(--bad);padding:14px;font-size:12px}
.card:hover .th,.card:focus-visible .th{border-color:var(--line2);transform:translateY(-2px)}.card:focus-visible .th{outline:2px solid var(--accent);outline-offset:2px}
.nm{display:flex;align-items:center;gap:8px;margin-top:10px;font-weight:500;min-width:0}.nm span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt{color:var(--mute);font-size:12px;margin-top:2px;display:flex;gap:6px}
.badge{margin-left:auto;flex:none;font-size:11px;color:var(--warn);background:rgba(245,184,75,.1);border-radius:999px;padding:1px 7px;font-weight:500}
.empty{max-width:420px;margin:12vh auto;text-align:center;color:var(--dim)}.empty h2{color:var(--ink);font-size:16px;font-weight:600;margin-bottom:8px}.empty a{color:var(--accent)}
.none{color:var(--mute);padding:40px 0;text-align:center}
@media (max-width:720px){.status,.crumb span{display:none}.search{flex:1;width:auto}.wrap{padding:20px 16px}.head{flex-wrap:wrap}}
</style></head><body>
<header class="top"><span class="mark"></span><div class="crumb"><span>html-design</span><span>/</span><b>${esc(project)}</b></div><div class="sp"></div>
<div class="status"><span class="dot"></span>Live${style ? ` · ${esc(STYLE_NAMES[style] ?? style)}` : ''}</div>
<label class="search">${ICONS.search}<input id="q" class="field" placeholder="Search screens and states" aria-label="Search screens and states"><span class="kbd">/</span></label>
<a class="ib" href="/__copy" target="_blank">${ICONS.copy}Copy window</a></header>
<main class="wrap"><div class="head"><div><h1>Screens</h1><div class="sub">${screens.length} screen${screens.length === 1 ? '' : 's'} · ${total} states</div></div><div class="sp"></div>
${screens.length ? '<div class="seg" id="sort" role="group" aria-label="Sort"><button type="button" data-sort="recent" aria-pressed="true">Recent</button><button type="button" data-sort="name" aria-pressed="false">A–Z</button><button type="button" data-sort="states" aria-pressed="false">Most states</button></div>' : ''}</div>
${body}</main>
<script>
${AGO_JS}
document.querySelectorAll('time[data-mtime]').forEach(function (t) { var m = Number(t.getAttribute('data-mtime')); t.textContent = m ? ago(m) : '' })
var grid = document.getElementById('grid'), q = document.getElementById('q')
function fit() { document.querySelectorAll('.th').forEach(function (t) { t.style.setProperty('--k', t.clientWidth / 1440) }) }
fit(); addEventListener('resize', fit)
function sortBy(k) {
  if (!grid) return
  var cards = Array.prototype.slice.call(grid.children)
  cards.sort(function (a, b) {
    if (k === 'name') return a.dataset.name.localeCompare(b.dataset.name)
    if (k === 'states') return b.dataset.states - a.dataset.states
    return b.dataset.mtime - a.dataset.mtime
  })
  cards.forEach(function (c) { grid.appendChild(c) })
  document.querySelectorAll('#sort button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.sort === k)) })
  try { localStorage.setItem('hd-sort', k) } catch (e) {}
}
var saved = 'recent'; try { saved = localStorage.getItem('hd-sort') || 'recent' } catch (e) {}
sortBy(saved)
document.querySelectorAll('#sort button').forEach(function (b) { b.onclick = function () { sortBy(b.dataset.sort) } })
q.oninput = function () {
  var v = q.value.trim().toLowerCase(), shown = 0
  if (!grid) return
  Array.prototype.forEach.call(grid.children, function (c) { var on = !v || c.dataset.search.indexOf(v) !== -1; c.hidden = !on; if (on) shown += 1 })
  document.getElementById('none').hidden = shown > 0
}
addEventListener('keydown', function (e) {
  if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && document.activeElement !== q) { e.preventDefault(); q.focus() }
  if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; q.oninput(); q.blur() }
})
</script></body></html>`
}

// The Copy window: not part of the app and not a design, so its script is inline.
export function copyWindow({ screens, widths }) {
  const options = screens.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('') + '<option value="__new">New screen</option>'
  const widthBtns = widths.map((w, i) => `<button type="button" data-width="${w}" aria-pressed="${i === 0}">${w}</button>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Copy</title>${FONT_LINK}<style>${CHROME_CSS}
body{background:var(--chrome);min-height:100vh}
.top{height:48px;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--line)}.top b{font-weight:600}.sp{flex:1}
#live{display:flex;align-items:center;gap:8px;color:var(--dim);font-size:12.5px}
.pad{padding:0 16px}
#tab{margin:14px 16px 0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg)}
.tabrow{display:flex;align-items:center;gap:10px}.fav{width:28px;height:28px;border-radius:7px;border:1px solid var(--line2);display:grid;place-items:center;color:var(--mute);flex:none}
.tt{flex:1;min-width:0;line-height:1.3}.tt b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tt span{display:block;color:var(--mute);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#tabPick{margin-top:10px}.wrow{display:flex;align-items:center;justify-content:space-between;margin-top:10px;color:var(--mute);font-size:12px}
label{display:block;color:var(--mute);font-size:12px;margin:16px 0 6px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}#newScreen{margin-top:8px}
.go{margin:20px 16px 0;width:calc(100% - 32px);height:40px;border-radius:9px;font-size:13.5px}.go .kbd{color:#55555c;border-color:#c8c8cc}
.alt{margin:8px 16px 0;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.hint{margin:8px 16px 0;color:var(--mute);font-size:12px}
#msg{margin:12px 16px 0;min-height:18px;font-size:12.5px;color:var(--dim)}#msg.err{color:var(--bad)}#msg.ok{color:var(--ok)}
#tabs{margin:8px 16px 0;display:grid;gap:6px}#tabs button{justify-content:flex-start}
.rec{margin-top:20px;border-top:1px solid var(--line);padding:14px 16px 24px}
.rec h4{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--mute);font-weight:500;margin-bottom:6px}
.it{display:flex;align-items:center;gap:10px;padding:7px 6px;margin:0 -6px;border-radius:8px}.it:hover{background:var(--hover)}
.it .th{width:48px;height:30px;border-radius:5px;overflow:hidden;border:1px solid var(--line);position:relative;background:#fff;flex:none}
.it .th iframe{position:absolute;top:0;left:0;width:1440px;height:900px;border:0;transform:scale(.0333);transform-origin:0 0;pointer-events:none}
.it .time{color:var(--mute);font-size:12px}.empty{color:var(--mute);font-size:12.5px;padding:6px 0}
</style></head><body>
<div class="top"><b>Copy</b><div class="sp"></div><span id="live"><span class="dot off"></span>Checking…</span></div>
<div id="tab"><div class="tabrow"><span class="fav">${ICONS.globe}</span><div class="tt"><b id="tabTitle">No app tab</b><span id="tabUrl" class="mono">Open your app in the session browser</span></div></div>
<select id="tabPick" class="field" aria-label="App tab" hidden></select>
<div class="wrow"><span>App width</span><div class="seg" id="widths">${widthBtns}</div></div></div>
<div class="pad"><label for="screen">Screen</label><select id="screen" class="field">${options}</select><input id="newScreen" class="field" placeholder="New screen name" hidden>
<div class="two"><div><label for="state">State id</label><input id="state" class="field mono" placeholder="menu-open"></div><div><label for="label">Label</label><input id="label" class="field" placeholder="Menu open"></div></div></div>
<button type="button" id="copy" class="ib p go">${ICONS.copy}Copy state<span class="kbd">Ctrl Shift S</span></button>
<div class="alt"><button type="button" id="copyLater" class="ib">Copy in 5 s</button><button type="button" id="copy3" class="ib">Copy at ${widths.length} widths</button></div>
<p class="hint">To copy an open menu: press Ctrl+Shift+S in the app tab, or click Copy in 5 s and open the menu.</p>
<p class="hint">Copy at ${widths.length} widths resizes the window, so open menus close.</p>
<div id="tabs"></div><div id="msg" role="status"></div>
<div class="rec"><h4>Recent</h4><div id="recent"><div class="empty">Copies you make show up here.</div></div></div>
<script>
${AGO_JS}
var WIDTHS = ${JSON.stringify(widths)}
var $ = function (id) { return document.getElementById(id) }
var esc = function (v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }
var msg = function (t, kind) { $('msg').textContent = t; $('msg').className = kind || '' }
$('screen').onchange = function () { $('newScreen').hidden = $('screen').value !== '__new' }
$('newScreen').hidden = $('screen').value !== '__new'
function postJson(path, body) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return {} }).then(function (j) { return { status: r.status, body: j } }) })
}
var tabs = []
function chosenTab() { return tabs.length > 1 ? $('tabPick').value : undefined }
function showTabs() {
  return fetch('/__tabs').then(function (r) { return r.json() }).then(function (list) {
    tabs = list
    $('live').innerHTML = '<span class="dot"></span>Session live'
    var keep = $('tabPick').value
    $('tabPick').hidden = list.length < 2
    $('tabPick').innerHTML = list.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title || t.url) + '</option>' }).join('')
    if (keep && list.some(function (t) { return t.id === keep })) $('tabPick').value = keep
    var t = list.filter(function (x) { return x.id === $('tabPick').value })[0] || list[0]
    $('tabTitle').textContent = t ? (t.title || 'Untitled tab') : 'No app tab'
    $('tabUrl').textContent = t ? (t.url.replace(/^https?:\\/\\//, '') + (t.width ? ' · ' + t.width + ' px' : '')) : 'Open your app in the session browser'
    if (t && t.width) Array.prototype.forEach.call(document.querySelectorAll('[data-width]'), function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.width) === t.width)) })
  }, function () { $('live').innerHTML = '<span class="dot off"></span>Session stopped' })
}
// A delayed copy names a tab only when the user picked one; else the server takes the tab the user looks at.
var tabPicked = false
$('tabPick').onchange = function () { tabPicked = true; showTabs() }
function showRecent() {
  return fetch('/__recent').then(function (r) { return r.json() }).then(function (list) {
    if (!list.length) return
    // One row per state: the widths of one state copied in a row are listed together.
    var rows = []
    list.forEach(function (x) {
      var last = rows[rows.length - 1]
      if (last && last.screen === x.screen && last.state === x.state) { if (x.width && last.widths.indexOf(x.width) === -1) last.widths.unshift(x.width); return }
      rows.push({ screen: x.screen, state: x.state, width: x.width, at: x.at, widths: x.width ? [x.width] : [] })
    })
    $('recent').innerHTML = rows.slice(0, 6).map(function (x) {
      return '<a class="it" target="_blank" href="/screens/' + esc(x.screen) + '.html#' + encodeURIComponent(x.state) + (x.width ? '@' + x.width : '') + '"><span class="th"><iframe loading="lazy" tabindex="-1" aria-hidden="true" src="/__state/' + esc(x.screen) + '/' + encodeURIComponent(x.state) + '"></iframe></span>' +
        '<span class="tt"><b>' + esc(x.state) + '</b><span>' + esc(x.screen) + (x.widths.length ? ' · ' + x.widths.sort(function (a, b) { return b - a }).join(' · ') : '') + '</span></span><span class="time">' + ago(x.at) + '</span></a>'
    }).join('')
  }, function () {})
}
Array.prototype.forEach.call(document.querySelectorAll('[data-width]'), function (b) {
  b.onclick = function () {
    postJson('/__resize', { width: Number(b.getAttribute('data-width')) }).then(function (r) { msg(r.status === 200 ? 'App width: ' + b.getAttribute('data-width') + ' px' : (r.body.error || 'Resize failed'), r.status === 200 ? '' : 'err'); showTabs() })
  }
})
function names() {
  var screen = $('screen').value === '__new' ? $('newScreen').value.trim() : $('screen').value
  return { screen: screen, state: $('state').value.trim(), label: $('label').value.trim() || undefined }
}
function sendPreset() { postJson('/__preset', names()).catch(function () {}) }
var presetTimer = null
;['screen', 'newScreen', 'state', 'label'].forEach(function (id) {
  $(id).addEventListener('input', function () { clearTimeout(presetTimer); presetTimer = setTimeout(sendPreset, 300) })
  $(id).addEventListener('change', function () { clearTimeout(presetTimer); presetTimer = setTimeout(sendPreset, 300) })
})
// One copy. Resolves to true when saved; asks about an existing state and about which tab.
function send(extra) {
  var body = names()
  if (chosenTab() && !('tab' in extra)) body.tab = chosenTab()
  for (var k in extra) body[k] = extra[k]
  $('tabs').textContent = ''
  sendPreset()
  return postJson('/__copy', body).then(function (r) {
    if (r.status === 201) {
      msg('Saved ' + body.state + (r.body.images ? ' · ' + r.body.images + ' images' : '') + (r.body.warnings && r.body.warnings.length ? ' · ' + r.body.warnings.join('; ') : ''), 'ok')
      showRecent()
      return true
    }
    if (r.status === 409 && r.body.tabs) {
      msg('Pick the tab to copy:')
      r.body.tabs.forEach(function (t, i) {
        var b = document.createElement('button')
        b.type = 'button'
        b.className = 'ib'
        b.textContent = t.title || 'Tab ' + (i + 1)
        b.onclick = function () { var e = {}; for (var k in extra) e[k] = extra[k]; e.tab = t.id; send(e) }
        $('tabs').appendChild(b)
      })
      return false
    }
    if (r.status === 409 && r.body.exists) {
      if (confirm('State ' + body.state + ' already exists at this width. Replace?')) { var e = {}; for (var k in extra) e[k] = extra[k]; e.replace = true; return send(e) }
      msg('Not copied.')
      return false
    }
    msg(r.body.error || 'Copy failed (' + r.status + ')', 'err')
    return false
  }, function () { msg('The session is not running.', 'err'); return false })
}
function busy(on) { ['copy', 'copyLater', 'copy3'].forEach(function (id) { $(id).disabled = on }) }
$('copy').onclick = function () { msg('Copying…'); busy(true); send({}).then(function () { busy(false) }) }
// The server does the wait, so the copy runs while the user is in the app tab. Replace? is asked here first:
// a dialog in a hidden tab waits until the tab is shown again.
var slug = ${slugScreen.toString()}
$('copyLater').onclick = function () {
  var n = names()
  busy(true)
  fetch('/__state/' + encodeURIComponent(slug(n.screen)) + '/' + encodeURIComponent(n.state)).then(function (r) { return r.status === 200 }, function () { return false }).then(function (has) {
    if (has && !confirm('State ' + n.state + ' already exists. Replace?')) { msg('Not copied.'); busy(false); return }
    var extra = { delay: 5, tab: tabPicked ? chosenTab() : undefined }
    if (has) extra.replace = true
    msg('Copy in 5 s: switch to the app tab and open the menu.')
    return send(extra).then(function () { busy(false) })
  })
}
// Every width in turn: resize the app tab, let it settle, copy. The base width first; the window ends there.
$('copy3').onclick = function () {
  busy(true)
  var i = 0
  var step = function () {
    if (i === WIDTHS.length) return postJson('/__resize', { width: WIDTHS[0] }).then(function () { busy(false); showTabs(); msg('Saved ' + names().state + ' at ' + WIDTHS.join(', '), 'ok') })
    var w = WIDTHS[i]
    msg('Copying at ' + w + ' px…')
    return postJson('/__resize', { width: w })
      .then(function () { return new Promise(function (r) { setTimeout(r, 700) }) })
      .then(function () { return send({}) })
      .then(function (ok) { if (!ok) { busy(false); return } i += 1; return step() })
  }
  step()
}
showTabs(); showRecent(); setInterval(showTabs, 2000)
</script></body></html>`
}

function listScreens(dir, notes = []) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((file) => {
      const name = file.replace(/\.html$/, '')
      const open = notes.filter((n) => !n.done && n.screen === name).length
      // One broken file must not take the whole viewer down: name it instead.
      try {
        const mtime = statSync(join(dir, file)).mtimeMs
        const hit = screenCache.get(file)
        const info = hit && hit.mtime === mtime ? hit.info : summarize(readFileSync(join(dir, file), 'utf8'))
        screenCache.set(file, { mtime, info })
        return { file, ...info, notes: open, mtime: Math.round(mtime) }
      } catch (e) {
        return { file, error: e.message }
      }
    })
}
// A screen file is up to 25 MB: parse it once per change, not on every page load.
const screenCache = new Map()
function summarize(text) {
  const states = parseScreen(text).states
  return { states: states.length, first: states[0]?.id ?? null, labels: states.map((s) => s.attrs['data-label']).filter(Boolean) }
}

// One state of a screen file, cut out as text (a full parse of a large file is slow): the opening tag's
// attributes and the content. Attribute values are double-quoted and may hold ">".
const TEMPLATE_RE = /<template\b((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>([\s\S]*?)<\/template>/g
const decodeAttr = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
export function stateFromText(text, id) {
  for (const m of text.matchAll(TEMPLATE_RE)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], decodeAttr(a[2] ?? '')]))
    if (attrs.id === id && !('data-variant-of' in attrs)) return { id, attrs, html: m[2].trim(), variants: [] }
  }
  return null
}

// browser: the session's app browser ({ appPages, copyFrom, resize, targetIdOf, badge }), or null when no browser is open.
export async function createViewServer({ root, cfg, dataDir = null, port = 0, browser = null, watch: doWatch = true, build: buildOpt = true, onPreset = null }) {
  if (dataDir) setDataDir(dataDir)
  const build = buildOpt
  const base = resolve(root, cfg.dir)
  const screensDir = join(base, 'screens')
  const clients = new Set()
  let buildError = null
  const send = (text) => { for (const c of clients) c.write(text) }
  const errorEvent = (m) => `event: buildError\ndata: ${JSON.stringify(m)}\n\n`

  // A failed build leaves the last dist file in place (the child writes only after a good build).
  async function runBuild() {
    try {
      await buildCssInChild(root, dataDir)
      buildError = null
      return true
    } catch (e) {
      buildError = `CSS build failed: ${e.message.trim().split('\n').slice(0, 6).join('\n')}`
      console.error(buildError)
      send(errorEvent(buildError))
      return false
    }
  }
  if (build) await runBuild()

  const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
  const ownOrigins = () => [`http://127.0.0.1:${server.address().port}`, `http://localhost:${server.address().port}`]

  // Every POST: a foreign Origin is refused, then a non-JSON body. A JSON content type forces a browser
  // preflight that this server never answers. No Origin at all (curl from Claude) is allowed.
  async function readJson(req, res) {
    if (req.headers.origin != null && !ownOrigins().includes(req.headers.origin)) return json(res, 403, { error: 'Requests are accepted only from this viewer' }), null
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'Send application/json' }), null
    const { text, tooBig } = await readBody(req, BODY_LIMIT)
    if (tooBig) return json(res, 413, { error: `A request is at most ${BODY_LIMIT} bytes` }), null
    try {
      return { body: JSON.parse(text) }
    } catch {
      return json(res, 400, { error: 'The body is not valid JSON' }), null
    }
  }

  async function postNote(req, res) {
    const got = await readJson(req, res)
    if (!got) return
    const n = got.body
    const bad = validNote(n, cfg.widths)
    if (bad) return json(res, 400, { error: bad })
    let notes
    try {
      notes = readNotes(root, cfg)
    } catch (e) {
      return json(res, 500, { error: e.message })
    }
    noteSeq += 1
    const id = `n-${Date.now()}-${noteSeq}`
    const { screen, state, width, theme, path, text, tag, note } = n
    notes.push({ id, screen, state, width, theme, path, text, tag, note: note.trim(), done: false })
    writeNotes(root, cfg, notes)
    return json(res, 201, { id })
  }

  // The last copies of this session, newest first, for the Copy window's Recent list.
  const recent = []
  // One copy at a time: two copies into one screen file would race.
  let copyChain = Promise.resolve()
  // A stable id per app page: the order of open tabs changes when one closes, so an index sent after
  // the tab list was shown can name the wrong tab. An id names the same page or none.
  const tabIds = new WeakMap()
  let tabSeq = 0
  const tabId = (p) => {
    if (!tabIds.has(p)) { tabSeq += 1; tabIds.set(p, `t-${tabSeq}`) }
    return tabIds.get(p)
  }
  // The tab the user looks at. A background tab reports hidden. Playwright makes every page report focus,
  // so hasFocus decides nothing in the session browser; it does when the page itself knows better.
  const looking = async (p) => {
    try { return await p.evaluate(() => document.visibilityState === 'visible' && document.hasFocus()) } catch { return false }
  }
  async function postCopy(req, res) {
    const got = await readJson(req, res)
    if (!got) return
    const b = got.body
    const bad = validCopy(b)
    if (bad) return json(res, 400, { error: bad })
    const pages = browser ? browser.appPages() : []
    const noPage = () => json(res, 503, { error: 'No app page is open. Start the session and open the app.' })
    if (!pages.length) return noPage()
    let target
    if (typeof b.tab === 'string' && b.tab.startsWith('target:')) {
      // A script that drives the browser over the automation port names its tab by CDP target id.
      const want = b.tab.slice('target:'.length)
      for (const p of pages) if (!target && (await browser.targetIdOf(p).catch(() => null)) === want) target = p
      if (!target) return json(res, 400, { error: `Tab ${b.tab} is not open.` })
    } else if (typeof b.tab === 'string') {
      target = pages.find((p) => tabId(p) === b.tab)
      if (!target) return json(res, 400, { error: `Tab ${b.tab} is closed. Copy again to see the open tabs.` })
    } else if (b.tab != null) {
      // A tab number (0 is the first): kept for older callers.
      target = pages[b.tab]
      if (!target) return json(res, 400, { error: `There is no tab ${b.tab}` })
    }
    if (b.delay) {
      // Copy in N s: meanwhile the user is in the app tab, opening a menu. A badge counts down there and is
      // gone before the copy settles. The tab is picked when the wait ends: the one the user looks at.
      const badge = (ps, text) => Promise.all(ps.map((p) => browser.badge?.(p, text)))
      for (let n = b.delay; n > 0; n--) {
        await badge(target ? [target] : browser.appPages(), `Copy in ${n}`)
        await sleep(1000)
      }
      await badge(browser.appPages(), null)
      if (target && !browser.appPages().includes(target)) return json(res, 400, { error: `Tab ${b.tab} closed during the wait.` })
    }
    if (!target) {
      const now = browser.appPages()
      if (!now.length) return noPage()
      const inView = b.delay ? (await Promise.all(now.map(async (p) => ((await looking(p)) ? p : null)))).filter(Boolean) : []
      if (inView.length === 1) target = inView[0]
      else if (now.length === 1) target = now[0]
      else return json(res, 409, { tabs: await Promise.all(now.map(async (p) => ({ id: tabId(p), title: await p.title().catch(() => '') }))) })
    }
    // A scripted copy (the automation port) moves the pointer away; a user's copy keeps it.
    const scripted = typeof b.tab === 'string' && b.tab.startsWith('target:') ? { keepPointer: false } : {}
    const run = copyChain.then(() => browser.copyFrom(target, { screen: b.screen, state: b.state, label: b.label, replace: b.replace === true, ...scripted }))
    copyChain = run.catch(() => {})
    let out
    try {
      out = await run
    } catch (e) {
      return json(res, 500, { error: `Copy failed: ${e.message}` })
    }
    if (out.status === 409) return json(res, 409, { exists: true, error: `State ${b.state} already exists at this width. Send replace: true to replace it.` })
    recent.unshift({ screen: slugScreen(b.screen), state: b.state, width: out.width ?? null, at: Date.now() })
    recent.length = Math.min(recent.length, 20)
    return json(res, 201, { saved: out.saved, images: out.images, warnings: out.warnings })
  }

  async function postResize(req, res) {
    const got = await readJson(req, res)
    if (!got) return
    const w = got.body?.width
    if (!cfg.widths.includes(w)) return json(res, 400, { error: `width must be one of ${cfg.widths.join(', ')}` })
    if (!browser) return json(res, 503, { error: 'No app browser is open.' })
    await browser.resize(w)
    return json(res, 200, { width: w })
  }

  // The Copy window reports its names (screen, state, label) so the keyboard chord can reuse them.
  async function postPreset(req, res) {
    const got = await readJson(req, res)
    if (!got) return
    const b = got.body
    const bad = validCopy(b)
    if (bad) return json(res, 400, { error: bad })
    if (onPreset) onPreset({ screen: b.screen, state: b.state, label: b.label })
    return json(res, 200, { ok: true })
  }

  const fail = (res) => (e) => { if (!res.headersSent) json(res, 500, { error: e.message }) }
  const server = createServer((req, res) => {
    let path
    try {
      path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    } catch {
      return res.writeHead(400).end('Bad path')
    }
    const port = server.address().port
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(String(req.headers.host ?? '').toLowerCase())) return res.writeHead(403).end('Forbidden host')
    const html = (text) => res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' }).end(text)
    if (req.method === 'POST') {
      if (path === '/__notes') return void postNote(req, res).catch(fail(res))
      if (path === '/__copy') return void postCopy(req, res).catch(fail(res))
      if (path === '/__preset') return void postPreset(req, res).catch(fail(res))
      if (path === '/__resize') return void postResize(req, res).catch(fail(res))
      return res.writeHead(404).end('Not found')
    }
    if (path === '/') {
      let notes = []
      try { notes = readNotes(root, cfg) } catch {}
      return html(homePage(listScreens(screensDir, notes), { project: basename(root), style: cfg.style }))
    }
    if (path.startsWith('/__state/')) {
      // One state as a whole page (home previews, Recent): a few KB instead of the whole screen file.
      const [name, id] = path.slice('/__state/'.length).split('/')
      const file = join(screensDir, `${name}.html`)
      if (!/^[a-z0-9-]{1,80}$/.test(name ?? '') || !id || !existsSync(file)) return res.writeHead(404).end('Not found')
      const st = stateFromText(readFileSync(file, 'utf8'), id)
      if (!st) return res.writeHead(404).end('Not found')
      const switcher = join(base, 'switcher.js')
      return html(loadSwitcher(existsSync(switcher) ? switcher : undefined).buildStateDoc(st, { theme: 'light', base: '/screens/', width: cfg.widths[0] }))
    }
    if (path === '/__tabs') {
      const pages = browser ? browser.appPages() : []
      return void Promise.all(pages.map(async (p) => ({ id: tabId(p), title: await p.title().catch(() => ''), url: p.url(), width: await p.evaluate(() => window.innerWidth).catch(() => null) })))
        .then((list) => json(res, 200, list), fail(res))
    }
    if (path === '/__recent') return json(res, 200, recent)
    if (path === '/__blank') return html('<!doctype html><title>blank</title>')
    if (path === '/__copy') return html(copyWindow({ screens: existsSync(screensDir) ? readdirSync(screensDir).filter((f) => f.endsWith('.html')).sort().map((f) => f.replace(/\.html$/, '')) : [], widths: cfg.widths }))
    if (path === '/__notes') {
      try {
        const open = readNotes(root, cfg).filter((x) => !x.done)
        // ?screen=<name>: also the open notes per state, for the state list's dots.
        const screen = new URL(req.url, 'http://x').searchParams.get('screen')
        const byState = {}
        if (screen) for (const x of open) if (x.screen === screen) { const id = x.state.split('@')[0]; byState[id] = (byState[id] ?? 0) + 1 }
        return json(res, 200, screen ? { open: open.length, byState } : { open: open.length })
      } catch (e) {
        return json(res, 200, { open: 0, error: e.message })
      }
    }
    if (path === '/__reload') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      res.write(': connected\n\n')
      if (buildError) res.write(errorEvent(buildError))
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    const file = resolve(base, `.${path}`)
    const inside = file.startsWith(base + sep) && !file.startsWith(join(base, '.local') + sep)
    if (!inside || !existsSync(file)) return res.writeHead(404).end('Not found')
    // A symlink inside the folder must not reach a file outside it.
    let real
    try { real = realpathSync(file) } catch { return res.writeHead(404).end('Not found') }
    const realBase = realpathSync(base)
    if (!real.startsWith(realBase + sep) || real.startsWith(join(realBase, '.local') + sep) || !statSync(real).isFile()) return res.writeHead(404).end('Not found')
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(real))
  })

  // Screens and the style sources need a CSS build; page.css and fonts.css need only a reload.
  const watchers = []
  if (doWatch) {
    let timer = null
    let needBuild = false
    const flush = async () => {
      const b = needBuild
      needBuild = false
      if (b && build && !(await runBuild())) return
      send('data: reload\n\n')
    }
    const later = (rebuild) => {
      needBuild = needBuild || rebuild
      clearTimeout(timer)
      timer = setTimeout(() => void flush(), DEBOUNCE_MS)
    }
    const add = (dir, opts, fn) => { if (existsSync(dir)) watchers.push(watch(dir, opts, fn)) }
    add(screensDir, { recursive: true }, () => later(true))
    add(base, {}, (_e, f) => { if (f === 'page.css' || f === 'fonts.css') later(false) })
    for (const w of adapterFor(cfg).watchDirs(root, cfg)) {
      add(w.dir, { recursive: w.recursive }, (_e, f) => {
        if (!f) return
        const full = join(w.dir, String(f))
        if (full.startsWith(base + sep) || full.split(sep).includes('node_modules')) return
        if (w.match(full)) later(true)
      })
    }
  }
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const actual = server.address().port
  return {
    port: actual,
    url: `http://127.0.0.1:${actual}`,
    close: () =>
      new Promise((r) => {
        watchers.forEach((w) => w.close())
        for (const c of clients) c.end()
        server.closeAllConnections?.()
        server.close(r)
      }),
  }
}

async function main() {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '8900' }, data: { type: 'string' } } })
  setDataDir(values.data)
  const root = projectRoot(process.cwd())
  const v = await createViewServer({ root, cfg: readConfig(root), dataDir: values.data ?? null, port: Number(values.port) })
  console.log(`Designs: ${v.url}/`)
}

if (isMain(import.meta.url)) await main()
