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

  it('first copy resizes to the largest width (Review Focus 5)', async () => {
    const fx = await startFixture(); cleanup.push(() => fx.close())
    const r = tempProject({ url: fx.a + '/login', css: 'app.css', themeVars: ['--color-brand'] })
    const b = await openBrowser({ root: r, cfg: readConfig(r), dataDir: dataDir(), profileDir: profile(), headless: true }); cleanup.push(() => b.close())
    const page = b.appPages()[0]; await page.goto(fx.a + '/login')
    await page.setViewportSize({ width: 375, height: 900 })
    const out = await b.copyFrom(page, { screen: 'Fixture', state: 'closed' })
    expect(out.status).toBe(201)
    expect(readFileSync(join(r, 'design/screens/fixture.html'), 'utf8')).toMatch(/id="closed"[^>]*data-width="1440"|data-width="1440"[^>]*id="closed"/)
    expect(await page.evaluate(() => window.innerWidth)).toBe(1440)
    expect(await page.evaluate(() => window.innerHeight)).toBe(900)
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
