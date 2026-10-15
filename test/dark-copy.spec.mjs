// S7: a state copied while the app is dark renders light when the viewer is set to light.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCssInChild } from '../plugin/scripts/build-css.mjs'
import { openBrowser } from '../plugin/scripts/browser.mjs'
import { readConfig, writeConfig } from '../plugin/scripts/config.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'
import { createViewServer } from '../plugin/scripts/view.mjs'
import { startFixture } from './fixture/server.mjs'

const NM = join(import.meta.dirname, '..', 'node_modules')
function project(extra) {
  const r = mkdtempSync(join(tmpdir(), 'dk-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n@theme { --color-brand: #123456; }\n')
  writeConfig(r, { css: 'app.css', themeVars: ['--color-brand'], widths: [1440], ...extra })
  makeSkeleton(r, readConfig(r))
  mkdirSync(join(r, 'node_modules/@tailwindcss'), { recursive: true })
  for (const p of ['tailwindcss', 'postcss', '@tailwindcss/postcss']) symlinkSync(join(NM, p), join(r, 'node_modules', p))
  return { r, cfg: readConfig(r) }
}
function dataDir() {
  const d = mkdtempSync(join(tmpdir(), 'data-'))
  mkdirSync(join(d, 'node_modules'))
  symlinkSync(join(NM, 'playwright'), join(d, 'node_modules', 'playwright'))
  return d
}

let cleanup = []
afterEach(async () => { for (const f of cleanup.reverse()) await f(); cleanup = [] })

const CASES = [
  { name: 'class="dark"', dark: '.dark', css: '.dark body{background-color:rgb(0,0,0)}',
    setDark: () => { document.documentElement.classList.add('dark') } },
  { name: 'data-theme="dark" + color-scheme: dark', dark: '[data-theme=dark]', css: '[data-theme=dark] body{background-color:rgb(0,0,0)}',
    setDark: () => { document.documentElement.setAttribute('data-theme', 'dark'); document.documentElement.setAttribute('style', 'color-scheme: dark') } },
]

describe('copy while the app is dark (S7)', () => {
  for (const c of CASES) {
    it(`${c.name}: viewer at light renders light`, async () => {
      const fx = await startFixture(); cleanup.push(() => fx.close())
      const { r, cfg } = project({ url: fx.a + '/login', dark: c.dark })
      const b = await openBrowser({ root: r, cfg, dataDir: dataDir(), profileDir: mkdtempSync(join(tmpdir(), 'prof-')), headless: true }); cleanup.push(() => b.close())
      const v = await createViewServer({ root: r, cfg, browser: b, build: true, watch: false, dataDir: null, port: 0 }); cleanup.push(() => v.close())
      const app = b.appPages()[0]
      await app.setViewportSize({ width: 1440, height: 900 })
      await app.goto(fx.a + '/login')
      await app.addStyleTag({ content: c.css })
      await app.evaluate(c.setDark)
      expect(await app.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)')
      const res = await fetch(`http://127.0.0.1:${v.port}/__copy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ screen: 'Fixture', state: 'dark-app' }) })
      expect(res.status).toBe(201)
      const file = readFileSync(join(r, 'design/screens/fixture.html'), 'utf8')
      expect(file).not.toMatch(/data-html-class="[^"]*\bdark\b/)
      expect(file).not.toContain('color-scheme')
      await buildCssInChild(r, null)
      const view = await b.context.newPage()
      await view.addInitScript(() => sessionStorage.setItem('sd-view', JSON.stringify({ theme: 'light', picking: false })))
      await view.setViewportSize({ width: 1600, height: 1200 })
      await view.goto(`http://127.0.0.1:${v.port}/screens/fixture.html#dark-app@1440`)
      await view.waitForFunction(() => document.querySelector('iframe.sd-frame')?.contentDocument?.querySelector('#menu'))
      await view.waitForTimeout(300)
      const got = await view.evaluate(() => {
        const d = document.querySelector('iframe.sd-frame').contentDocument
        const h = d.documentElement
        return { cls: h.className, theme: h.getAttribute('data-theme'), style: h.getAttribute('style'), bg: getComputedStyle(d.body).backgroundColor, scheme: getComputedStyle(h).colorScheme }
      })
      expect(got.cls.split(/\s+/)).not.toContain('dark')
      expect(got.theme).toBeNull()
      expect(got.style ?? '').not.toContain('color-scheme')
      expect(got.scheme).not.toContain('dark')
      expect(got.bg).toBe('rgb(255, 255, 255)')
      // Control: the copied dark rule still works, so the light result is not an accident.
      await view.click('.sd-bar button:not([data-sd]):not([data-width])')
      await view.waitForFunction(() => getComputedStyle(document.querySelector('iframe.sd-frame')?.contentDocument?.body ?? document.createElement('i')).backgroundColor === 'rgb(0, 0, 0)', null, { timeout: 5000 })
    }, 60000)
  }
})
