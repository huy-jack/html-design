// The guided home page and Copy tab in a real browser: steps, live grid, search, readiness, one name field.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readConfig, writeConfig } from '../plugin/scripts/config.mjs'
import { serializeScreen } from '../plugin/scripts/screen-file.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'
import { createViewServer, homePage } from '../plugin/scripts/view.mjs'

function project() {
  const r = mkdtempSync(join(tmpdir(), 'gp-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n')
  writeConfig(r, { css: 'app.css', themeVars: [] })
  makeSkeleton(r, readConfig(r))
  return { r, cfg: readConfig(r) }
}
const screen = (name, states) => serializeScreen({ screen: name, states: states.map(([id, label]) => ({ id, attrs: label ? { 'data-label': label } : {}, html: `<p>${id}</p>` })) })
const tab = (t) => ({ title: async () => t, url: () => `http://localhost:3000/${t}`, evaluate: async () => 1440 })
const stubBrowser = (pages) => ({ appPages: () => pages, copyFrom: async () => ({ status: 201, saved: 'x', images: 0, warnings: [] }), resize: async () => {}, badge: async () => {}, toast: async () => {} })

let br
let cleanup = []
beforeAll(async () => { const { chromium } = await import('playwright'); br = await chromium.launch({ headless: true }) })
afterAll(async () => { await br?.close() })
afterEach(async () => { for (const f of cleanup.reverse()) await f(); cleanup = [] })
async function viewer(opts) {
  const v = await createViewServer({ build: false, watch: false, dataDir: null, port: 0, ...opts })
  cleanup.push(() => v.close())
  return v
}
async function newPage(opts) {
  const ctx = await br.newContext(opts)
  cleanup.push(() => ctx.close())
  return ctx.newPage()
}
const text = (pg, sel) => pg.locator(sel).innerText()

describe('home page text', () => {
  it('the tab title is Screens; 1 state and 2 states; the style is a tooltip on the live pill', () => {
    const html = homePage([{ file: 'a.html', states: 1, first: 's1', list: [{ id: 's1', label: 'One' }] }, { file: 'b.html', states: 2, first: 't1', list: [] }], { project: 'p', style: 'tw4' })
    expect(html).toContain('<title>Screens</title>')
    expect(html).toContain('>1 state<')
    expect(html).toContain('>2 states<')
    expect(html).toMatch(/title="Style: Tailwind 4"/)
    expect(html).toContain('A screen holds several states: the same page with a menu open, empty, loading.')
  })
  it('first run: 3 numbered steps, one main button Open Copy tab, and what to say in Claude Code', () => {
    const html = homePage([], { project: 'p', style: 'css' })
    expect(html).toContain('No screens yet')
    expect(html).toContain('In this browser window, open your app in its own tab (for example localhost:5173).')
    expect(html).toContain('Go to the Copy tab, name what you see, press Copy state.')
    expect(html).toContain('Open the screen here, press Pick, click any part and write a note. Then in Claude Code, say: do my notes.')
    expect(html).toMatch(/<a [^>]*id="openCopy"[^>]*href="\/__copy"[^>]*>[^<]*(<svg[\s\S]*?<\/svg>)?Open Copy tab<\/a>/)
  })
  it('a broken screen file says which command fixes it', () => {
    expect(homePage([{ file: 'bad-one.html', error: 'boom' }])).toContain('This file could not be read. In Claude Code, say: check bad-one.')
  })
  it('each card carries its states for search, each a link to that state', () => {
    const html = homePage([{ file: 'a.html', states: 2, first: 's1', list: [{ id: 's1', label: 'One' }, { id: 's2', label: 'Menu open' }] }])
    expect(html).toContain('href="/screens/a.html#s2"')
    expect(html).toContain('data-q="menu open s2"')
  })
})

describe('home page in a browser', () => {
  it('a search with no result offers Clear search; a new screen appears without a reload, marked New, and the search text stays', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/one.html'), screen('one', [['a', 'Alpha']]))
    const v = await viewer({ root: r, cfg, watch: true })
    const pg = await newPage()
    await pg.goto(v.url + '/')
    await pg.fill('#q', 'zz')
    expect(await text(pg, '#none')).toContain('No screen matches "zz"')
    expect(await text(pg, '#count')).toBe('No match')
    await pg.click('#clear-search')
    expect(await pg.inputValue('#q')).toBe('')
    expect(await text(pg, '#count')).toBe('1 screen · 1 state')
    await pg.fill('#q', 'two')
    await pg.evaluate(() => { window.__same = true })
    writeFileSync(join(r, 'design/screens/two.html'), screen('two', [['b', 'Beta']]))
    await pg.waitForSelector('.card.new[data-name="two"]', { timeout: 3000 })
    expect(await pg.evaluate(() => window.__same)).toBe(true)
    expect(await pg.inputValue('#q')).toBe('two')
    expect(await pg.locator('.card[data-name="two"]').innerText()).toContain('New')
    expect(await pg.locator('#none').isHidden()).toBe(true)
    await pg.fill('#q', '')
    expect(await text(pg, '#count')).toBe('2 screens · 2 states')
  }, 30000)

  it('search lists the matching states under each card with a count; Enter opens the first match', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/one.html'), screen('one', [['a', 'Alpha'], ['m1', 'Menu open'], ['m2', 'Menu closed'], ['m3', 'Menu wide'], ['m4', 'Menu small']]))
    writeFileSync(join(r, 'design/screens/two.html'), screen('two', [['b', 'Beta']]))
    const v = await viewer({ root: r, cfg })
    const pg = await newPage()
    await pg.goto(v.url + '/')
    await pg.fill('#q', 'menu')
    expect(await text(pg, '#count')).toBe('4 states in 1 screen')
    const hits = pg.locator('.card[data-name="one"] .hits a:visible')
    expect(await hits.count()).toBe(3)
    expect(await hits.first().getAttribute('href')).toBe('/screens/one.html#m1')
    expect(await pg.locator('.card[data-name="one"] .more').innerText()).toBe('+1 more')
    expect(await pg.locator('.card[data-name="two"]').isHidden()).toBe(true)
    await pg.press('#q', 'Enter')
    await pg.waitForURL(/\/screens\/one\.html#m1$/)
  }, 30000)

  it('the steps tick as they happen, and the pill says when the session stopped', async () => {
    const { r, cfg } = project()
    const v = await viewer({ root: r, cfg, watch: true, browser: stubBrowser([tab('app')]) })
    const pg = await newPage()
    await pg.goto(v.url + '/')
    await pg.waitForFunction(() => document.querySelector('[data-step="app"]').dataset.done === 'true')
    expect(await pg.locator('[data-step="copy"]').getAttribute('data-done')).toBe('false')
    // The first copy turns the first-run steps into the grid with the short steps line.
    writeFileSync(join(r, 'design/screens/one.html'), screen('one', [['a', 'Alpha']]))
    await pg.waitForSelector('.card[data-name="one"]', { timeout: 3000 })
    await pg.waitForFunction(() => document.querySelector('[data-step="copy"]').dataset.done === 'true')
    expect(await pg.locator('[data-step="note"]').getAttribute('data-done')).toBe('false')
    expect(await text(pg, '#steps')).toContain('In Claude Code say: do my notes')
    expect(await text(pg, '#pill')).toContain('Live')
    await v.close()
    await pg.waitForFunction(() => /Session stopped/.test(document.getElementById('pill').innerText), null, { timeout: 6000 })
    expect(await text(pg, '#pill')).toBe('Session stopped. In Claude Code, type /html-design start')
  }, 30000)

  it('Open Copy tab switches to the open Copy tab in the session browser; elsewhere it is a plain link', async () => {
    const { r, cfg } = project()
    const v = await viewer({ root: r, cfg })
    const sent = []
    const inSession = await newPage()
    await inSession.addInitScript(() => { window.__hdCopy = () => {} })
    await inSession.route('**/__focus', (route) => { sent.push(route.request().postDataJSON()); route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) })
    await inSession.goto(v.url + '/')
    await inSession.click('#openCopy')
    await inSession.waitForTimeout(300)
    expect(sent).toEqual([{ path: '/__copy' }])
    expect(inSession.url()).toBe(v.url + '/')
    expect(inSession.context().pages()).toHaveLength(1)
    const plain = await newPage()
    await plain.goto(v.url + '/')
    expect(await plain.getAttribute('#openCopy', 'href')).toBe('/__copy')
  }, 30000)
})

describe('Copy tab in a browser', () => {
  async function copyTab(pages, routes = {}) {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/home-page.html'), screen('home-page', [['a', 'A']]))
    const v = await viewer({ root: r, cfg, browser: stubBrowser(pages) })
    const pg = await newPage()
    const sent = []
    for (const [p, reply] of Object.entries(routes)) {
      await pg.route('**/' + p, async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        sent.push({ p, ...route.request().postDataJSON() })
        const [status, body, wait] = typeof reply === 'function' ? await reply(route.request().postDataJSON(), sent) : reply
        if (wait) await new Promise((ok) => setTimeout(ok, wait))
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      })
    }
    await pg.goto(v.url + '/__copy')
    return { pg, sent, v }
  }

  it('the key line under Copy state names the shortcut (Control on macOS); tips sit where they apply', async () => {
    const { pg } = await copyTab([tab('app')])
    await pg.waitForFunction(() => !document.getElementById('copy').disabled)
    const mac = /Mac/.test(await pg.evaluate(() => navigator.platform))
    expect(await text(pg, '#keyhint')).toBe(mac ? 'Menu open in your app? Press Control+Shift+S (not Cmd) there, or use Copy in 5 s.' : 'Menu open in your app? Press Ctrl+Shift+S there, or use Copy in 5 s.')
    expect(await pg.locator('#copy').evaluate((b) => b.nextElementSibling.id)).toBe('why')
    expect(await text(pg, '#widthHint')).toBe('Resizes your app window.')
    expect(await text(pg, '#copy3Hint')).toBe('Resizes your app window, so open menus close.')
    expect(await pg.locator('.tips').count()).toBe(0)
    const other = await newPage()
    await other.addInitScript((m) => Object.defineProperty(navigator, 'platform', { get: () => m }), mac ? 'Linux x86_64' : 'MacIntel')
    await other.goto(pg.url())
    expect(await text(other, '#keyhint')).toBe(mac ? 'Menu open in your app? Press Ctrl+Shift+S there, or use Copy in 5 s.' : 'Menu open in your app? Press Control+Shift+S (not Cmd) there, or use Copy in 5 s.')
  }, 30000)

  it('an existing name asks in the page: Replace, Save as "<name> 2", or Cancel', async () => {
    let n = 0
    const { pg, sent } = await copyTab([tab('app')], { __copy: (body) => (body.replace || body.state !== 'a' ? [201, { saved: 'x', images: 0, warnings: [] }] : (n++, [409, { exists: true, error: 'State a already exists at this width.' }])) })
    pg.on('dialog', (d) => { throw new Error('no browser dialog: ' + d.message()) })
    await pg.fill('#name', 'A')
    await pg.click('#copy')
    await pg.locator('#ask').waitFor({ state: 'visible' })
    expect(await text(pg, '#askText')).toBe('"A" already exists in home-page. Replace it?')
    expect(await text(pg, '#askNumber')).toBe('Save as "A 2"')
    await pg.click('#askNumber')
    await pg.waitForFunction(() => /^Saved "A 2"/.test(document.getElementById('msg').innerText))
    expect(sent.filter((x) => x.p === '__copy').at(-1)).toMatchObject({ screen: 'home-page', state: 'a-2', label: 'A 2' })
    await pg.fill('#name', 'A')
    await pg.click('#copy')
    await pg.locator('#ask').waitFor({ state: 'visible' })
    await pg.click('#askReplace')
    await pg.waitForFunction(() => /^Saved "A"/.test(document.getElementById('msg').innerText))
    expect(sent.filter((x) => x.p === '__copy').at(-1)).toMatchObject({ state: 'a', replace: true })
    await pg.fill('#name', 'A')
    await pg.click('#copy')
    await pg.locator('#ask').waitFor({ state: 'visible' })
    await pg.click('#askCancel')
    expect(await text(pg, '#msg')).toBe('Not copied.')
    expect(await pg.locator('#ask').isHidden()).toBe(true)
  }, 30000)

  it('pressed options are raised chips; the disabled main button is grey, not faded', async () => {
    const { pg } = await copyTab([])
    await pg.waitForFunction(() => /No app tab/.test(document.getElementById('live').innerText))
    expect(await pg.locator('#copy').evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.opacity] })).toEqual(['rgb(228, 228, 231)', 'rgb(99, 99, 107)', '1'])
    expect(await pg.locator('#keyhint').isHidden()).toBe(true)
    expect(await pg.locator('[data-width="1440"]').evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.fontWeight] })).toEqual(['rgb(255, 255, 255)', 'rgb(24, 24, 27)', '600'])
  }, 30000)

  it('one field names the view: the id is made from it and sent with the name as label; success offers Open in viewer, then the name is cleared for the next copy', async () => {
    const { pg, sent: all } = await copyTab([tab('app')], { __copy: [201, { saved: 'x', images: 0, warnings: [] }], __preset: [200, { ok: true }] })
    const sent = { filter: (f) => all.filter(f), get copies() { return all.filter((x) => x.p === '__copy') } }
    expect(await pg.inputValue('#screen')).toBe('home-page')
    await pg.fill('#name', 'Menu open')
    expect(await text(pg, '#idLine')).toContain('Saved as menu-open')
    await pg.click('#copy')
    await pg.waitForFunction(() => /^Saved/.test(document.getElementById('msg').innerText))
    expect(sent.copies).toEqual([{ p: '__copy', screen: 'home-page', state: 'menu-open', label: 'Menu open' }])
    expect(await text(pg, '#msg')).toBe('Saved "Menu open" in home-page. Open in viewer')
    expect(await pg.getAttribute('#openViewer', 'href')).toBe('/screens/home-page.html#menu-open')
    expect(await pg.inputValue('#name')).toBe('')
    expect(await pg.evaluate(() => document.activeElement.id)).toBe('name')
    // The chord follows the Copy tab: an empty name clears what Ctrl+Shift+S would save.
    await expect.poll(() => sent.filter((x) => x.p === '__preset').at(-1)).toEqual({ p: '__preset', clear: true })
  }, 30000)

  it('Change id shows the id field; a typed id stays when the name changes', async () => {
    const { pg } = await copyTab([tab('app')])
    expect(await pg.locator('#state').isHidden()).toBe(true)
    await pg.fill('#name', 'Menu open')
    await pg.click('#changeId')
    expect(await pg.inputValue('#state')).toBe('menu-open')
    await pg.fill('#state', 'my-id')
    await pg.fill('#name', 'Other name')
    expect(await pg.inputValue('#state')).toBe('my-id')
  }, 30000)

  it('Copy with no name: the error sits under the field, the field is marked, nothing is sent, the last result goes', async () => {
    const { pg, sent } = await copyTab([tab('app')], { __copy: [201, { saved: 'x', images: 0, warnings: [] }] })
    await pg.fill('#name', 'First')
    await pg.click('#copy')
    await pg.waitForFunction(() => /^Saved/.test(document.getElementById('msg').innerText))
    await pg.fill('#name', '')
    await pg.click('#copy')
    expect(await text(pg, '#nameErr')).toBe('Give this view a name')
    expect(await pg.getAttribute('#name', 'aria-invalid')).toBe('true')
    expect(await pg.locator('#msg').textContent()).toBe('')
    expect(sent).toHaveLength(1)
  }, 30000)

  it('no app tab: a notice card in place of the tab card, the 3 copy buttons off with the reason', async () => {
    const { pg } = await copyTab([])
    await pg.waitForFunction(() => /No app tab/.test(document.getElementById('live').innerText))
    expect(await text(pg, '#live')).toBe('Session live · No app tab')
    expect(await text(pg, '#ready')).toContain("Your app is not open yet. Open a new tab in this browser window (Ctrl+T or Cmd+T) and go to your app's address. This card updates by itself.")
    expect(await pg.locator('#tab').isHidden()).toBe(true)
    for (const id of ['#copy', '#copyLater', '#copy3']) expect(await pg.locator(id).isDisabled()).toBe(true)
    expect(await text(pg, '#why')).toBe('Open your app first')
  }, 30000)

  it('a copy shows progress in its button; Copy in 5 s counts down here and Cancel stops the server wait', async () => {
    // A delayed copy waits here until the Cancel arrives, the way the server does.
    const later = async (body, sent) => {
      if (!body.delay) return [201, { saved: 'x', images: 0, warnings: [] }, 1500]
      for (let i = 0; i < 80 && !sent.some((x) => x.p === '__cancel'); i++) await new Promise((ok) => setTimeout(ok, 100))
      return [409, { cancelled: true, error: 'Copy cancelled.' }]
    }
    const { pg, sent } = await copyTab([tab('app')], { __copy: later, __cancel: [200, { cancelled: 1 }] })
    await pg.fill('#name', 'B')
    await pg.click('#copy')
    await pg.waitForFunction(() => /Copying/.test(document.getElementById('copy').innerText))
    await pg.waitForFunction(() => !document.getElementById('copy').disabled)
    expect(await text(pg, '#copy')).toContain('Copy state')
    await pg.fill('#name', 'C')
    await pg.click('#copyLater')
    await pg.waitForFunction(() => /Copying in \d\.\.\. switch to your app/.test(document.getElementById('later').innerText))
    await pg.click('#cancel')
    await pg.waitForFunction(() => /Copy cancelled/.test(document.getElementById('msg').innerText))
    expect(sent.map((x) => x.p)).toContain('__cancel')
    expect(await pg.locator('#later').isHidden()).toBe(true)
  }, 30000)

  it('Screen is one searchable field: matches list under it; a new screen is made only from the Create new screen row', async () => {
    const { r, cfg } = project()
    for (const n of ['alpha', 'cart', 'checkout', 'payment']) writeFileSync(join(r, `design/screens/${n}.html`), screen(n, [['a', 'A']]))
    const v = await viewer({ root: r, cfg, browser: stubBrowser([tab('app')]) })
    const pg = await newPage()
    const sent = []
    await pg.route('**/__copy', (route) => { if (route.request().method() !== 'POST') return route.continue(); sent.push(route.request().postDataJSON()); route.fulfill({ status: 201, contentType: 'application/json', body: '{"saved":"x","images":0,"warnings":[]}' }) })
    await pg.goto(v.url + '/__copy')
    expect(await text(pg, '#screenHint')).toBe('Pick one, or type a new name')
    await pg.fill('#screen', 'c')
    expect(await pg.locator('#screenList [role=option]').allInnerTexts()).toEqual(['cart', 'checkout', 'Create new screen "c"'])
    await pg.click('#screenList [data-value="checkout"]')
    expect(await pg.inputValue('#screen')).toBe('checkout')
    expect(await pg.locator('#screenList').isHidden()).toBe(true)
    await pg.fill('#screen', 'Order history')
    expect(await pg.locator('#screenList [role=option]').allInnerTexts()).toEqual(['Create new screen "Order history"'])
    await pg.fill('#name', 'Empty')
    await pg.click('#copy')
    expect(await text(pg, '#screenErr')).toBe('Pick a screen from the list, or Create new screen "Order history"')
    expect(sent).toEqual([])
    await pg.focus('#screen')
    await pg.keyboard.press('ArrowDown')
    await pg.keyboard.press('Enter')
    await pg.click('#copy')
    await expect.poll(() => sent.length).toBe(1)
    expect(sent[0]).toMatchObject({ screen: 'Order history', state: 'empty' })
  }, 30000)

  it('Copy at 3 widths shows the width it is on in its button', async () => {
    const { pg } = await copyTab([tab('app')], { __copy: [201, { saved: 'x', images: 0, warnings: [] }, 400], __resize: [200, { width: 1440 }], __toast: [200, { ok: true }] })
    await pg.fill('#name', 'D')
    await pg.click('#copy3')
    await pg.waitForFunction(() => /Width 2 of 3/.test(document.getElementById('copy3').innerText), null, { timeout: 8000 })
    await pg.waitForFunction(() => /^Saved/.test(document.getElementById('msg').innerText), null, { timeout: 10000 })
  }, 30000)
})
