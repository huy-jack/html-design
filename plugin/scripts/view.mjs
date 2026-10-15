// usage: node view.mjs [--port 8900] [--data <dir>]  (run in the project root)
// Local server for the design folder: rebuilds the CSS on start and when screens or the Tailwind source change,
// then tells open pages to reload. Serves the Copy window and the copy endpoints. 127.0.0.1 only.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { buildCssInChild } from './build-css.mjs'
import { projectRoot, readConfig } from './config.mjs'
import { readNotes, writeNotes } from './notes.mjs'
import { isMain } from './deps.mjs'
import { setDataDir } from './runtime.mjs'
import { parseScreen, slugScreen } from './screen-file.mjs'

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8' }
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const BODY_LIMIT = 16 * 1024
const DEBOUNCE_MS = 100
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
  if (b.tab != null && !isInt(b.tab, 0, 1000) && !(typeof b.tab === 'string' && /^t-\d{1,9}$/.test(b.tab))) return 'tab must be a tab id from the tabs list (or a tab number)'
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

const PAGE_STYLE = 'body{font:16px/1.5 system-ui,sans-serif;margin:24px 16px;color:#212121;background:#fafafa}a{color:#3b5bdb;font-weight:600}span{color:#616161}li{margin:6px 0}'

export function homePage(screens) {
  const rows = screens
    .map((s) => `<li><a href="/screens/${esc(s.file)}">${esc(s.file.replace(/\.html$/, ''))}</a> <span>${s.error ? esc(s.error) : `${s.states} states`}</span></li>`)
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Designs</title><style>${PAGE_STYLE}</style></head><body><h1>Designs</h1><p><a href="/__copy">Copy window</a></p><ul>${rows || '<li>No screen files yet.</li>'}</ul></body></html>`
}

// The Copy window: not part of the app and not a design, so its script is inline.
export function copyWindow({ screens, widths }) {
  const options = screens.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('') + '<option value="__new">New screen</option>'
  const widthBtns = widths.map((w) => `<button type="button" data-width="${w}">${w}</button>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Copy</title>
<style>body{font:15px/1.4 system-ui,sans-serif;margin:16px;color:#212121;background:#fafafa}label{display:block;margin:8px 0 2px}input,select{font:inherit;width:100%;box-sizing:border-box;padding:4px}
button{font:inherit;margin:8px 6px 0 0;padding:4px 10px}#msg{margin-top:12px;min-height:1.4em}#msg.err{color:#b00020}#tabs button{display:block}</style></head><body>
<label for="screen">Screen</label><select id="screen">${options}</select>
<input id="newScreen" placeholder="New screen name" hidden>
<label for="state">State</label><input id="state" placeholder="menu-open">
<label for="label">Label</label><input id="label" placeholder="Menu open">
<div id="widths">${widthBtns}</div>
<div><button type="button" id="copy">Copy</button><button type="button" id="copyLater">Copy in 5 s</button></div>
<div id="tabs"></div><div id="msg"></div>
<script>
var $ = function (id) { return document.getElementById(id) }
var msg = function (t, err) { $('msg').textContent = t; $('msg').className = err ? 'err' : '' }
$('screen').onchange = function () { $('newScreen').hidden = $('screen').value !== '__new' }
$('newScreen').hidden = $('screen').value !== '__new'
function postJson(path, body) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return {} }).then(function (j) { return { status: r.status, body: j } }) })
}
Array.prototype.forEach.call(document.querySelectorAll('[data-width]'), function (b) {
  b.onclick = function () {
    postJson('/__resize', { width: Number(b.getAttribute('data-width')) }).then(function (r) { msg(r.status === 200 ? 'App width: ' + b.getAttribute('data-width') : (r.body.error || 'Resize failed'), r.status !== 200) })
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
function send(extra) {
  var screen = names().screen
  var body = { screen: screen, state: $('state').value.trim(), label: $('label').value.trim() || undefined }
  for (var k in extra) body[k] = extra[k]
  $('tabs').textContent = ''
  msg('Copying...')
  sendPreset()
  postJson('/__copy', body).then(function (r) {
    if (r.status === 201) return msg('Saved ' + r.body.saved + ', ' + r.body.images + ' images' + (r.body.warnings && r.body.warnings.length ? '. Warnings: ' + r.body.warnings.join('; ') : ''))
    if (r.status === 409 && r.body.tabs) {
      msg('Pick the tab to copy:')
      r.body.tabs.forEach(function (t, i) {
        var b = document.createElement('button')
        b.type = 'button'
        b.textContent = t.title || 'Tab ' + (i + 1)
        b.onclick = function () { var e = {}; for (var k in extra) e[k] = extra[k]; e.tab = t.id; send(e) }
        $('tabs').appendChild(b)
      })
      return
    }
    if (r.status === 409 && r.body.exists) {
      if (confirm('State ' + body.state + ' already exists at this width. Replace?')) { var e = {}; for (var k in extra) e[k] = extra[k]; e.replace = true; return send(e) }
      return msg('Not copied.')
    }
    msg(r.body.error || 'Copy failed (' + r.status + ')', true)
  }, function () { msg('The session is not running.', true) })
}
$('copy').onclick = function () { send({}) }
$('copyLater').onclick = function () {
  var n = 5
  var tick = function () { if (n === 0) return send({}); msg('Copy in ' + n + ' s'); n -= 1; setTimeout(tick, 1000) }
  tick()
}
</script></body></html>`
}

function listScreens(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((file) => {
      // One broken file must not take the whole viewer down: name it instead.
      try {
        return { file, states: parseScreen(readFileSync(join(dir, file), 'utf8')).states.length }
      } catch (e) {
        return { file, error: e.message }
      }
    })
}

// browser: the session's app browser ({ appPages, copyFrom, resize }), or null when no browser is open.
export async function createViewServer({ root, cfg, dataDir = null, port = 0, browser = null, watch: doWatch = true, build: buildOpt = true, onPreset = null }) {
  if (dataDir) setDataDir(dataDir)
  const build = buildOpt && !!cfg.css
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
  async function postCopy(req, res) {
    const got = await readJson(req, res)
    if (!got) return
    const b = got.body
    const bad = validCopy(b)
    if (bad) return json(res, 400, { error: bad })
    const pages = browser ? browser.appPages() : []
    if (!pages.length) return json(res, 503, { error: 'No app page is open. Start the session and open the app.' })
    let target
    if (typeof b.tab === 'string') {
      target = pages.find((p) => tabId(p) === b.tab)
      if (!target) return json(res, 400, { error: `Tab ${b.tab} is closed. Copy again to see the open tabs.` })
    } else if (b.tab != null) {
      // A tab number (0 is the first): kept for older callers.
      target = pages[b.tab]
      if (!target) return json(res, 400, { error: `There is no tab ${b.tab}` })
    } else if (pages.length === 1) target = pages[0]
    else return json(res, 409, { tabs: await Promise.all(pages.map(async (p) => ({ id: tabId(p), title: await p.title().catch(() => '') }))) })
    const run = copyChain.then(() => browser.copyFrom(target, { screen: b.screen, state: b.state, label: b.label, replace: b.replace === true }))
    copyChain = run.catch(() => {})
    let out
    try {
      out = await run
    } catch (e) {
      return json(res, 500, { error: `Copy failed: ${e.message}` })
    }
    if (out.status === 409) return json(res, 409, { exists: true, error: `State ${b.state} already exists at this width. Send replace: true to replace it.` })
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
    if (path === '/') return html(homePage(listScreens(screensDir)))
    if (path === '/__blank') return html('<!doctype html><title>blank</title>')
    if (path === '/__copy') return html(copyWindow({ screens: listScreens(screensDir).map((s) => s.file.replace(/\.html$/, '')), widths: cfg.widths }))
    if (path === '/__notes') {
      try {
        return json(res, 200, { open: readNotes(root, cfg).filter((x) => !x.done).length })
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

  // Screens and the Tailwind source need a CSS build; page.css and fonts.css need only a reload.
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
    if (cfg.css) {
      const cssDir = dirname(join(root, cfg.css))
      add(cssDir, { recursive: true }, (_e, f) => {
        if (!f || !String(f).endsWith('.css')) return
        const full = join(cssDir, String(f))
        if (full.startsWith(base + sep) || full.split(sep).includes('node_modules')) return
        later(true)
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
