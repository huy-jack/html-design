import { execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCssInChild } from '../plugin/scripts/build-css.mjs'
import { openBrowser } from '../plugin/scripts/browser.mjs'
import { readConfig, writeConfig } from '../plugin/scripts/config.mjs'
import { readNotes, writeNotes } from '../plugin/scripts/notes.mjs'
import { serializeScreen } from '../plugin/scripts/screen-file.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'
import { copyWindow, createViewServer, homePage, stateFromText, validNote } from '../plugin/scripts/view.mjs'
import { startFixture } from './fixture/server.mjs'
import { compareInPage, MATCH_PIXEL_RATIO } from './helpers/pixels.mjs'

const NM = join(import.meta.dirname, '..', 'node_modules')
function project(extra = {}) {
  const r = mkdtempSync(join(tmpdir(), 'vw-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n@theme { --color-brand: #123456; }\n')
  writeConfig(r, { css: 'app.css', themeVars: ['--color-brand'], ...extra })
  makeSkeleton(r, readConfig(r))
  return { r, cfg: readConfig(r) }
}
// Tailwind for the CSS build, never playwright: playwright comes from the data folder only.
function linkTailwind(r) {
  mkdirSync(join(r, 'node_modules/@tailwindcss'), { recursive: true })
  for (const p of ['tailwindcss', 'postcss', '@tailwindcss/postcss']) symlinkSync(join(NM, p), join(r, 'node_modules', p))
}
function dataDir() {
  const d = mkdtempSync(join(tmpdir(), 'data-'))
  mkdirSync(join(d, 'node_modules'))
  symlinkSync(join(NM, 'playwright'), join(d, 'node_modules', 'playwright'))
  return d
}
const screen = (states) => serializeScreen({ screen: 'x', states: states.map((id) => ({ id, attrs: {}, html: `<p>${id}</p>` })) })
const post = (port, p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const stubBrowser = (pages, copy = async () => ({ status: 201, saved: 'x', images: 0, warnings: [] })) => {
  const calls = []
  return { calls, pages, appPages: () => pages, copyFrom: async (p, b) => { calls.push({ p, b }); return copy(p, b) },
    resize: async (w, o) => calls.push(o?.front ? { resize: w, front: o.front } : { resize: w }), toast: async (p, text) => calls.push({ toast: text, p }) }
}
const page = (title) => ({ title: async () => title })
const note = { screen: 'x', state: 'a', width: 1440, theme: 'light', path: [1], text: 'a', tag: 'p', note: 'bigger' }

let cleanup = []
afterEach(async () => { for (const f of cleanup.reverse()) await f(); cleanup = [] })
async function viewer(opts) {
  const v = await createViewServer({ build: false, watch: false, dataDir: null, port: 0, ...opts })
  cleanup.push(() => v.close())
  return v
}

const raw = (port, path, { method = 'GET', host, body } = {}) => new Promise((res, rej) => {
  const r = request({ host: '127.0.0.1', port, path, method, headers: { host: host ?? `127.0.0.1:${port}`, ...(body ? { 'content-type': 'application/json' } : {}) } }, (x) => {
    let t = ''
    x.on('data', (c) => { t += c })
    x.on('end', () => res({ status: x.statusCode, text: t }))
  })
  r.on('error', rej)
  r.end(body)
})

describe('viewer hardening', () => {
  it('refuses a foreign Host header with 403 on every method (I2)', async () => {
    const { r, cfg } = project()
    const v = await viewer({ root: r, cfg })
    expect((await raw(v.port, '/', { host: 'evil.example:80' })).status).toBe(403)
    expect((await raw(v.port, '/__notes', { host: `attacker.test:${v.port}` })).status).toBe(403)
    expect((await raw(v.port, '/__notes', { method: 'POST', host: 'evil.example', body: JSON.stringify(note) })).status).toBe(403)
    expect((await raw(v.port, '/', { host: `localhost:${v.port}` })).status).toBe(200)
    expect((await raw(v.port, '/')).status).toBe(200)
  })
  it('does not follow a symlink to a file outside the design folder (I3)', async () => {
    const { r, cfg } = project()
    const outside = join(mkdtempSync(join(tmpdir(), 'out-')), 'secret.txt')
    writeFileSync(outside, 'secret')
    symlinkSync(outside, join(r, cfg.dir, 'leak.txt'))
    writeFileSync(join(r, cfg.dir, 'ok.txt'), 'fine')
    const v = await viewer({ root: r, cfg })
    const got = await raw(v.port, '/leak.txt')
    expect(got.status).toBe(404)
    expect(got.text).not.toContain('secret')
    expect((await raw(v.port, '/ok.txt')).status).toBe(200)
  })
  it('POST /__copy refuses a screen name with no letter or digit (I4)', async () => {
    const { r, cfg } = project()
    const v = await viewer({ root: r, cfg, browser: stubBrowser([page('a')]) })
    const res = await post(v.port, '/__copy', { screen: '!!!', state: 'a' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/letter or digit/)
  })
})

describe('viewer pages', () => {
  it('home page is titled Screens and lists screens', () => {
    const html = homePage([{ file: 'a.html', states: 3 }])
    expect(html).toContain('<title>Screens</title>')
    expect(html).toContain('href="/screens/a.html"')
    expect(html).toContain('3 states')
  })
  it('serves screens and refuses paths outside the design folder', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/x.html'), screen(['a']))
    writeFileSync(join(r, 'secret.txt'), 'no')
    const v = await viewer({ root: r, cfg })
    const u = `http://127.0.0.1:${v.port}`
    expect(await (await fetch(`${u}/`)).text()).toContain('>1 state<')
    expect((await fetch(`${u}/screens/x.html`)).status).toBe(200)
    expect((await fetch(`${u}/screens/none.html`)).status).toBe(404)
    expect((await fetch(`${u}/screens/..%2f..%2fsecret.txt`)).status).toBe(404)
    expect((await fetch(`${u}/screens/%E0%A4%A`)).status).toBe(400)
  })
  it('Copy window lists screens and the configured widths', async () => {
    const html = copyWindow({ screens: ['fixture'], widths: [1440, 375] })
    expect(html).toContain('data-value="fixture"')
    expect(html).toContain('id="screen" class="field" role="combobox"')
    expect(html).toContain('data-width="375"')
    expect(html).toContain('Copy in 5 s')
    const { r, cfg } = project({ widths: [1440, 800] })
    writeFileSync(join(r, 'design/screens/x.html'), screen(['a']))
    const v = await viewer({ root: r, cfg })
    const res = await fetch(`http://127.0.0.1:${v.port}/__copy`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('data-width="800"')
    expect(text).toContain('data-value="x"')
  })
})

describe('redesigned viewer pages', () => {
  it('home: a card per screen with a live preview of its first state, notes, update time, project and style', () => {
    const html = homePage([{ file: 'a.html', states: 3, notes: 2, mtime: 1700000000000, first: 's1', labels: ['Alpha'] }], { project: 'proj', style: 'tw4' })
    expect(html).toContain('href="/screens/a.html#s1"')
    expect(html).toContain('src="/__state/a/s1"')
    expect(html).toContain('3 states')
    expect(html).toContain('2 notes')
    expect(html).toContain('data-mtime="1700000000000"')
    expect(html).toContain('proj')
    expect(html).toContain('Tailwind 4')
    expect(html).toContain('data-search="a alpha"')
  })
  it('home: an empty folder says how to copy the first screen', () => {
    expect(homePage([], { project: 'p', style: 'css' })).toContain('No screens yet')
  })
  it('GET /__state/<screen>/<state> serves that one state as a page, without the rest of the file', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/x.html'), screen(['a', 'b']))
    const v = await viewer({ root: r, cfg })
    const res = await fetch(`http://127.0.0.1:${v.port}/__state/x/b`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('<p>b</p>')
    expect(text).not.toContain('<p>a</p>')
    expect(text).toContain('../dist/design.css')
    expect(text).toContain('<base href="/screens/">')
    expect((await fetch(`http://127.0.0.1:${v.port}/__state/x/zz`)).status).toBe(404)
    expect((await fetch(`http://127.0.0.1:${v.port}/__state/..%2fsecret/a`)).status).toBe(404)
  })
  it('GET /__tabs lists the open app tabs; none without a browser', async () => {
    const { r, cfg } = project()
    expect(await (await fetch(`http://127.0.0.1:${(await viewer({ root: r, cfg })).port}/__tabs`)).json()).toEqual([])
    const p = { title: async () => 'Home', url: () => 'http://localhost:3000/home', evaluate: async () => 1024 }
    const v = await viewer({ root: r, cfg, browser: stubBrowser([p]) })
    expect(await (await fetch(`http://127.0.0.1:${v.port}/__tabs`)).json()).toEqual([{ id: 't-1', title: 'Home', url: 'http://localhost:3000/home', width: 1024 }])
  })
  it('GET /__recent lists the last copies, newest first', async () => {
    const { r, cfg } = project()
    const b = stubBrowser([page('Home')], async (_p, x) => ({ status: 201, saved: 'x', images: 0, warnings: [], width: x.state === 'a' ? 1440 : 375 }))
    const v = await viewer({ root: r, cfg, browser: b })
    await post(v.port, '/__copy', { screen: 'Home Page', state: 'a' })
    await post(v.port, '/__copy', { screen: 'Home Page', state: 'b' })
    const got = await (await fetch(`http://127.0.0.1:${v.port}/__recent`)).json()
    expect(got.map((x) => [x.screen, x.state, x.width])).toEqual([['home-page', 'b', 375], ['home-page', 'a', 1440]])
    expect(typeof got[0].at).toBe('number')
  })
  it('stateFromText cuts one state out by id, with attribute values that hold ">" and quotes', () => {
    const t = '<template id="a" data-note="a &gt; b" data-body-class="[&amp;>svg]:size-4"><p>a</p></template><template id="a@375" data-variant-of="a" data-widths="375"><p>small</p></template><template\n  id="b"\n>\n<p>b</p>\n</template>'
    expect(stateFromText(t, 'a')).toEqual({ id: 'a', attrs: { id: 'a', 'data-note': 'a > b', 'data-body-class': '[&>svg]:size-4' }, html: '<p>a</p>', variants: [] })
    expect(stateFromText(t, 'b').html).toBe('<p>b</p>')
    expect(stateFromText(t, 'a@375')).toBeNull()
  })
  it('GET /__notes?screen= adds the open notes per state (width copies count for their state)', async () => {
    const { r, cfg } = project()
    const v = await viewer({ root: r, cfg })
    for (const st of ['a', 'a@375', 'b']) await post(v.port, '/__notes', { ...note, state: st })
    await post(v.port, '/__notes', { ...note, screen: 'other', state: 'a' })
    expect(await (await fetch(`http://127.0.0.1:${v.port}/__notes?screen=x`)).json()).toEqual({ open: 4, byState: { a: 2, b: 1 } })
    expect(await (await fetch(`http://127.0.0.1:${v.port}/__notes`)).json()).toEqual({ open: 4 })
  })
  it('Copy window: the app tab card, Copy state with its shortcut, Copy at 3 widths, Recent', () => {
    const html = copyWindow({ screens: ['fixture'], widths: [1440, 1024, 375] })
    for (const t of ['id="tab"', 'Copy state', 'Copy at 3 widths', 'Recent', '/__tabs', '/__recent']) expect(html).toContain(t)
  })
})

describe('Copy window in a browser', () => {
  it('Copy window: one line for open menus under Copy state, and Copy at 3 widths says it resizes the window', () => {
    const html = copyWindow({ screens: ['fixture'], widths: [1440, 1024, 375] })
    expect(html).toContain('Menu open in your app? Press Ctrl+Shift+S there, or use Copy in 5 s.')
    expect(html).toContain('Resizes your app window, so open menus close.')
  })
  it('Copy in 5 s asks Replace? in the Copy tab first, then hands the wait to the server, with no tab', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/home-page.html'), screen(['a']))
    const tab = (t) => ({ title: async () => t, url: () => `http://localhost:3000/${t}`, evaluate: async () => 1440 })
    const v = await viewer({ root: r, cfg, browser: stubBrowser([tab('one'), tab('two')]) })
    const { chromium } = await import('playwright')
    const br = await chromium.launch({ headless: true }); cleanup.push(() => br.close())
    const pg = await br.newPage()
    const sent = []
    await pg.route('**/__copy', (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      sent.push(route.request().postDataJSON())
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{"saved":"x","images":0,"warnings":[]}' })
    })
    await pg.goto(`${v.url}/__copy`)
    await pg.waitForFunction(() => !document.getElementById('tabPick').hidden)
    await pg.fill('#name', 'a')
    await pg.click('#copyLater')
    await pg.locator('#ask').waitFor({ state: 'visible' })
    expect(await pg.locator('#askText').innerText()).toBe('"a" already exists in home-page. Replace it?')
    await pg.click('#askReplace')
    await pg.waitForFunction(() => /^Saved "a"/.test(document.getElementById('msg').textContent))
    expect(sent).toEqual([{ screen: 'home-page', state: 'a', label: 'a', delay: 5, replace: true }])
    await pg.fill('#name', 'b')
    await pg.click('#copyLater')
    await pg.waitForFunction(() => /^Saved "b"/.test(document.getElementById('msg').textContent))
    expect(sent[1]).toEqual({ screen: 'home-page', state: 'b', label: 'b', delay: 5 })
  }, 30000)
  it('Copy at 3 widths: Replace? first, each resize brings the app tab to the front, the result shows in the app tab', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/home-page.html'), screen(['a']))
    const tab = (t) => ({ title: async () => t, url: () => `http://localhost:3000/${t}`, evaluate: async () => 1440 })
    const v = await viewer({ root: r, cfg, browser: stubBrowser([tab('one'), tab('two')]) })
    const { chromium } = await import('playwright')
    const br = await chromium.launch({ headless: true }); cleanup.push(() => br.close())
    const pg = await br.newPage()
    const sent = []
    let failAt = null
    for (const p of ['__copy', '__resize', '__toast']) {
      await pg.route('**/' + p, (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        const body = route.request().postDataJSON()
        sent.push({ p, ...body })
        if (p === '__copy' && body.state === failAt && sent.filter((x) => x.p === '__copy').length === 2) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Copy failed: boom"}' })
        return route.fulfill({ status: p === '__copy' ? 201 : 200, contentType: 'application/json', body: '{"saved":"x","images":0,"warnings":[]}' })
      })
    }
    await pg.goto(`${v.url}/__copy`)
    await pg.waitForFunction(() => !document.getElementById('tabPick').hidden)
    await pg.selectOption('#tabPick', { index: 1 })
    await pg.fill('#name', 'a')
    await pg.click('#copy3')
    await pg.locator('#ask').waitFor({ state: 'visible' })
    await pg.click('#askReplace')
    await pg.waitForFunction(() => /^Saved "a" at/.test(document.getElementById('msg').textContent) && !document.getElementById('copy3').disabled)
    const tabId = sent.find((x) => x.p === '__resize').tab
    expect(tabId).toMatch(/^t-\d+$/)
    expect(sent.map((x) => x.p + (x.width ?? ''))).toEqual(['__resize1440', '__copy', '__resize1024', '__copy', '__resize375', '__copy', '__resize1440', '__toast'])
    for (const x of sent.filter((x) => x.p === '__resize')) expect(x).toMatchObject({ front: true, tab: tabId })
    for (const x of sent.filter((x) => x.p === '__copy')) expect(x).toMatchObject({ replace: true, tab: tabId })
    expect(sent.at(-1)).toEqual({ p: '__toast', text: 'Saved "a" at 1440, 1024, 375', tab: tabId })
    // A failure stops the run and shows there too.
    sent.length = 0; failAt = 'b'
    await pg.fill('#name', 'b')
    await pg.click('#copy3')
    await pg.waitForFunction(() => /boom/.test(document.getElementById('msg').textContent))
    await pg.waitForFunction(() => !document.getElementById('copy3').disabled)
    expect(sent.at(-1)).toEqual({ p: '__toast', text: 'Not saved at 1024: Copy failed: boom', tab: tabId })
  }, 30000)
})

describe('POST guards and copy', () => {
  it('rejects foreign Origin and non-JSON on every POST (S6)', async () => {
    const { r, cfg } = project()
    const v = await viewer({ root: r, cfg })
    for (const p of ['/__notes', '/__copy', '/__resize', '/__toast', '/__focus', '/__cancel', '/__notes/edit', '/__notes/delete']) {
      expect((await fetch(`http://127.0.0.1:${v.port}${p}`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403)
      expect((await fetch(`http://127.0.0.1:${v.port}${p}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status).toBe(415)
    }
  })
  it('POST /__copy without a browser page → 503', async () => {
    const { r, cfg } = project()
    const none = await viewer({ root: r, cfg })
    expect((await post(none.port, '/__copy', { screen: 'x', state: 'a' })).status).toBe(503)
    const empty = await viewer({ root: r, cfg, browser: stubBrowser([]) })
    expect((await post(empty.port, '/__copy', { screen: 'x', state: 'a' })).status).toBe(503)
  })
  it('POST /__copy with 2 app pages and no tab → 409 {tabs}', async () => {
    const { r, cfg } = project()
    const b = stubBrowser([page('Home'), page('Settings')])
    const v = await viewer({ root: r, cfg, browser: b })
    const res = await post(v.port, '/__copy', { screen: 'x', state: 'a' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.tabs).toEqual([{ id: 't-1', title: 'Home' }, { id: 't-2', title: 'Settings' }])
    expect(b.calls).toHaveLength(0)
    const ok = await post(v.port, '/__copy', { screen: 'x', state: 'a', tab: 't-2', label: 'A' })
    expect(ok.status).toBe(201)
    expect(await ok.json()).toEqual({ saved: 'x', images: 0, warnings: [] })
    expect(b.calls[0].b).toEqual({ screen: 'x', state: 'a', label: 'A', replace: false })
    expect(await b.calls[0].p.title()).toBe('Settings')
    // The ids stay with their pages after the first tab closes; a number index still works.
    b.pages.shift(); b.pages.push(page('Third'))
    expect((await (await post(v.port, '/__copy', { screen: 'x', state: 'a' })).json()).tabs).toEqual([{ id: 't-2', title: 'Settings' }, { id: 't-3', title: 'Third' }])
    expect((await post(v.port, '/__copy', { screen: 'x', state: 'a', tab: 't-1' })).status).toBe(400)
    expect((await post(v.port, '/__copy', { screen: 'x', state: 'a', tab: 0 })).status).toBe(201)
    expect(await b.calls[1].p.title()).toBe('Settings')
    expect((await post(v.port, '/__copy', { screen: 'x', state: 'a', tab: 5 })).status).toBe(400)
    expect((await post(v.port, '/__copy', { screen: 'x', state: 'a', tab: 'bad' })).status).toBe(400)
  })
  it('POST /__copy: one page is the target; same state → 409 {exists}; bad body → 400', async () => {
    const { r, cfg } = project()
    const b = stubBrowser([page('Home')], async () => ({ status: 409, kind: 'exists' }))
    const v = await viewer({ root: r, cfg, browser: b })
    const res = await post(v.port, '/__copy', { screen: 'x', state: 'a' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ exists: true })
    expect((await post(v.port, '/__copy', { screen: '', state: 'a' })).status).toBe(400)
    expect((await post(v.port, '/__copy', { screen: 'x', state: 'a b' })).status).toBe(400)
  })
  it('POST /__copy delay: whole seconds 1 to 10, else 400; then the only tab, or 409 when no tab is in view', async () => {
    const { r, cfg } = project()
    const b = stubBrowser([page('Home')])
    const v = await viewer({ root: r, cfg, browser: b })
    for (const delay of [0, 11, 1.5, '3', -1]) expect((await post(v.port, '/__copy', { screen: 'x', state: 'a', delay })).status).toBe(400)
    expect(b.calls).toHaveLength(0)
    const t0 = Date.now()
    expect((await post(v.port, '/__copy', { screen: 'x', state: 'a', delay: 1 })).status).toBe(201)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(950)
    b.pages.push(page('Settings'))
    const res = await post(v.port, '/__copy', { screen: 'x', state: 'a', delay: 1 })
    expect(res.status).toBe(409)
    expect((await res.json()).tabs).toHaveLength(2)
  })
  it('POST /__preset hands the Copy window names to onPreset', async () => {
    const { r, cfg } = project()
    let got = null
    const v = await viewer({ root: r, cfg, onPreset: (p) => { got = p } })
    expect((await post(v.port, '/__preset', { screen: 'home', state: 'menu', label: 'Menu' })).status).toBe(200)
    expect(got).toEqual({ screen: 'home', state: 'menu', label: 'Menu' })
    expect((await post(v.port, '/__preset', { screen: '', state: 'a' })).status).toBe(400)
    // The Copy tab cleared its name: the chord has nothing to save until a new name is typed.
    expect((await post(v.port, '/__preset', { clear: true })).status).toBe(200)
    expect(got).toBeNull()
  })
  it('POST /__resize sets the app width to a configured width', async () => {
    const { r, cfg } = project()
    const b = stubBrowser([page('Home')])
    const v = await viewer({ root: r, cfg, browser: b })
    expect((await post(v.port, '/__resize', { width: 1024 })).status).toBe(200)
    expect(b.calls).toEqual([{ resize: 1024 }])
    expect((await post(v.port, '/__resize', { width: 999 })).status).toBe(400)
  })
  it('POST /__resize front: true brings the named app tab (else the only one) to the front; front must be a boolean', async () => {
    const { r, cfg } = project()
    const b = stubBrowser([page('Home'), page('Settings')])
    const v = await viewer({ root: r, cfg, browser: b })
    expect((await post(v.port, '/__resize', { width: 1024, front: 'yes' })).status).toBe(400)
    expect((await post(v.port, '/__resize', { width: 1024, front: true, tab: 'bad' })).status).toBe(400)
    expect((await post(v.port, '/__resize', { width: 1024, front: true, tab: 't-9' })).status).toBe(400)
    expect(b.calls).toHaveLength(0)
    expect((await post(v.port, '/__resize', { width: 1024, front: true, tab: 't-2' })).status).toBe(200)
    expect(await b.calls[0].front.title()).toBe('Settings')
    b.pages.shift()
    expect((await post(v.port, '/__resize', { width: 375, front: true })).status).toBe(200)
    expect(await b.calls[1].front.title()).toBe('Settings')
    expect((await post(v.port, '/__resize', { width: 1440, front: false })).status).toBe(200)
    expect(b.calls[2]).toEqual({ resize: 1440 })
  })
  it('POST /__toast shows a short text in the named app tab, else in every app tab', async () => {
    const { r, cfg } = project()
    const b = stubBrowser([page('Home'), page('Settings')])
    const v = await viewer({ root: r, cfg, browser: b })
    for (const text of ['', 'x'.repeat(201), 3]) expect((await post(v.port, '/__toast', { text })).status).toBe(400)
    expect((await post(v.port, '/__toast', { text: 'Saved a', tab: 't-2' })).status).toBe(200)
    expect(b.calls).toHaveLength(1)
    expect(b.calls[0].toast).toBe('Saved a'); expect(await b.calls[0].p.title()).toBe('Settings')
    expect((await post(v.port, '/__toast', { text: 'Saved b' })).status).toBe(200)
    expect(b.calls.slice(1).map((c) => c.toast)).toEqual(['Saved b', 'Saved b'])
  })
})

describe('guided pages: server', () => {
  it('POST /__copy with no app tab names the fix; with no session browser it says how to start one', async () => {
    const { r, cfg } = project()
    const none = await viewer({ root: r, cfg })
    expect((await (await post(none.port, '/__copy', { screen: 'x', state: 'a' })).json()).error).toBe('The session is not running. In Claude Code, type /html-design start.')
    const empty = await viewer({ root: r, cfg, browser: stubBrowser([]) })
    expect((await (await post(empty.port, '/__copy', { screen: 'x', state: 'a' })).json()).error).toBe("Your app is not open yet. Open a new tab in this browser window (Ctrl+T or Cmd+T) and go to your app's address.")
  })
  it('GET /__status: whether a session browser is open, the app tabs, screens and open notes', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/x.html'), screen(['a']))
    const alone = await viewer({ root: r, cfg })
    expect(await (await fetch(`http://127.0.0.1:${alone.port}/__status`)).json()).toEqual({ browser: false, tabs: 0, screens: 1, notes: 0, notesEver: 0 })
    const v = await viewer({ root: r, cfg, browser: stubBrowser([page('Home')]) })
    await post(v.port, '/__notes', note)
    expect(await (await fetch(`http://127.0.0.1:${v.port}/__status`)).json()).toEqual({ browser: true, tabs: 1, screens: 1, notes: 1, notesEver: 1 })
    // notesEver counts done notes too: step 2 on home stays ticked after Claude did the notes.
    writeNotes(r, cfg, readNotes(r, cfg).map((n) => ({ ...n, done: true })))
    expect(await (await fetch(`http://127.0.0.1:${v.port}/__status`)).json()).toMatchObject({ notes: 0, notesEver: 1 })
  })
  it('POST /__focus brings the open Copy tab or viewer tab to the front; 503 without a session browser; 400 for another path', async () => {
    const { r, cfg } = project()
    const alone = await viewer({ root: r, cfg })
    expect((await post(alone.port, '/__focus', { path: '/__copy' })).status).toBe(503)
    const b = stubBrowser([])
    b.focus = async (p) => { b.calls.push({ focus: p }); return true }
    const v = await viewer({ root: r, cfg, browser: b })
    for (const path of ['/__copy', '/', '/screens/home-page.html#menu-open@1024']) expect((await post(v.port, '/__focus', { path })).status).toBe(200)
    expect(b.calls).toEqual([{ focus: '/__copy' }, { focus: '/' }, { focus: '/screens/home-page.html#menu-open@1024' }])
    for (const path of ['https://evil.example/', '//evil.example', '/../x', '/screens/../../x.html', 3, '/__notes']) expect((await post(v.port, '/__focus', { path })).status).toBe(400)
    expect(b.calls).toHaveLength(3)
  })
  it('POST /__cancel stops a Copy in 5 s during its wait: no copy, the badge goes, 409 {cancelled}', async () => {
    const { r, cfg } = project()
    const b = stubBrowser([page('Home')])
    const badges = []
    b.badge = async (_p, text) => badges.push(text)
    const v = await viewer({ root: r, cfg, browser: b })
    const t0 = Date.now()
    const res = post(v.port, '/__copy', { screen: 'x', state: 'a', delay: 5 })
    await new Promise((ok) => setTimeout(ok, 600))
    expect(await (await post(v.port, '/__cancel', {})).json()).toEqual({ cancelled: 1 })
    const got = await res
    expect(got.status).toBe(409)
    expect(await got.json()).toMatchObject({ cancelled: true })
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(b.calls).toHaveLength(0)
    expect(badges.at(-1)).toBeNull()
    expect(await (await post(v.port, '/__cancel', {})).json()).toEqual({ cancelled: 0 })
  })
  it('the reload stream sends a change event before the reload, so pages can show it at once', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/x.html'), screen(['a']))
    const v = await viewer({ root: r, cfg, watch: true })
    const ctl = new AbortController()
    cleanup.push(() => ctl.abort())
    const reader = (await fetch(`http://127.0.0.1:${v.port}/__reload`, { signal: ctl.signal })).body.getReader()
    await new Promise((ok) => setTimeout(ok, 200))
    writeFileSync(join(r, 'design/screens/x.html'), screen(['a', 'b']))
    let text = ''
    while (!text.includes('data: reload')) text += new TextDecoder().decode((await reader.read()).value)
    expect(text.indexOf('event: change')).toBeGreaterThan(-1)
    expect(text.indexOf('event: change')).toBeLessThan(text.indexOf('data: reload'))
  })
  it('notes: list the open notes of one screen, edit the text, delete one; the file stays readable by notes.mjs', async () => {
    const { r, cfg } = project()
    const v = await viewer({ root: r, cfg })
    const ids = []
    for (const st of ['a', 'b']) ids.push((await (await post(v.port, '/__notes', { ...note, state: st, note: `on ${st}` })).json()).id)
    await post(v.port, '/__notes', { ...note, screen: 'other' })
    const list = await (await fetch(`http://127.0.0.1:${v.port}/__notes?screen=x&list=1`)).json()
    expect(list.list.map((n) => [n.id, n.state, n.text, n.tag, n.note])).toEqual([[ids[0], 'a', 'a', 'p', 'on a'], [ids[1], 'b', 'a', 'p', 'on b']])
    expect((await post(v.port, '/__notes/edit', { id: ids[0], note: '  smaller  ' })).status).toBe(200)
    expect((await post(v.port, '/__notes/delete', { id: ids[1] })).status).toBe(200)
    expect(readNotes(r, cfg).filter((n) => n.screen === 'x').map((n) => [n.id, n.note, n.done])).toEqual([[ids[0], 'smaller', false]])
    for (const [p, body] of [['/__notes/edit', { id: ids[0], note: '' }], ['/__notes/edit', { id: ids[0], note: 'x'.repeat(2001) }], ['/__notes/edit', { id: 3, note: 'x' }], ['/__notes/delete', {}]]) expect((await post(v.port, p, body)).status).toBe(400)
    expect((await post(v.port, '/__notes/edit', { id: 'n-1-999', note: 'x' })).status).toBe(404)
    expect((await post(v.port, '/__notes/delete', { id: 'n-1-999' })).status).toBe(404)
  })
})

describe('notes', () => {
  it('notes live in .local/notes.json', async () => {
    const { r, cfg } = project()
    const v = await viewer({ root: r, cfg })
    const res = await post(v.port, '/__notes', note, { origin: `http://127.0.0.1:${v.port}` })
    expect(res.status).toBe(201)
    expect(existsSync(join(r, 'design/.local/notes.json'))).toBe(true)
    expect(readNotes(r, cfg)).toHaveLength(1)
    expect(readNotes(r, cfg)[0]).toMatchObject({ ...note, done: false })
    expect(await (await fetch(`http://127.0.0.1:${v.port}/__notes`)).json()).toEqual({ open: 1 })
    expect((await post(v.port, '/__notes', { ...note, path: [] })).status).toBe(400)
  })
  it('validates the width against the config', () => {
    expect(validNote(note, [1440])).toBeNull()
    expect(validNote({ ...note, width: 800 }, [1440])).toMatch(/width/)
  })
})

describe('live reload', () => {
  it('reload under 1 s after a screen save (S3)', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/x.html'), screen(['a']))
    const v = await viewer({ root: r, cfg, watch: true })
    const ctl = new AbortController()
    cleanup.push(() => ctl.abort())
    const res = await fetch(`http://127.0.0.1:${v.port}/__reload`, { signal: ctl.signal })
    const reader = res.body.getReader()
    await new Promise((ok) => setTimeout(ok, 200))
    const t0 = Date.now()
    writeFileSync(join(r, 'design/screens/x.html'), screen(['a', 'b']))
    let text = ''
    while (!text.includes('data: reload')) text += new TextDecoder().decode((await reader.read()).value)
    expect(Date.now() - t0).toBeLessThan(1000)
  })
  it('a failed build keeps the last CSS and sends buildError', async () => {
    const { r, cfg } = project()
    linkTailwind(r)
    writeFileSync(join(r, 'design/screens/x.html'), serializeScreen({ screen: 'x', states: [{ id: 'a', attrs: {}, html: '<p class="text-brand">a</p>' }] }))
    const v = await viewer({ root: r, cfg, watch: true, build: true })
    const ctl = new AbortController()
    cleanup.push(() => ctl.abort())
    const reader = (await fetch(`http://127.0.0.1:${v.port}/__reload`, { signal: ctl.signal })).body.getReader()
    const good = readFileSync(join(r, 'design/dist/design.css'), 'utf8')
    expect(good).toContain('#123456')
    writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n.x { @apply no-such-class; }\n')
    let text = ''
    while (!text.includes('event: buildError')) text += new TextDecoder().decode((await reader.read()).value)
    expect(readFileSync(join(r, 'design/dist/design.css'), 'utf8')).toBe(good)
  }, 30000)
})

describe('build error bar in the viewer (browser)', () => {
  it('shows the red bar with the error text, and it is gone after a good build and a reload', async () => {
    const { r, cfg } = project()
    linkTailwind(r)
    writeFileSync(join(r, 'design/screens/x.html'), serializeScreen({ screen: 'x', states: [{ id: 'a', attrs: {}, html: '<p class="text-brand">a</p>' }] }))
    const v = await viewer({ root: r, cfg, watch: true, build: true })
    const { chromium } = await import('playwright')
    const br = await chromium.launch({ headless: true }); cleanup.push(() => br.close())
    const pg = await br.newPage()
    await pg.goto(`http://127.0.0.1:${v.port}/screens/x.html#a`)
    await pg.locator('iframe.sd-frame').waitFor()
    const bar = pg.locator('[data-sd="build-error"]')
    expect(await bar.count()).toBe(0)
    writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n.x { @apply no-such-class; }\n')
    await bar.waitFor({ state: 'visible', timeout: 20000 })
    expect(await bar.textContent()).toMatch(/CSS build failed: .*no-such-class/)
    writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n@theme { --color-brand: #123456; }\n')
    // The good build sends a reload; reload again by hand so the check does not depend on its timing.
    await pg.waitForEvent('load', { timeout: 20000 }).catch(() => {})
    await pg.reload()
    await pg.locator('iframe.sd-frame').waitFor()
    await pg.waitForTimeout(500)
    expect(await bar.count()).toBe(0)
  }, 60000)
})

describe('switching to the open tools tab (real browser)', () => {
  it('focus finds the open Copy tab or viewer tab by its path, moves a viewer tab to the asked state, and opens a tab only when none is open', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/x.html'), screen(['a', 'b']))
    const v0 = await viewer({ root: r, cfg })
    const b = await openBrowser({ root: r, cfg, dataDir: dataDir(), profileDir: mkdtempSync(join(tmpdir(), 'prof-')), headless: true, viewerOrigin: v0.url }); cleanup.push(() => b.close())
    const own = () => b.context.pages().filter((p) => p.url().startsWith(v0.url)).map((p) => p.url().slice(v0.url.length))
    const home = await b.context.newPage(); await home.goto(v0.url + '/')
    expect(await b.focus('/__copy')).toBe(true)
    expect(own().sort()).toEqual(['/', '/__copy'])
    expect(await b.focus('/__copy')).toBe(true)
    expect(own()).toHaveLength(2)
    expect(await b.focus('/screens/x.html#b@1024')).toBe(true)
    expect(own().sort()).toEqual(['/__copy', '/screens/x.html#b@1024'])
    expect(await b.focus('/screens/x.html#a@1440')).toBe(true)
    expect(own().sort()).toEqual(['/__copy', '/screens/x.html#a@1440'])
  }, 60000)
})

describe('copy through the real browser', () => {
  it('a user copy keeps the hover menu open; a target: copy still moves the pointer away', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const { r, cfg } = project({ url: fx.a + '/login' })
    const b = await openBrowser({ root: r, cfg, dataDir: dataDir(), profileDir: mkdtempSync(join(tmpdir(), 'prof-')), headless: true }); cleanup.push(() => b.close())
    const v = await viewer({ root: r, cfg, browser: b })
    const app = b.appPages()[0]
    await app.goto(fx.a + '/login'); await app.goto(fx.a + '/menus')
    await app.hover('#hover-target')
    expect((await post(v.port, '/__copy', { screen: 'Menus', state: 'user' })).status).toBe(201)
    const cdp = await b.context.newCDPSession(app)
    const { targetInfo } = await cdp.send('Target.getTargetInfo')
    await cdp.detach()
    await app.hover('#open-click'); await app.hover('#hover-target')
    expect((await post(v.port, '/__copy', { screen: 'Menus', state: 'scripted', tab: `target:${targetInfo.targetId}` })).status).toBe(201)
    const text = readFileSync(join(r, 'design/screens/menus.html'), 'utf8')
    expect(stateFromText(text, 'user').html).toContain('id="hover-menu"')
    expect(stateFromText(text, 'scripted').html).not.toContain('id="hover-menu"')
  }, 60000)

  it('a fixed layer placed from the bottom-right lands where it was in a taller frame; a translate-placed popper stays', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const { r, cfg } = project({ url: fx.a + '/login' })
    const b = await openBrowser({ root: r, cfg, dataDir: dataDir(), profileDir: mkdtempSync(join(tmpdir(), 'prof-')), headless: true }); cleanup.push(() => b.close())
    const v = await viewer({ root: r, cfg, browser: b })
    const app = b.appPages()[0]
    await app.setViewportSize({ width: 1440, height: 900 })
    await app.goto(fx.a + '/login'); await app.goto(fx.a + '/floating')
    const box = (p, sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height } }, sel)
    const live = { menu: await box(app, '#fixed-menu'), pop: await box(app, '#popper') }
    expect((await post(v.port, '/__copy', { screen: 'Floating', state: 'open' })).status).toBe(201)
    const view = await b.context.newPage()
    await view.setViewportSize({ width: 1440, height: 1600 })
    await view.goto(`http://127.0.0.1:${v.port}/__state/floating/open`)
    for (const [k, sel] of [['menu', '#fixed-menu'], ['pop', '#popper']]) {
      const got = await box(view, sel)
      expect(Math.abs(got.top - live[k].top)).toBeLessThanOrEqual(1)
      expect(Math.abs(got.left - live[k].left)).toBeLessThanOrEqual(1)
      expect(Math.abs(got.height - live[k].height)).toBeLessThanOrEqual(1)
    }
  }, 60000)

  it('a fixed layer in the right half keeps its distance to the right edge when a 1470 window is stored at 1440', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const { r, cfg } = project({ url: fx.a + '/login' })
    const b = await openBrowser({ root: r, cfg, dataDir: dataDir(), profileDir: mkdtempSync(join(tmpdir(), 'prof-')), headless: true }); cleanup.push(() => b.close())
    const v = await viewer({ root: r, cfg, browser: b })
    const app = b.appPages()[0]
    await app.setViewportSize({ width: 1470, height: 900 })
    await app.goto(fx.a + '/login'); await app.goto(fx.a + '/floating-left')
    expect((await post(v.port, '/__copy', { screen: 'Floating', state: 'left' })).status).toBe(201)
    const view = await b.context.newPage()
    await view.setViewportSize({ width: 1440, height: 900 })
    await view.goto(`http://127.0.0.1:${v.port}/__state/floating/left`)
    const got = await view.evaluate(() => { const r = document.getElementById('left-menu').getBoundingClientRect(); return { gap: innerWidth - r.right, width: r.width, top: r.top } })
    expect(Math.abs(got.gap - 40)).toBeLessThanOrEqual(1)
    expect(got.width).toBe(200)
    expect(got.top).toBe(100)
  }, 60000)

  it('POST /__copy with delay waits, counts down in the app tabs, then copies the tab in view', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const { r, cfg } = project({ url: fx.a + '/login' })
    const b = await openBrowser({ root: r, cfg, dataDir: dataDir(), profileDir: mkdtempSync(join(tmpdir(), 'prof-')), headless: true }); cleanup.push(() => b.close())
    const v = await viewer({ root: r, cfg, browser: b })
    const back = b.appPages()[0]; await back.goto(fx.a + '/login'); await back.goto(fx.a + '/menus')
    const front = await b.context.newPage(); await front.goto(fx.a + '/menus')
    await front.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>front-marker</p>'))
    // Headless reports every tab as visible and focused: make the back tab report what a background tab does.
    await back.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' }); document.hasFocus = () => false })
    const badge = (p) => p.evaluate(() => document.querySelector('[data-hd-tool][data-hd-badge]')?.textContent ?? null)
    const t0 = Date.now()
    const res = post(v.port, '/__copy', { screen: 'Menus', state: 'later', delay: 2 })
    await new Promise((ok) => setTimeout(ok, 700))
    expect(await badge(front)).toMatch(/^Copy in [12]$/)
    expect(await front.evaluate(() => getComputedStyle(document.querySelector('[data-hd-badge]')).pointerEvents)).toBe('none')
    // Open the menu during the countdown, the way a user does.
    await front.click('#open-click')
    expect((await res).status).toBe(201)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1900)
    const html = stateFromText(readFileSync(join(r, 'design/screens/menus.html'), 'utf8'), 'later').html
    expect(html).toContain('front-marker')
    expect(html).toContain('id="click-menu"')
    expect(html).not.toContain('Copy in')
    expect(await badge(front)).toBeNull()
    expect(await badge(back)).toBeNull()
  }, 60000)

  it('POST /__copy with delay copies the app tab the user last used, among 2 tabs that both report visible and focused', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const { r, cfg } = project({ url: fx.a + '/login' })
    const b = await openBrowser({ root: r, cfg, dataDir: dataDir(), profileDir: mkdtempSync(join(tmpdir(), 'prof-')), headless: true }); cleanup.push(() => b.close())
    const v = await viewer({ root: r, cfg, browser: b })
    const first = b.appPages()[0]; await first.goto(fx.a + '/login'); await first.goto(fx.a + '/menus')
    const second = await b.context.newPage(); await second.goto(fx.a + '/menus')
    await second.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>second-marker</p>'))
    // Input in the first tab before the wait does not count.
    await first.hover('#open-click')
    const res = post(v.port, '/__copy', { screen: 'Menus', state: 'later', delay: 2 })
    await new Promise((ok) => setTimeout(ok, 700))
    await second.click('#open-click')
    expect((await res).status).toBe(201)
    const html = stateFromText(readFileSync(join(r, 'design/screens/menus.html'), 'utf8'), 'later').html
    expect(html).toContain('second-marker')
    expect(html).toContain('id="click-menu"')
  }, 60000)

  it('fixture copy matches the app within 0.1% pixels (S2)', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const { r, cfg } = project({ url: fx.a + '/login', widths: [1440] })
    linkTailwind(r)
    const b = await openBrowser({ root: r, cfg, dataDir: dataDir(), profileDir: mkdtempSync(join(tmpdir(), 'prof-')), headless: true }); cleanup.push(() => b.close())
    const v = await viewer({ root: r, cfg, browser: b, build: true })
    const app = b.appPages()[0]
    await app.setViewportSize({ width: 1440, height: 900 })
    await app.goto(fx.a + '/login')
    await app.click('text=Open menu')
    const res = await post(v.port, '/__copy', { screen: 'Fixture', state: 'menu-open' })
    expect(res.status).toBe(201)
    await buildCssInChild(r, null)
    const shotApp = await app.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 900 } })
    const view = await b.context.newPage()
    // Wide enough that the viewer shows the 1440 frame at 100% (it scales a frame down to fit, never up).
    await view.setViewportSize({ width: 1800, height: 1000 })
    await view.goto(`http://127.0.0.1:${v.port}/screens/fixture.html#menu-open@1440`)
    const frame = view.locator('iframe.sd-frame')
    await frame.waitFor()
    await view.waitForFunction(() => document.querySelector('iframe.sd-frame')?.contentDocument?.querySelector('#menu'))
    await view.waitForTimeout(300)
    const shotView = await frame.screenshot()
    const cmp = await compareInPage(view, shotApp, shotView)
    expect(cmp.sameSize).toBe(true)
    expect(cmp.ratio).toBeLessThanOrEqual(MATCH_PIXEL_RATIO)
  }, 60000)
})
