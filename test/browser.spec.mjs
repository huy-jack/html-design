import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openBrowser } from '../plugin/scripts/browser.mjs'
import { readConfig, writeConfig } from '../plugin/scripts/config.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'
import { startFixture } from './fixture/server.mjs'

function tempProject(cfg) {
  const r = mkdtempSync(join(tmpdir(), 'br-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n@theme { --color-brand: #123456; }\n')
  writeConfig(r, cfg)
  makeSkeleton(r, readConfig(r))
  return r
}
// The real install path: playwright only in <data>/node_modules.
function dataDir() {
  const d = mkdtempSync(join(tmpdir(), 'data-'))
  mkdirSync(join(d, 'node_modules'))
  symlinkSync(join(import.meta.dirname, '..', 'node_modules', 'playwright'), join(d, 'node_modules', 'playwright'))
  return d
}
const profile = () => mkdtempSync(join(tmpdir(), 'prof-'))
// A background tab in a headful window keeps its old size for seconds after the window changes. Headless
// gives each tab its own window, so the test makes the page report that old size; null ends it.
const stale = (page, w) => page.evaluate((w) => {
  for (const k of ['innerWidth', 'outerWidth']) {
    const d = Object.getOwnPropertyDescriptor(window, k)
    if (!d.get.__real) Object.defineProperty(window, k, { configurable: true, get: Object.assign(function () { return window.__stale ?? d.get.call(window) }, { __real: true }) })
  }
  window.__stale = w ?? undefined
}, w)
async function windowWidth(b, page, width) {
  const s = await b.context.newCDPSession(page)
  const { windowId } = await s.send('Browser.getWindowForTarget')
  await s.send('Browser.setWindowBounds', { windowId, bounds: { width } })
  await s.detach()
}

let cleanup = []
afterEach(async () => { for (const f of cleanup.reverse()) await f(); cleanup = [] })

describe('browser part', () => {
  it('copies a clicked state behind login, with images and fonts (S4, S8)', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const r = tempProject({ url: fx.a + '/login', css: 'app.css', themeVars: ['--color-brand'] })
    const b = await openBrowser({ root: r, cfg: readConfig(r), dataDir: dataDir(), profileDir: profile(), headless: true }); cleanup.push(() => b.close())
    const page = b.appPages()[0]; await page.goto(fx.a + '/login'); await page.click('text=Open menu')
    const out = await b.copyFrom(page, { screen: 'Fixture', state: 'menu-open' })
    expect(out.status).toBe(201); expect(out.images).toBe(1)
    const file = readFileSync(join(r, 'design/screens/fixture.html'), 'utf8')
    expect(file).toContain('id="menu"'); expect(file).not.toMatch(/http:\/\/127\.0\.0\.1/)
    expect(readFileSync(join(r, 'design/page.css'), 'utf8')).toContain('.lib')
    expect(readFileSync(join(r, 'design/page.css'), 'utf8')).toContain('cross')
    expect(readFileSync(join(r, 'design/page.css'), 'utf8')).not.toContain('--color-brand')
    expect(readFileSync(join(r, 'design/fonts.css'), 'utf8')).toContain('base64,')
  })

  it('a first copy keeps the window size and is stored at the nearest set width, with a warning', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const r = tempProject({ url: fx.a + '/login', css: 'app.css', themeVars: ['--color-brand'] })
    const b = await openBrowser({ root: r, cfg: readConfig(r), dataDir: dataDir(), profileDir: profile(), headless: true }); cleanup.push(() => b.close())
    const page = b.appPages()[0]; await page.goto(fx.a + '/login')
    await page.setViewportSize({ width: 1000, height: 900 })
    const out = await b.copyFrom(page, { screen: 'Fixture', state: 'closed' })
    expect(out.status).toBe(201)
    expect(out.warnings).toContain('window is 1000px wide; stored as 1024px')
    expect(readFileSync(join(r, 'design/screens/fixture.html'), 'utf8')).toMatch(/id="closed"[^>]*data-width="1024"|data-width="1024"[^>]*id="closed"/)
    expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1000, 900])
  })

  it('copying a new state keeps an open click menu and never changes the page size', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const r = tempProject({ url: fx.a + '/login', css: 'app.css', themeVars: ['--color-brand'] })
    const b = await openBrowser({ root: r, cfg: readConfig(r), dataDir: dataDir(), profileDir: profile(), headless: true }); cleanup.push(() => b.close())
    const page = b.appPages()[0]; await page.goto(fx.a + '/login'); await page.goto(fx.a + '/menus')
    await page.click('#open-click')
    const size = () => page.evaluate(() => [window.innerWidth, window.outerWidth, window.innerHeight])
    const before = await size()
    const out = await b.copyFrom(page, { screen: 'Menus', state: 'open' })
    expect(out.status).toBe(201)
    expect(readFileSync(join(r, 'design/screens/menus.html'), 'utf8')).toContain('id="click-menu"')
    expect(await size()).toEqual(before)
    // No emulated size: the page is as wide as the window.
    expect(before[0]).toBe(before[1])
  })

  it('resize sets the real window width and leaves no emulated size behind', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const r = tempProject({ url: fx.a + '/login', css: 'app.css', themeVars: ['--color-brand'] })
    const b = await openBrowser({ root: r, cfg: readConfig(r), dataDir: dataDir(), profileDir: profile(), headless: true }); cleanup.push(() => b.close())
    const first = b.appPages()[0]; await first.goto(fx.a + '/login')
    const second = await b.context.newPage(); await second.goto(fx.a + '/menus')
    const widths = (p) => p.evaluate(() => [window.innerWidth, window.outerWidth])
    for (const w of [1024, 375, 1440]) {
      await b.resize(w)
      expect(await widths(first)).toEqual([w, w])
      expect(await widths(second)).toEqual([w, w])
    }
  })

  it('resize trusts the window bounds: a tab that reports a stale size gets no emulated size', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const r = tempProject({ url: fx.a + '/login', css: 'app.css', themeVars: ['--color-brand'] })
    const b = await openBrowser({ root: r, cfg: readConfig(r), dataDir: dataDir(), profileDir: profile(), headless: true }); cleanup.push(() => b.close())
    const page = b.appPages()[0]; await page.goto(fx.a + '/login')
    await stale(page, 1200)
    await b.resize(1440)
    await stale(page, null)
    // The user then changes the window: the page follows it, it does not stay at an emulated 1440.
    await windowWidth(b, page, 1100)
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1100)
  })

  it('resize with front brings that tab to the front and returns once it is laid out at the width', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const r = tempProject({ url: fx.a + '/login', css: 'app.css', themeVars: ['--color-brand'] })
    const b = await openBrowser({ root: r, cfg: readConfig(r), dataDir: dataDir(), profileDir: profile(), headless: true }); cleanup.push(() => b.close())
    const first = b.appPages()[0]; await first.goto(fx.a + '/login')
    const second = await b.context.newPage(); await second.goto(fx.a + '/menus')
    // Behind, the tab keeps its old size; in front, it is laid out.
    await stale(second, 1200)
    const toFront = second.bringToFront.bind(second)
    let fronts = 0
    second.bringToFront = async () => { fronts += 1; await toFront(); await stale(second, null) }
    await b.resize(1024, { front: second })
    expect(fronts).toBe(1)
    expect(await second.evaluate(() => [window.innerWidth, window.outerWidth])).toEqual([1024, 1024])
  })

  it('a copy of a tab that reports a stale size brings it to the front first, so it is stored at the window width', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const r = tempProject({ url: fx.a + '/login', css: 'app.css', themeVars: ['--color-brand'] })
    const b = await openBrowser({ root: r, cfg: readConfig(r), dataDir: dataDir(), profileDir: profile(), headless: true }); cleanup.push(() => b.close())
    const page = b.appPages()[0]; await page.goto(fx.a + '/login')
    await windowWidth(b, page, 1024)
    await stale(page, 1300)
    const toFront = page.bringToFront.bind(page)
    let fronts = 0
    page.bringToFront = async () => { fronts += 1; await toFront(); await stale(page, null) }
    const out = await b.copyFrom(page, { screen: 'Fixture', state: 'behind' })
    expect(out.status).toBe(201)
    expect(fronts).toBe(1)
    expect(out.warnings.join(' ')).not.toContain('1300')
    expect(readFileSync(join(r, 'design/screens/fixture.html'), 'utf8')).toMatch(/id="behind"[^>]*data-width="1024"|data-width="1024"[^>]*id="behind"/)
    // A tab that is laid out is not brought to the front.
    await b.copyFrom(page, { screen: 'Fixture', state: 'front' })
    expect(fronts).toBe(1)
  })

  it('appPages excludes viewer pages (Review Focus 3)', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const r = tempProject({ url: fx.a + '/login', css: 'app.css', themeVars: ['--color-brand'] })
    const b = await openBrowser({ root: r, cfg: readConfig(r), dataDir: dataDir(), profileDir: profile(), headless: true, viewerOrigin: fx.b }); cleanup.push(() => b.close())
    const first = b.appPages()[0]; await first.goto(fx.a + '/login')
    const second = await b.context.newPage(); await second.goto(fx.a + '/login')
    const viewer = await b.context.newPage(); await viewer.goto(fx.b + '/cross.css')
    expect(b.appPages()).toHaveLength(2)
    expect(b.appPages()).not.toContain(viewer)
  })
  it('Ctrl+Shift+S copies the page with the preset names', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const r = tempProject({ url: fx.a + '/login', css: 'app.css', themeVars: ['--color-brand'] })
    let done
    const result = new Promise((res) => { done = res })
    const b = await openBrowser({ root: r, cfg: readConfig(r), dataDir: dataDir(), profileDir: profile(), headless: true,
      onChord: (p) => b.copyFrom(p, { screen: 'Fixture', state: 'chord' }).then(done) }); cleanup.push(() => b.close())
    const page = b.appPages()[0]; await page.waitForLoadState()
    await page.keyboard.press('Control+Shift+S')
    expect((await result).status).toBe(201)
    expect(existsSync(join(r, 'design/screens/fixture.html'))).toBe(true)
    expect(readFileSync(join(r, 'design/screens/fixture.html'), 'utf8')).toContain('id="chord"')
  })
})
