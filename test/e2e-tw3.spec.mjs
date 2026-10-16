// End to end, tw3 style: setup, copy, add a class that only the screen uses, read the computed style.
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { buildCssInChild } from '../plugin/scripts/build-css.mjs'
import { openBrowser } from '../plugin/scripts/browser.mjs'
import { readConfig } from '../plugin/scripts/config.mjs'
import { createViewServer } from '../plugin/scripts/view.mjs'
import { startTw3Fixture } from './fixture-tw3/server.mjs'
import { makeData } from './helpers/data.mjs'
import { TW3_DIR, TW3_MODULES } from './helpers/tw3.mjs'

const SCRIPTS = join(import.meta.dirname, '..', 'plugin', 'scripts')
let cleanup = []
afterEach(async () => { for (const f of cleanup.reverse()) await f(); cleanup = [] })

it('tw3 style: a screen-only class builds; the app sheet is rebuilt, not copied; Dark switches', async () => {
  const fx = await startTw3Fixture(); cleanup.push(() => fx.close())
  const r = mkdtempSync(join(tmpdir(), 'e2e-tw3-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  cpSync(join(TW3_DIR, 'tailwind.config.ts'), join(r, 'tailwind.config.ts'))
  cpSync(join(TW3_DIR, 'src'), join(r, 'src'), { recursive: true })
  symlinkSync(TW3_MODULES, join(r, 'node_modules'))
  execFileSync('git', ['add', 'tailwind.config.ts', 'src'], { cwd: r })
  const data = makeData({ tw3: true })

  const setup = spawnSync(process.execPath, [join(SCRIPTS, 'setup.mjs'), '--data', data, '--skip-install', '--url', fx.url + '/'], { cwd: r, encoding: 'utf8' })
  expect(setup.status, setup.stderr).toBe(0)
  expect(JSON.parse(setup.stdout.trim().split('\n').pop())).toEqual({ style: 'tw3', css: 'src/styles.css', twConfig: 'tailwind.config.ts', dark: '.dark', tokens: 2, dir: 'design' })
  expect(setup.stderr).toMatch(/darkMode "media" is rebuilt as the class \.dark/)

  const cfg = readConfig(r)
  const b = await openBrowser({ root: r, cfg, dataDir: data, profileDir: mkdtempSync(join(tmpdir(), 'prof-')), headless: true }); cleanup.push(() => b.close())
  const v = await createViewServer({ root: r, cfg, browser: b, build: true, watch: false, dataDir: data, port: 0 }); cleanup.push(() => v.close())
  await b.appPages()[0].goto(fx.url + '/')
  const res = await fetch(`http://127.0.0.1:${v.port}/__copy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ screen: 'Home', state: 'base' }) })
  expect(res.status).toBe(201)
  const page = readFileSync(join(r, 'design/page.css'), 'utf8')
  expect(page).not.toMatch(/tailwindcss v3/)
  expect(page).not.toContain('.app-card')

  const file = join(r, 'design/screens/home.html')
  writeFileSync(file, readFileSync(file, 'utf8').replace('class="bg-brand p-4 app-card"', 'class="bg-brand p-4 app-card mt-7 dark:text-brand"'))
  await buildCssInChild(r, data)

  const view = await b.context.newPage()
  await view.addInitScript(() => sessionStorage.setItem('sd-view', JSON.stringify({ theme: 'light', picking: false })))
  await view.setViewportSize({ width: 1600, height: 1200 })
  await view.goto(`http://127.0.0.1:${v.port}/screens/home.html#base@1440`)
  await view.waitForFunction(() => document.querySelector('iframe.sd-frame')?.contentDocument?.querySelector('#m'))
  await view.waitForTimeout(300)
  const got = await view.evaluate(() => {
    const s = getComputedStyle(document.querySelector('iframe.sd-frame').contentDocument.getElementById('m'))
    return { mt: s.marginTop, bg: s.backgroundColor, border: s.borderTopColor }
  })
  expect(got).toEqual({ mt: '28px', bg: 'rgb(18, 52, 86)', border: 'rgb(255, 0, 0)' })
  await view.click('.sd-bar [data-theme="dark"]')
  await view.waitForFunction(() => getComputedStyle(document.querySelector('iframe.sd-frame')?.contentDocument?.getElementById('m') ?? document.body).color === 'rgb(18, 52, 86)', null, { timeout: 5000 })
}, 120000)
