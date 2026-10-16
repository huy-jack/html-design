// usage: node view.mjs [--port 8900] [--data <dir>]  (run in the project root)
// Local server for the design folder: rebuilds the CSS on start and when screens or the Tailwind source change,
// then tells open pages to reload. Serves the Copy tab and the copy endpoints. 127.0.0.1 only.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import { basename, extname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { buildCssInChild } from './build-css.mjs'
import { projectRoot, readConfig } from './config.mjs'
import { readNotes, writeNotes } from './notes.mjs'
import { isMain } from './deps.mjs'
import { setDataDir } from './runtime.mjs'
import { parseScreen, slugScreen, slugState } from './screen-file.mjs'
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
  if (!validTab(b.tab)) return TAB_RULE
  if (b.delay != null && !isInt(b.delay, 1, 10)) return 'delay must be whole seconds, 1 to 10'
  return null
}
const NO_SESSION = 'The session is not running. In Claude Code, type /html-design start.'
const NO_APP_TAB = "Your app is not open yet. Open a new tab in this browser window (Ctrl+T or Cmd+T) and go to your app's address."
const FOCUS_PATH = /^\/(?:__copy|screens\/[a-z0-9-]{1,80}\.html(?:#[\w.%@-]{0,300})?)?$/
const TAB_RULE = 'tab must be a tab id from the tabs list, target:<CDP target id>, or a tab number'
const validTab = (t) => t == null || isInt(t, 0, 1000) || (typeof t === 'string' && /^(t-\d{1,9}|target:[A-Za-z0-9]{1,64})$/.test(t))

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

// Shared look of the plugin's own pages (home, Copy tab). The switcher in each screen file carries the same tokens.
// Light by default, dark when the computer asks for it; data-ui on <html> is the user's own choice (key hd-ui).
// Accent only for the main action, the selected item, links and focus; never inside the design.
const FONT_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">'
const LIGHT = '--bg:#ffffff;--chrome:#f6f7f9;--raise:#ffffff;--hover:#eceef2;--line:#e4e4e7;--edge:#8e8e98;--ink:#18181b;--dim:#52525b;--mute:#63636b;--accent:#2563eb;--accent-h:#1d4ed8;--accent-p:#1e40af;--link:#2563eb;--sel:#eff4ff;--sel-ink:#1e40af;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;--ok-bg:#f0fdf4;--warn-bg:#fffbeb;--warn-edge:#d97706;--bad-bg:#fef2f2;color-scheme:light'
const DARK = '--bg:#111113;--chrome:#18181b;--raise:#1f1f23;--hover:#2a2a2e;--line:#2a2a2e;--edge:#71717a;--ink:#f4f4f5;--dim:#a1a1aa;--mute:#8b8b94;--link:#7aa7ff;--sel:#1c2a4a;--sel-ink:#f4f4f5;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--ok-bg:#12261a;--warn-bg:#2b2210;--warn-edge:#a16207;--bad-bg:#2c1515;color-scheme:dark'
const CHROME_CSS = `:root{${LIGHT}}@media (prefers-color-scheme:dark){:root:not([data-ui=light]){${DARK}}}:root[data-ui=dark]{${DARK}}
*{box-sizing:border-box;margin:0}body{font:14px/1.5 Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}[hidden]{display:none !important}
svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.mono{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}.sp{flex:1}
.kbd{font:500 12px/1.4 "Geist Mono",ui-monospace,monospace;color:var(--dim);border:1px solid var(--edge);border-radius:4px;padding:0 5px}
.btn{height:36px;min-width:36px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 14px;border-radius:8px;color:var(--ink);border:1px solid var(--edge);background:var(--raise);font:inherit;font-weight:500;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--hover);text-decoration:none}.btn:disabled{opacity:.5;cursor:not-allowed}.btn.icon{width:36px;padding:0}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.btn.primary:hover{background:var(--accent-h);border-color:var(--accent-h)}.btn.primary:active{background:var(--accent-p)}
.seg{display:inline-flex;padding:3px;background:var(--chrome);border:1px solid var(--edge);border-radius:8px;gap:2px}
.seg>button{height:28px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border-radius:6px;color:var(--dim);font:inherit;font-size:13px;font-weight:500;background:none;border:0;cursor:pointer}
.seg>button:hover{color:var(--ink);background:var(--hover)}.seg>button[aria-pressed=true]{background:var(--accent);color:#fff}
.pill{display:inline-flex;align-items:center;gap:8px;min-width:0;color:var(--dim);font-size:13px;padding:0 12px;height:32px;border:1px solid var(--line);border-radius:999px;background:var(--raise);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);flex:none}.dot.off{background:var(--mute)}
.field{height:38px;width:100%;padding:0 12px;border:1px solid var(--edge);border-radius:8px;background:var(--raise);color:var(--ink);font:inherit;outline:none}
.field:focus{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}.field::placeholder{color:var(--mute)}.field[aria-invalid=true]{border-color:var(--bad);box-shadow:0 0 0 1px var(--bad)}
select.field{appearance:none;padding-right:32px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238e8e98' stroke-width='2.4'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
.spin{width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite;flex:none}@keyframes spin{to{transform:rotate(360deg)}}
.top{height:56px;border-bottom:1px solid var(--line);background:var(--chrome);display:flex;align-items:center;padding:0 24px;gap:12px;position:sticky;top:0;z-index:2}
.mark{width:20px;height:20px;border-radius:6px;background:var(--ink);position:relative;flex:none}.mark:after{content:"";position:absolute;inset:5px 5px 9px;border:1.6px solid var(--chrome);border-radius:2px}`
const ICONS = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
}
const STYLE_NAMES = { tw4: 'Tailwind 4', tw3: 'Tailwind 3', css: 'CSS' }
// "5 min ago": the page fills <time data-mtime> in the viewer's own clock.
const AGO_JS = `function ago(t){var s=(Date.now()-t)/1000;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+' min ago';if(s<86400)return Math.floor(s/3600)+' h ago';if(s<172800)return 'yesterday';return new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`
// In <head>: the saved tool theme before the first paint.
const UI_HEAD_JS = `<script>try{var t=localStorage.getItem('hd-ui');if(t)document.documentElement.setAttribute('data-ui',t)}catch(e){}</script>`
// The tool theme button (#uiTheme), and links between the plugin's tabs. In the session browser (it has the
// chord binding) a data-focus link switches to the open tab through the server; else it is a plain link.
const PAGE_JS = `function uiDark(){var t=document.documentElement.getAttribute('data-ui');return t?t==='dark':!!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)}
function uiShow(){var b=document.getElementById('uiTheme');if(!b)return;var d=uiDark();b.innerHTML=d?${JSON.stringify(ICONS.sun)}:${JSON.stringify(ICONS.moon)};b.title=d?'Use the light theme for this tool':'Use the dark theme for this tool';b.setAttribute('aria-label',b.title)}
uiShow()
document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('#uiTheme')
  if(b){var t=uiDark()?'light':'dark';document.documentElement.setAttribute('data-ui',t);try{localStorage.setItem('hd-ui',t)}catch(x){}uiShow();return}
  var a=e.target.closest&&e.target.closest('a[data-focus]')
  if(!a||!window.__hdCopy||e.metaKey||e.ctrlKey||e.shiftKey||e.button)return
  e.preventDefault()
  fetch('/__focus',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:a.getAttribute('data-focus')})}).then(function(r){if(!r.ok)throw new Error('no')}).catch(function(){location.href=a.href})
})`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const exampleAddress = (url) => (url ? String(url).replace(/^https?:\/\//, '').replace(/\/$/, '') : 'localhost:5173')

// The home page: what the next step is (3 steps), every screen as a card, search over screens and states.
// The part inside <main> is also what a live update reads back (GET / again), so there is one renderer.
export function homePage(screens, { project = '', style = '', appUrl = null } = {}) {
  const total = screens.reduce((n, s) => n + (s.states || 0), 0)
  const cards = screens
    .map((s) => {
      const name = s.file.replace(/\.html$/, '')
      const rev = `${s.mtime ?? 0}-${s.notes ?? 0}-${s.error ? 'x' : ''}`
      if (s.error) return `<div class="card" data-name="${esc(name)}" data-search="${esc(name.toLowerCase())}" data-mtime="0" data-states="0" data-rev="${esc(rev)}"><div class="th bad"><p>This file could not be read. In Claude Code, say: check ${esc(name)}.</p><details><summary>Details</summary><p class="mono">${esc(s.error)}</p></details></div><div class="nm"><a href="/screens/${esc(s.file)}">${esc(name)}</a></div></div>`
      const href = `/screens/${esc(s.file)}${s.first ? `#${esc(encodeURIComponent(s.first))}` : ''}`
      const thumb = s.first ? `<iframe src="/__state/${esc(name)}/${esc(encodeURIComponent(s.first))}" loading="lazy" tabindex="-1" aria-hidden="true" scrolling="no" title=""></iframe>` : ''
      const notes = s.notes ? `<span class="badge">${plural(s.notes, 'note')}</span>` : ''
      const search = [name, ...(s.labels ?? [])].join(' ').toLowerCase()
      const hits = (s.list ?? []).map((x) => `<a href="/screens/${esc(s.file)}#${esc(encodeURIComponent(x.id))}" data-q="${esc([x.label, x.id].filter(Boolean).join(' ').toLowerCase())}" hidden>${esc(x.label || x.id)}</a>`).join('')
      return `<div class="card" data-name="${esc(name)}" data-search="${esc(search)}" data-mtime="${s.mtime ?? 0}" data-states="${s.states}" data-rev="${esc(rev)}"><a class="th" href="${href}" tabindex="-1" aria-hidden="true">${thumb}</a><div class="nm"><a href="${href}">${esc(name)}</a><span class="newtag" hidden>New</span>${notes}</div><div class="mt"><span>${plural(s.states, 'state')}</span><span>·</span><time data-mtime="${s.mtime ?? 0}"></time></div><div class="hits" hidden>${hits}<span class="more" hidden></span></div></div>`
    })
    .join('')
  const openCopy = `<a class="btn primary" id="openCopy" href="/__copy" target="_blank" data-focus="/__copy">${ICONS.copy}Open Copy tab</a>`
  const step = (key, n, html) => `<li data-step="${key}" data-done="false"><span class="num">${n}</span><div>${html}</div><span class="done">${ICONS.check}Done</span></li>`
  const content = screens.length
    ? `<div class="head"><div><h1>Screens</h1><p class="sub" id="count">${plural(screens.length, 'screen')} · ${plural(total, 'state')}</p><p class="explain">A screen holds several states: the same page with a menu open, empty, loading.</p></div><div class="sp"></div>
<div class="seg" id="sort" role="group" aria-label="Sort"><button type="button" data-sort="recent" aria-pressed="true">Recent</button><button type="button" data-sort="name" aria-pressed="false">A–Z</button><button type="button" data-sort="states" aria-pressed="false">Most states</button></div>${openCopy}</div>
<ol class="strip" id="steps" aria-label="How it works">${step('copy', 1, 'Copy a screen')}${step('note', 2, 'Pick and write notes')}${step('say', 3, 'In Claude Code say: <b>do my notes</b>')}</ol>
<div class="grid" id="grid">${cards}</div><div class="none" id="none" hidden><p id="noneText">No screen matches</p><button type="button" class="btn" id="clear-search">Clear search</button></div>`
    : `<section class="first"><h1>No screens yet</h1><p class="lead">Three steps to your first design change.</p><ol class="steps" id="steps">
${step('app', 1, `<b>Open your app.</b> In this browser window, open your app in its own tab (for example ${esc(exampleAddress(appUrl))}).`)}
${step('copy', 2, '<b>Copy a screen.</b> Go to the Copy tab, name what you see, press Copy state.')}
${step('note', 3, '<b>Change it.</b> Open the screen here, press Pick, click any part and write a note. Then in Claude Code, say: do my notes.')}
</ol>${openCopy}</section>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Screens</title>${UI_HEAD_JS}${FONT_LINK}<style>${CHROME_CSS}
.crumb{display:flex;align-items:center;gap:8px;color:var(--dim);white-space:nowrap}.crumb b{color:var(--ink);font-weight:600}
.search{position:relative;width:280px;flex:none}.search svg{position:absolute;left:11px;top:11px;color:var(--mute)}.search .field{padding-left:34px;padding-right:34px}.search .kbd{position:absolute;right:9px;top:9px}
.wrap{max-width:1600px;margin:0 auto;padding:32px 32px 48px}.head{display:flex;align-items:flex-end;gap:12px;margin-bottom:16px;flex-wrap:wrap}
h1{font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-.01em}.sub{color:var(--dim);margin-top:4px}.explain{color:var(--mute);font-size:13px}
.strip{list-style:none;display:flex;flex-wrap:wrap;gap:8px 28px;padding:12px 16px;margin:0 0 28px;border:1px solid var(--line);border-radius:12px;background:var(--chrome);color:var(--dim);font-size:13px}
.strip li,.steps li{display:flex;align-items:center;gap:8px}.strip b{color:var(--ink)}
.num{width:24px;height:24px;border-radius:50%;border:1px solid var(--edge);display:inline-grid;place-items:center;font-size:12px;font-weight:600;color:var(--dim);flex:none}
.done{display:none;align-items:center;gap:4px;color:var(--ok);font-size:12px;font-weight:600}[data-done=true] .done{display:inline-flex}[data-done=true] .num{border-color:var(--ok);color:var(--ok)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:28px 24px}.card{min-width:0}
.th{display:block;aspect-ratio:16/10;border-radius:12px;overflow:hidden;background:#fff;border:1px solid var(--line);position:relative;transition:transform .15s,box-shadow .15s}
.th iframe{position:absolute;top:0;left:0;width:1440px;height:900px;border:0;transform-origin:0 0;transform:scale(var(--k,.16));pointer-events:none;background:#fff}
a.th:hover{transform:translateY(-2px);box-shadow:0 10px 24px -10px rgba(0,0,0,.35)}.card.new .th{box-shadow:0 0 0 3px var(--accent)}
.th.bad{background:var(--bad-bg);border-color:var(--bad);color:var(--ink);padding:14px;font-size:13px;overflow:auto}.th.bad p{margin-bottom:6px}.th.bad summary{color:var(--dim);cursor:pointer;font-size:12px}.th.bad .mono{font-size:12px;color:var(--dim);word-break:break-word}
.nm{display:flex;align-items:center;gap:8px;margin-top:12px;min-width:0}.nm>a{color:var(--ink);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.newtag{flex:none;background:var(--accent);color:#fff;font-size:12px;font-weight:600;line-height:20px;padding:0 8px;border-radius:999px}
.mt{color:var(--dim);font-size:13px;margin-top:2px;display:flex;gap:6px}
.badge{margin-left:auto;flex:none;font-size:12px;font-weight:500;color:var(--warn);background:var(--warn-bg);border-radius:999px;padding:1px 8px}
.hits{margin-top:8px;display:grid;gap:4px}.hits a{display:block;padding:4px 10px;border-radius:8px;font-size:13px;background:var(--chrome);border:1px solid var(--line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.more{font-size:12px;color:var(--dim);padding:0 10px}
.none{padding:48px 0;text-align:center;color:var(--dim);display:grid;justify-items:center;gap:12px}
.first{max-width:640px;margin:8vh auto 0;padding:32px;border:1px solid var(--line);border-radius:12px;background:var(--chrome)}.lead{color:var(--dim);margin:4px 0 24px}
.steps{list-style:none;padding:0;margin:0 0 28px;display:grid;gap:16px}.steps li{align-items:flex-start;gap:12px;line-height:1.5}.steps li>div{flex:1}.steps .num{margin-top:-1px}
@media (max-width:860px){.crumb span{display:none}.search{flex:1;width:auto}.wrap{padding:20px 16px}}
</style></head><body>
<header class="top"><span class="mark"></span><div class="crumb"><span>html-design</span><span>/</span><b>${esc(project)}</b></div><div class="sp"></div>
<div class="pill" id="pill"${style ? ` title="Style: ${esc(STYLE_NAMES[style] ?? style)}"` : ''}><span class="dot"></span>Live</div>
<label class="search">${ICONS.search}<input id="q" class="field" placeholder="Search screens and states" aria-label="Search screens and states"><span class="kbd">/</span></label>
<button type="button" class="btn icon" id="uiTheme"></button></header>
<main class="wrap" id="main">${content}</main>
<script>
${AGO_JS}
${PAGE_JS}
var $ = function (id) { return document.getElementById(id) }
var q = $('q')
var each = function (sel, fn, root) { Array.prototype.forEach.call((root || document).querySelectorAll(sel), fn) }
var plural = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's') }
function fit() { each('.th', function (t) { t.style.setProperty('--k', t.clientWidth / 1440) }) }
function times() { each('time[data-mtime]', function (t) { var m = Number(t.getAttribute('data-mtime')); t.textContent = m ? ago(m) : '' }) }
var sortKey = 'recent'; try { sortKey = localStorage.getItem('hd-sort') || 'recent' } catch (e) {}
// The order is CSS order, not a DOM move: moving a card would reload its preview. A new card goes first.
function sortBy(k) {
  sortKey = k
  try { localStorage.setItem('hd-sort', k) } catch (e) {}
  var grid = $('grid')
  each('#sort button', function (b) { b.setAttribute('aria-pressed', String(b.dataset.sort === k)) })
  if (!grid) return
  var cards = Array.prototype.slice.call(grid.children)
  cards.sort(function (a, b) {
    if (k === 'name') return a.dataset.name.localeCompare(b.dataset.name)
    if (k === 'states') return b.dataset.states - a.dataset.states
    return b.dataset.mtime - a.dataset.mtime
  })
  cards.forEach(function (c, i) { c.style.order = c.classList.contains('new') ? -1 : i })
}
// Search: a card shows when its name or a state matches; up to 3 matching states are listed under it.
function filter() {
  var grid = $('grid')
  if (!grid) return
  var v = q.value.trim().toLowerCase(), shown = 0, hits = 0, states = 0, cards = 0
  each('.card', function (c) {
    cards += 1
    states += Number(c.dataset.states) || 0
    var k = 0
    each('.hits a', function (a) { var on = !!v && a.dataset.q.indexOf(v) !== -1; if (on) k += 1; a.hidden = !on || k > 3 }, c)
    var box = c.querySelector('.hits'), more = c.querySelector('.more')
    if (box) box.hidden = !k
    if (more) { more.hidden = k <= 3; more.textContent = '+' + (k - 3) + ' more' }
    var on = !v || k > 0 || c.dataset.search.indexOf(v) !== -1
    c.hidden = !on
    if (on) { shown += 1; hits += k }
  }, grid)
  $('count').textContent = !v ? plural(cards, 'screen') + ' · ' + plural(states, 'state') : hits ? plural(hits, 'state') + ' in ' + plural(shown, 'screen') : plural(shown, 'screen')
  $('none').hidden = shown > 0
  $('noneText').textContent = 'No screen matches "' + q.value.trim() + '"'
}
function firstMatch() {
  var cards = Array.prototype.filter.call(document.querySelectorAll('#grid .card'), function (c) { return !c.hidden })
  cards.sort(function (a, b) { return a.style.order - b.style.order })
  if (!cards.length) return null
  var hit = Array.prototype.filter.call(cards[0].querySelectorAll('.hits a'), function (a) { return !a.hidden })[0]
  return (hit || cards[0].querySelector('.nm a')).getAttribute('href')
}
// Not named status: window.status is a built-in that turns any value into a string.
var lastStatus = null
function tick() {
  if (!lastStatus) return
  var done = { app: lastStatus.tabs > 0, copy: lastStatus.screens > 0, note: lastStatus.notes > 0, say: false }
  each('#steps [data-step]', function (li) { li.setAttribute('data-done', String(!!done[li.dataset.step])) })
}
function render() { times(); fit(); sortBy(sortKey); filter(); tick() }
// New or changed screens: marked New for 3 s. Their previews load again after the CSS build (stale).
var stale = []
function markNew(c) {
  c.classList.add('new')
  var tag = c.querySelector('.newtag')
  if (tag) tag.hidden = false
  stale.push(c.dataset.name)
  setTimeout(function () { c.classList.remove('new'); if (tag) tag.hidden = true; sortBy(sortKey) }, 3000)
}
// Live: read the page again and change only what changed, so the search text, the scroll and loaded previews stay.
function refresh() {
  return fetch('/', { cache: 'no-store' }).then(function (r) { return r.text() }).then(function (t) {
    var next = new DOMParser().parseFromString(t, 'text/html')
    var grid = $('grid'), ng = next.getElementById('grid')
    if (!grid || !ng) {
      $('main').innerHTML = next.getElementById('main').innerHTML
      each('#grid .card', markNew)
      return render()
    }
    var old = {}, seen = {}
    each('.card', function (c) { old[c.dataset.name] = c }, grid)
    Array.prototype.slice.call(ng.children).forEach(function (c) {
      var o = old[c.dataset.name]
      seen[c.dataset.name] = 1
      if (o && o.dataset.rev === c.dataset.rev) return
      var fresh = document.importNode(c, true)
      if (o) grid.replaceChild(fresh, o)
      else grid.appendChild(fresh)
      if (!o || o.dataset.mtime !== c.dataset.mtime) markNew(fresh)
    })
    for (var n in old) if (!seen[n]) old[n].remove()
    render()
  }, function () {})
}
function pill(live) {
  $('pill').innerHTML = live ? '<span class="dot"></span>Live' : '<span class="dot off"></span>Session stopped. In Claude Code, type /html-design start'
}
function poll() {
  fetch('/__status', { cache: 'no-store' }).then(function (r) { return r.json() }).then(function (s) {
    lastStatus = s
    pill(true)
    tick()
    if (s.screens !== document.querySelectorAll('#grid .card').length) refresh()
  }, function () { pill(false) })
}
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('#sort button')
  if (b) sortBy(b.dataset.sort)
  if (e.target.closest && e.target.closest('#clear-search')) { q.value = ''; filter(); q.focus() }
})
q.oninput = filter
q.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { var to = firstMatch(); if (to) location.href = to }
})
addEventListener('keydown', function (e) {
  if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && document.activeElement !== q) { e.preventDefault(); q.focus() }
  if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; filter(); q.blur() }
})
addEventListener('resize', fit)
render()
poll(); setInterval(poll, 2000)
try {
  var events = new EventSource('/__reload')
  events.addEventListener('change', refresh)
  events.onmessage = function () {
    var names = stale
    stale = []
    names.forEach(function (n) { each('.card', function (c) { if (c.dataset.name === n) { var f = c.querySelector('iframe'); if (f) f.src = f.src } }) })
    refresh()
  }
} catch (e) {}
</script></body></html>`
}

// The Copy tab: not part of the app and not a design, so its script is inline. A guided form: a card says
// whether an app tab is open (and switches the copy buttons), one field names the view, errors sit under fields.
export function copyWindow({ screens, widths }) {
  const options = screens.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('') + '<option value="__new">New screen</option>'
  const widthBtns = widths.map((w, i) => `<button type="button" data-width="${w}" aria-pressed="${i === 0}">${w}</button>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Copy tab</title>${UI_HEAD_JS}${FONT_LINK}<style>${CHROME_CSS}
.top b{font-weight:600}.col{max-width:560px;margin:0 auto;padding:24px 24px 48px}
h1{font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-.01em}.lead{color:var(--dim);margin:4px 0 20px}
.box{border:1px solid var(--line);border-radius:12px;background:var(--chrome);padding:16px}
.notice{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--warn-edge);background:var(--warn-bg);border-radius:12px;padding:16px;line-height:1.5}.notice svg{color:var(--warn);width:20px;height:20px;margin-top:1px}
.tabrow{display:flex;align-items:center;gap:12px}.fav{width:32px;height:32px;border-radius:8px;border:1px solid var(--edge);display:grid;place-items:center;color:var(--dim);flex:none}
.tt{flex:1;min-width:0;line-height:1.35}.tt b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tt span{display:block;color:var(--dim);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#tabPick{margin-top:12px}.wrow{margin-top:14px}.wrow .lab{display:block;font-size:13px;font-weight:500;margin-bottom:6px}
label{display:block;font-size:13px;font-weight:500;margin:20px 0 6px}
.hint{color:var(--dim);font-size:13px;margin-top:6px}.err{display:flex;gap:6px;align-items:center;color:var(--bad);font-size:13px;font-weight:500;margin-top:6px}
.idline{font-size:13px;color:var(--dim);margin-top:4px}.idline code{font:500 13px "Geist Mono",ui-monospace,monospace;color:var(--ink)}
.linkbtn{background:none;border:0;padding:0;color:var(--link);font:inherit;cursor:pointer;text-decoration:underline}
.go{width:100%;height:44px;margin-top:24px;font-size:15px}.keyhint{text-align:center;color:var(--dim);font-size:13px;margin-top:8px}
.alt{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.why{display:flex;gap:6px;align-items:center;justify-content:center;color:var(--warn);font-size:13px;font-weight:500;margin-top:10px}
.tips{margin-top:16px;padding-left:18px;color:var(--dim);font-size:13px;display:grid;gap:4px}
.later{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding:10px 12px 10px 16px;border-radius:12px;background:var(--sel);color:var(--sel-ink);font-weight:500}
#msg{margin-top:12px;min-height:21px}#msg.err{color:var(--bad)}#msg.ok{color:var(--ok)}#msg a{font-weight:600;color:var(--link)}
#tabs{margin-top:8px;display:grid;gap:6px}#tabs button{justify-content:flex-start}
.rec{margin-top:28px;border-top:1px solid var(--line);padding-top:20px}.rec h2{font-size:16px;font-weight:600;margin-bottom:8px}
.it{display:flex;align-items:center;gap:12px;padding:8px;margin:0 -8px;border-radius:8px;color:var(--ink)}.it:hover{background:var(--hover);text-decoration:none}
.it .th{width:56px;height:35px;border-radius:6px;overflow:hidden;border:1px solid var(--line);position:relative;background:#fff;flex:none}
.it .th iframe{position:absolute;top:0;left:0;width:1440px;height:900px;border:0;transform:scale(.0389);transform-origin:0 0;pointer-events:none}
.it .time{color:var(--dim);font-size:13px}.empty{color:var(--dim);font-size:13px;padding:6px 0}
</style></head><body>
<header class="top"><a class="btn" href="/" target="_blank" data-focus="/">${ICONS.back}Screens</a><b>Copy tab</b><div class="sp"></div><span id="live" class="pill"><span class="dot off"></span>Checking…</span><button type="button" class="btn icon" id="uiTheme"></button></header>
<main class="col">
<h1>Copy a screen</h1><p class="lead">Bring your app tab to what you want, name it here, press Copy state.</p>
<section id="ready" class="notice" hidden>${ICONS.alert}<div id="readyText"></div></section>
<section id="tab" class="box"><div class="tabrow"><span class="fav">${ICONS.globe}</span><div class="tt"><b id="tabTitle">Looking for your app tab…</b><span id="tabUrl" class="mono"></span></div></div>
<select id="tabPick" class="field" aria-label="App tab" hidden></select>
<div class="wrow"><span class="lab">App width</span><div class="seg" id="widths" role="group" aria-label="App width">${widthBtns}</div></div></section>
<label for="screen">Screen</label><select id="screen" class="field">${options}</select>
<div id="newWrap" hidden><label for="newScreen">Screen name</label><input id="newScreen" class="field" autocomplete="off"><p class="hint">For example: Checkout</p></div>
<p class="err" id="screenErr" role="alert" hidden></p>
<label for="name">Name this view</label><input id="name" class="field" autocomplete="off" aria-describedby="nameHint">
<p class="hint" id="nameHint">What is on screen, for example: Menu open</p><p class="err" id="nameErr" role="alert" hidden></p>
<p class="idline" id="idLine" hidden>Saved as <code id="idShow"></code> · <button type="button" class="linkbtn" id="changeId">Change id</button></p>
<div id="idWrap" hidden><label for="state">State id</label><input id="state" class="field mono" autocomplete="off"><p class="hint">Letters, digits, - _ . Links between states use it.</p></div>
<button type="button" id="copy" class="btn primary go" disabled>${ICONS.copy}Copy state</button>
<p class="keyhint">Or press <span class="kbd">Ctrl</span> <span class="kbd">Shift</span> <span class="kbd">S</span> in your app tab</p>
<div class="alt"><button type="button" id="copyLater" class="btn" disabled>Copy in 5 s</button><button type="button" id="copy3" class="btn" disabled>Copy at ${widths.length} widths</button></div>
<p class="why" id="why" hidden></p>
<div id="later" class="later" hidden><span id="laterText"></span><button type="button" id="cancel" class="btn">Cancel</button></div>
<div id="tabs"></div><div id="msg" role="status"></div>
<ul class="tips"><li class="hint">To copy an open menu: press Ctrl+Shift+S in the app tab, or click Copy in 5 s and open the menu.</li><li class="hint">Copy at ${widths.length} widths resizes the window, so open menus close.</li></ul>
<section class="rec"><h2>Recent</h2><div id="recent"><div class="empty">Copies you make show up here.</div></div></section>
</main>
<script>
${AGO_JS}
${PAGE_JS}
var WIDTHS = ${JSON.stringify(widths)}
var slug = ${slugScreen.toString()}
var slugState = ${slugState.toString()}
var $ = function (id) { return document.getElementById(id) }
var esc = function (v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }
var ALERT = ${JSON.stringify(ICONS.alert)}
var BUTTONS = ['copy', 'copyLater', 'copy3']
var LABELS = {}
BUTTONS.forEach(function (id) { LABELS[id] = $(id).innerHTML })
// text: progress in the button with a spinner; null puts the label back.
function label(id, text) { $(id).innerHTML = text == null ? LABELS[id] : '<span class="spin" aria-hidden="true"></span><span>' + esc(text) + '</span>' }
function msg(html, kind) { $('msg').innerHTML = html; $('msg').className = kind || '' }
function say(text, kind) { msg(esc(text), kind) }
function fieldError(which, text) {
  var f = which === 'screen' ? ($('screen').value === '__new' ? $('newScreen') : $('screen')) : $('name')
  $(which + 'Err').hidden = !text
  $(which + 'Err').innerHTML = text ? ALERT + '<span>' + esc(text) + '</span>' : ''
  if (text) return f.setAttribute('aria-invalid', 'true')
  if (which === 'screen') { $('screen').removeAttribute('aria-invalid'); $('newScreen').removeAttribute('aria-invalid') } else f.removeAttribute('aria-invalid')
}
function showNew() { $('newWrap').hidden = $('screen').value !== '__new' }
$('screen').onchange = function () { showNew(); fieldError('screen', '') }
$('newScreen').addEventListener('input', function () { fieldError('screen', '') })
showNew()
function postJson(path, body) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return {} }).then(function (j) { return { status: r.status, body: j } }) })
}
// Ready: an app tab is open. Working: a copy runs. The copy buttons need ready and not working.
var tabs = [], ready = false, working = false
function sync() { BUTTONS.forEach(function (id) { $(id).disabled = working || !ready }) }
function notReady(html, why) {
  ready = false
  $('ready').hidden = false
  $('tab').hidden = true
  $('readyText').innerHTML = html
  $('why').innerHTML = ALERT + '<span>' + esc(why) + '</span>'
  $('why').hidden = false
  sync()
}
function chosenTab() { return tabs.length > 1 ? $('tabPick').value : undefined }
function showTabs() {
  var get = function (p) { return fetch(p, { cache: 'no-store' }).then(function (r) { return r.json() }) }
  return Promise.all([get('/__tabs'), get('/__status')]).then(function (got) {
    var list = got[0], st = got[1]
    tabs = list
    if (!st.browser) {
      $('live').innerHTML = '<span class="dot off"></span>No session browser'
      return notReady('<b>The session browser is not open.</b> In Claude Code, type /html-design start. This card updates by itself.', 'Start the session first')
    }
    $('live').innerHTML = '<span class="dot"></span>' + (list.length ? 'Session live' : 'Session live · No app tab')
    if (!list.length) return notReady("<b>Your app is not open yet.</b> Open a new tab in this browser window (Ctrl+T or Cmd+T) and go to your app's address. This card updates by itself.", 'Open your app first')
    ready = true
    $('ready').hidden = true
    $('tab').hidden = false
    $('why').hidden = true
    sync()
    var keep = $('tabPick').value
    $('tabPick').hidden = list.length < 2
    $('tabPick').innerHTML = list.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title || t.url) + '</option>' }).join('')
    if (keep && list.some(function (t) { return t.id === keep })) $('tabPick').value = keep
    var t = list.filter(function (x) { return x.id === $('tabPick').value })[0] || list[0]
    $('tabTitle').textContent = t.title || 'Untitled tab'
    $('tabUrl').textContent = t.url.replace(/^https?:\\/\\//, '') + (t.width ? ' · ' + t.width + ' px' : '')
    if (t.width) Array.prototype.forEach.call(document.querySelectorAll('[data-width]'), function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.width) === t.width)) })
  }, function () {
    $('live').innerHTML = '<span class="dot off"></span>Session stopped'
    notReady('<b>The session is stopped.</b> In Claude Code, type /html-design start. This card updates by itself.', 'Start the session first')
  })
}
// A delayed copy names a tab only when the user picked one; else the server takes the tab the user looks at.
var tabPicked = false
$('tabPick').onchange = function () { tabPicked = true; showTabs() }
var viewerHref = function (screen, state, width) { return '/screens/' + slug(screen) + '.html#' + encodeURIComponent(state) + (width ? '@' + width : '') }
var openLink = function (href) { return '<a id="openViewer" href="' + esc(href) + '" target="_blank" data-focus="' + esc(href) + '">Open in viewer</a>' }
function showRecent() {
  return fetch('/__recent').then(function (r) { return r.json() }).then(function (list) {
    if (!list.length) return
    // One row per state: the widths of one state copied in a row are listed together.
    var rows = []
    list.forEach(function (x) {
      var last = rows[rows.length - 1]
      if (last && last.screen === x.screen && last.state === x.state) { if (x.width && last.widths.indexOf(x.width) === -1) last.widths.unshift(x.width); return }
      rows.push({ screen: x.screen, state: x.state, label: x.label, width: x.width, at: x.at, widths: x.width ? [x.width] : [] })
    })
    $('recent').innerHTML = rows.slice(0, 6).map(function (x) {
      var href = viewerHref(x.screen, x.state, x.width)
      return '<a class="it" target="_blank" href="' + esc(href) + '" data-focus="' + esc(href) + '"><span class="th"><iframe loading="lazy" tabindex="-1" aria-hidden="true" src="/__state/' + esc(x.screen) + '/' + encodeURIComponent(x.state) + '"></iframe></span>' +
        '<span class="tt"><b>' + esc(x.label || x.state) + '</b><span>' + esc(x.screen) + (x.widths.length ? ' · ' + x.widths.sort(function (a, b) { return b - a }).join(' · ') : '') + '</span></span><span class="time">' + ago(x.at) + '</span></a>'
    }).join('')
  }, function () {})
}
Array.prototype.forEach.call(document.querySelectorAll('[data-width]'), function (b) {
  b.onclick = function () {
    postJson('/__resize', { width: Number(b.getAttribute('data-width')) }).then(function (r) { say(r.status === 200 ? 'App width: ' + b.getAttribute('data-width') + ' px' : (r.body.error || 'Resize failed'), r.status === 200 ? '' : 'err'); showTabs() })
  }
})
// The state id comes from the name, until the user types an id of their own (Change id).
var customId = false
function stateId() { return customId && $('state').value.trim() ? $('state').value.trim() : slugState($('name').value) }
function showId() { $('idShow').textContent = stateId(); $('idLine').hidden = !stateId() }
$('name').addEventListener('input', function () { if (!customId) $('state').value = slugState($('name').value); showId(); fieldError('name', '') })
$('state').addEventListener('input', function () { customId = !!$('state').value.trim(); showId(); fieldError('name', '') })
$('changeId').onclick = function () { $('idWrap').hidden = false; $('state').value = stateId(); $('state').focus() }
function names() {
  var screen = $('screen').value === '__new' ? $('newScreen').value.trim() : $('screen').value
  return { screen: screen, state: stateId(), label: $('name').value.trim() || undefined }
}
// Checked when Copy is pressed, never while typing. The first bad field gets the focus.
function check(n) {
  fieldError('screen', '')
  fieldError('name', '')
  if (!n.screen || !slug(n.screen)) fieldError('screen', 'Give the screen a name')
  if (!$('name').value.trim() && !customId) fieldError('name', 'Give this view a name')
  else if (!n.state) fieldError('name', 'Use a letter or a digit in the name, or set the id with Change id')
  var bad = document.querySelector('[aria-invalid=true]')
  if (bad) bad.focus()
  return !bad
}
function sendPreset() { postJson('/__preset', names()).catch(function () {}) }
var presetTimer = null
;['screen', 'newScreen', 'name', 'state'].forEach(function (id) {
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
      var warn = r.body.warnings && r.body.warnings.length ? '<br><span class="hint">' + esc(r.body.warnings.join('; ')) + '</span>' : ''
      msg('Saved "' + esc(body.label || body.state) + '" in ' + esc(slug(body.screen)) + (r.body.images ? ' · ' + r.body.images + ' images' : '') + '. ' + openLink(viewerHref(body.screen, body.state)) + warn, 'ok')
      showRecent()
      return true
    }
    if (r.status === 409 && r.body.cancelled) { say('Copy cancelled.'); return false }
    if (r.status === 409 && r.body.tabs) {
      say('Pick the tab to copy:')
      r.body.tabs.forEach(function (t, i) {
        var b = document.createElement('button')
        b.type = 'button'
        b.className = 'btn'
        b.textContent = t.title || 'Tab ' + (i + 1)
        b.onclick = function () { var e = {}; for (var k in extra) e[k] = extra[k]; e.tab = t.id; send(e) }
        $('tabs').appendChild(b)
      })
      return false
    }
    if (r.status === 409 && r.body.exists) {
      if (confirm('State ' + body.state + ' already exists at this width. Replace?')) { var e = {}; for (var k in extra) e[k] = extra[k]; e.replace = true; return send(e) }
      say('Not copied.')
      return false
    }
    var err = r.body.error || 'Copy failed (' + r.status + ')'
    // A field's own error goes under that field.
    if (r.status === 400 && err.indexOf('screen') === 0) fieldError('screen', err)
    else if (r.status === 400 && (err.indexOf('state') === 0 || err.indexOf('label') === 0)) fieldError('name', err)
    else say(err, 'err')
    return false
  }, function () { say('Not copied: the session is stopped. In Claude Code, type /html-design start.', 'err'); return false })
}
function start() { working = true; sync(); say('') }
function finish() { working = false; BUTTONS.forEach(function (id) { label(id) }); sync() }
$('copy').onclick = function () {
  if (!check(names())) return
  start()
  label('copy', 'Copying…')
  send({}).then(finish)
}
var exists = function (n) { return fetch('/__state/' + encodeURIComponent(slug(n.screen)) + '/' + encodeURIComponent(n.state)).then(function (r) { return r.status === 200 }, function () { return false }) }
// The server does the wait, so the copy runs while the user is in the app tab. Replace? is asked here first:
// a dialog in a hidden tab waits until the tab is shown again. Cancel stops the server's wait.
$('copyLater').onclick = function () {
  var n = names()
  if (!check(n)) return
  start()
  exists(n).then(function (has) {
    if (has && !confirm('State ' + n.state + ' already exists. Replace?')) { say('Not copied.'); return finish() }
    var extra = { delay: 5, tab: tabPicked ? chosenTab() : undefined }
    if (has) extra.replace = true
    var left = 5
    var show = function () {
      $('later').hidden = false
      $('laterText').textContent = left > 0 ? 'Copying in ' + left + '... switch to your app' : 'Copying…'
      label('copyLater', left > 0 ? 'Copying in ' + left : 'Copying…')
    }
    show()
    var timer = setInterval(function () { left = Math.max(0, left - 1); show() }, 1000)
    return send(extra).then(function () { clearInterval(timer); $('later').hidden = true; finish() })
  })
}
$('cancel').onclick = function () { $('cancel').disabled = true; postJson('/__cancel', {}).catch(function () {}).then(function () { $('cancel').disabled = false }) }
// Every width in turn: resize, let it settle, copy. The base width first; the window ends there. Each resize
// brings the app tab to the front (Chrome lays out only that tab), so the user ends in the app tab: the
// result shows there too, and Replace? is asked here before the run.
$('copy3').onclick = function () {
  var n = names()
  if (!check(n)) return
  var tab = chosenTab()
  var name = '"' + (n.label || n.state) + '"'
  start()
  exists(n).then(function (has) {
    if (has && !confirm('State ' + n.state + ' already exists. Replace?')) { say('Not copied.'); return finish() }
    var extra = has ? { replace: true } : {}
    var done = function (text) { return postJson('/__toast', { text: text, tab: tab }).catch(function () {}).then(function () { finish(); showTabs() }) }
    var i = 0
    var step = function () {
      if (i === WIDTHS.length) {
        var saved = 'Saved ' + name + ' at ' + WIDTHS.join(', ')
        return postJson('/__resize', { width: WIDTHS[0], front: true, tab: tab }).then(function () { msg(esc(saved) + '. ' + openLink(viewerHref(n.screen, n.state)), 'ok'); return done(saved) })
      }
      var w = WIDTHS[i]
      label('copy3', 'Width ' + (i + 1) + ' of ' + WIDTHS.length)
      say('Copying at ' + w + ' px…')
      return postJson('/__resize', { width: w, front: true, tab: tab })
        .then(function () { return new Promise(function (r) { setTimeout(r, 700) }) })
        .then(function () { return send(extra) })
        .then(function (ok) { if (!ok) return done('Not saved at ' + w + ': ' + $('msg').textContent); i += 1; return step() })
    }
    return step()
  })
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
  return { states: states.length, first: states[0]?.id ?? null, labels: states.map((s) => s.attrs['data-label']).filter(Boolean), list: states.map((s) => ({ id: s.id, label: s.attrs['data-label'] ?? '' })) }
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

// browser: the session's app browser ({ appPages, copyFrom, resize, targetIdOf, badge, toast }), or null when no browser is open.
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

  // The last copies of this session, newest first, for the Copy tab's Recent list.
  const recent = []
  // The Copy in 5 s waits running now.
  const waits = new Set()
  async function postCancel(req, res) {
    if (!(await readJson(req, res))) return
    const n = waits.size
    for (const w of waits) w.cancelled = true
    return json(res, 200, { cancelled: n })
  }
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
  // When the user last clicked, typed or moved the pointer in the tab (the init script records it); 0 if never.
  const lastInput = async (p) => {
    try { return Number(await p.evaluate(() => window.__hdLastInput ?? 0)) || 0 } catch { return 0 }
  }
  // The app tab a request names: { target } (none when tab is not set) or { error }.
  async function namedTab(pages, tab) {
    let target
    if (typeof tab === 'string' && tab.startsWith('target:')) {
      // A script that drives the browser over the automation port names its tab by CDP target id.
      const want = tab.slice('target:'.length)
      for (const p of pages) if (!target && (await browser.targetIdOf(p).catch(() => null)) === want) target = p
      if (!target) return { error: `Tab ${tab} is not open.` }
    } else if (typeof tab === 'string') {
      target = pages.find((p) => tabId(p) === tab)
      if (!target) return { error: `Tab ${tab} is closed. Copy again to see the open tabs.` }
    } else if (tab != null) {
      // A tab number (0 is the first): kept for older callers.
      target = pages[tab]
      if (!target) return { error: `There is no tab ${tab}` }
    }
    return { target }
  }
  async function postCopy(req, res) {
    const got = await readJson(req, res)
    if (!got) return
    const b = got.body
    const bad = validCopy(b)
    if (bad) return json(res, 400, { error: bad })
    const pages = browser ? browser.appPages() : []
    const noPage = () => json(res, 503, { error: browser ? NO_APP_TAB : NO_SESSION })
    if (!pages.length) return noPage()
    let { target, error } = await namedTab(pages, b.tab)
    if (error) return json(res, 400, { error })
    const started = Date.now()
    if (b.delay) {
      // Copy in N s: meanwhile the user is in the app tab, opening a menu. A badge counts down there and is
      // gone before the copy settles. The tab is picked when the wait ends: the one the user used last.
      const badge = (ps, text) => Promise.all(ps.map((p) => browser.badge?.(p, text)))
      // POST /__cancel ends the wait: checked every 100 ms, so Cancel answers at once.
      const wait = { cancelled: false }
      waits.add(wait)
      try {
        for (let n = b.delay; n > 0 && !wait.cancelled; n--) {
          await badge(target ? [target] : browser.appPages(), `Copy in ${n}`)
          for (let t = 0; t < 10 && !wait.cancelled; t++) await sleep(100)
        }
      } finally {
        waits.delete(wait)
      }
      await badge(browser.appPages(), null)
      if (wait.cancelled) return json(res, 409, { cancelled: true, error: 'Copy cancelled.' })
      if (target && !browser.appPages().includes(target)) return json(res, 400, { error: `Tab ${b.tab} closed during the wait.` })
    }
    if (!target) {
      const now = browser.appPages()
      if (!now.length) return noPage()
      // Input during the wait names the tab; else the tab in view; else the only tab.
      const used = b.delay ? (await Promise.all(now.map(async (p) => ({ p, at: await lastInput(p) })))).filter((x) => x.at > started).sort((x, y) => y.at - x.at) : []
      const inView = b.delay && !used.length ? (await Promise.all(now.map(async (p) => ((await looking(p)) ? p : null)))).filter(Boolean) : []
      if (used.length) target = used[0].p
      else if (inView.length === 1) target = inView[0]
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
    recent.unshift({ screen: slugScreen(b.screen), state: b.state, label: b.label ?? null, width: out.width ?? null, at: Date.now() })
    recent.length = Math.min(recent.length, 20)
    return json(res, 201, { saved: out.saved, images: out.images, warnings: out.warnings })
  }

  async function postResize(req, res) {
    const got = await readJson(req, res)
    if (!got) return
    const b = got.body ?? {}
    const w = b.width
    if (!cfg.widths.includes(w)) return json(res, 400, { error: `width must be one of ${cfg.widths.join(', ')}` })
    if (b.front != null && typeof b.front !== 'boolean') return json(res, 400, { error: 'front must be true or false' })
    if (!validTab(b.tab)) return json(res, 400, { error: TAB_RULE })
    if (!browser) return json(res, 503, { error: 'No app browser is open.' })
    // front: a copy at this width follows, and Chrome lays out only the tab in front. The tab: the named
    // one, else the one the user used last, else the first.
    let front = null
    if (b.front) {
      const pages = browser.appPages()
      const { target, error } = await namedTab(pages, b.tab)
      if (error) return json(res, 400, { error })
      const used = await Promise.all(pages.map(async (p) => ({ p, at: await lastInput(p) })))
      front = target ?? used.sort((x, y) => y.at - x.at)[0]?.p ?? null
    }
    await browser.resize(w, front ? { front } : undefined)
    return json(res, 200, { width: w })
  }

  // A short text in the app tab: where the user is when a run started in the Copy tab ends.
  async function postToast(req, res) {
    const got = await readJson(req, res)
    if (!got) return
    const b = got.body ?? {}
    if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 200) return json(res, 400, { error: 'text must be 1 to 200 characters' })
    if (!validTab(b.tab)) return json(res, 400, { error: TAB_RULE })
    if (!browser) return json(res, 503, { error: 'No app browser is open.' })
    const pages = browser.appPages()
    const { target, error } = await namedTab(pages, b.tab)
    if (error) return json(res, 400, { error })
    await Promise.all((target ? [target] : pages).map((p) => browser.toast?.(p, b.text)))
    return json(res, 200, { ok: true })
  }

  // Switches to the open Copy tab or viewer tab (path: /__copy, / or /screens/<name>.html#<state>@<width>).
  async function postFocus(req, res) {
    const got = await readJson(req, res)
    if (!got) return
    const p = got.body?.path
    if (typeof p !== 'string' || !FOCUS_PATH.test(p)) return json(res, 400, { error: 'path must be /, /__copy or /screens/<screen>.html#<state>' })
    if (!browser?.focus) return json(res, 503, { error: 'No session browser is open.' })
    if (!(await browser.focus(p))) return json(res, 503, { error: 'No session browser is open.' })
    return json(res, 200, { ok: true })
  }

  // The notes list in the viewer: change the words of an open note, or delete it. Same file, same fields.
  async function changeNote(req, res, kind) {
    const got = await readJson(req, res)
    if (!got) return
    const b = got.body ?? {}
    if (typeof b.id !== 'string' || !/^n-\d{1,20}-\d{1,9}$/.test(b.id)) return json(res, 400, { error: 'id must be a note id' })
    if (kind === 'edit' && (typeof b.note !== 'string' || !b.note.trim() || b.note.length > 2000)) return json(res, 400, { error: 'note must be 1 to 2000 characters' })
    let notes
    try {
      notes = readNotes(root, cfg)
    } catch (e) {
      return json(res, 500, { error: e.message })
    }
    const i = notes.findIndex((n) => n.id === b.id)
    if (i === -1) return json(res, 404, { error: `No note ${b.id}.` })
    if (kind === 'edit') notes[i].note = b.note.trim()
    else notes.splice(i, 1)
    writeNotes(root, cfg, notes)
    return json(res, 200, { ok: true })
  }

  // The Copy tab reports its names (screen, state, label) so the keyboard chord can reuse them.
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
      if (path === '/__toast') return void postToast(req, res).catch(fail(res))
      if (path === '/__focus') return void postFocus(req, res).catch(fail(res))
      if (path === '/__cancel') return void postCancel(req, res).catch(fail(res))
      if (path === '/__notes/edit') return void changeNote(req, res, 'edit').catch(fail(res))
      if (path === '/__notes/delete') return void changeNote(req, res, 'delete').catch(fail(res))
      return res.writeHead(404).end('Not found')
    }
    if (path === '/') {
      let notes = []
      try { notes = readNotes(root, cfg) } catch {}
      return html(homePage(listScreens(screensDir, notes), { project: basename(root), style: cfg.style, appUrl: cfg.url }))
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
    if (path === '/__status') {
      // Polled by home and the Copy tab: a failed fetch means the session stopped.
      let notes = 0
      try { notes = readNotes(root, cfg).filter((x) => !x.done).length } catch {}
      const screens = existsSync(screensDir) ? readdirSync(screensDir).filter((f) => f.endsWith('.html')).length : 0
      return json(res, 200, { browser: !!browser, tabs: browser ? browser.appPages().length : 0, screens, notes })
    }
    if (path === '/__blank') return html('<!doctype html><title>blank</title>')
    if (path === '/__copy') return html(copyWindow({ screens: existsSync(screensDir) ? readdirSync(screensDir).filter((f) => f.endsWith('.html')).sort().map((f) => f.replace(/\.html$/, '')) : [], widths: cfg.widths }))
    if (path === '/__notes') {
      try {
        const open = readNotes(root, cfg).filter((x) => !x.done)
        // ?screen=<name>: also the open notes per state, for the state list's dots.
        const params = new URL(req.url, 'http://x').searchParams
        const screen = params.get('screen')
        const byState = {}
        if (screen) for (const x of open) if (x.screen === screen) { const id = x.state.split('@')[0]; byState[id] = (byState[id] ?? 0) + 1 }
        // &list=1: the notes themselves, for the viewer's notes list.
        const list = screen && params.get('list') ? open.filter((x) => x.screen === screen).map(({ id, state, width, theme, text, tag, note }) => ({ id, state, width, theme, text, tag, note })) : null
        return json(res, 200, screen ? { open: open.length, byState, ...(list ? { list } : {}) } : { open: open.length })
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
      // Sent before the build, which takes seconds: home shows a new screen at once, the viewer says Updating.
      send('event: change\ndata: {}\n\n')
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
