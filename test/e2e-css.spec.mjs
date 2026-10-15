// End to end, css style: setup, copy, add tw: classes, read the computed style in the viewer.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { buildCssInChild } from '../plugin/scripts/build-css.mjs'
import { openBrowser } from '../plugin/scripts/browser.mjs'
import { readConfig } from '../plugin/scripts/config.mjs'
import { createViewServer } from '../plugin/scripts/view.mjs'
import { APP_CSS, startCssFixture } from './fixture-css/server.mjs'
import { makeData } from './helpers/data.mjs'

const SCRIPTS = join(import.meta.dirname, '..', 'plugin', 'scripts')
let cleanup = []
afterEach(async () => { for (const f of cleanup.reverse()) await f(); cleanup = [] })

it('css style: tw: classes render; app CSS, adopted sheet and html vars survive the copy', async () => {
  const fx = await startCssFixture(); cleanup.push(() => fx.close())
  const r = mkdtempSync(join(tmpdir(), 'e2e-css-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  mkdirSync(join(r, 'src'))
  writeFileSync(join(r, 'src/app.css'), APP_CSS)
  execFileSync('git', ['add', 'src/app.css'], { cwd: r })
  const data = makeData()

  const setup = spawnSync(process.execPath, [join(SCRIPTS, 'setup.mjs'), '--data', data, '--skip-install', '--url', fx.url + '/'], { cwd: r, encoding: 'utf8' })
  expect(setup.status, setup.stderr).toBe(0)
  expect(JSON.parse(setup.stdout.trim().split('\n').pop())).toEqual({ style: 'css', css: null, twConfig: null, dark: '.dark', tokens: 2, dir: 'design' })
  expect(setup.stderr).not.toMatch(/View-only/)

  const cfg = readConfig(r)
  const b = await openBrowser({ root: r, cfg, dataDir: data, profileDir: mkdtempSync(join(tmpdir(), 'prof-')), headless: true }); cleanup.push(() => b.close())
  const v = await createViewServer({ root: r, cfg, browser: b, build: true, watch: false, dataDir: data, port: 0 }); cleanup.push(() => v.close())
  await b.appPages()[0].goto(fx.url + '/')
  const res = await fetch(`http://127.0.0.1:${v.port}/__copy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ screen: 'Home', state: 'base' }) })
  expect(res.status).toBe(201)

  const file = join(r, 'design/screens/home.html')
  const copied = readFileSync(file, 'utf8')
  expect(copied).toContain('data-html-vars="--accent:rgb(9, 9, 9)"')
  expect(readFileSync(join(r, 'design/page.css'), 'utf8')).toContain('.adopted')
  writeFileSync(file, copied
    .replace('class="card_x7f2"', 'class="card_x7f2 tw:p-6 tw:bg-(--ink)"')
    .replace('class="locked"', 'class="locked tw:p-6"')
    .replace('id="inline"', 'id="inline" class="tw:p-6"'))
  await buildCssInChild(r, data)

  const view = await b.context.newPage()
  await view.addInitScript(() => sessionStorage.setItem('sd-view', JSON.stringify({ theme: 'light', picking: false })))
  await view.setViewportSize({ width: 1600, height: 1200 })
  await view.goto(`http://127.0.0.1:${v.port}/screens/home.html#base@1440`)
  await view.waitForFunction(() => document.querySelector('iframe.sd-frame')?.contentDocument?.querySelector('#card'))
  await view.waitForTimeout(300)
  const got = await view.evaluate(() => {
    const d = document.querySelector('iframe.sd-frame').contentDocument
    const cs = (id) => getComputedStyle(d.getElementById(id))
    return { cardPad: cs('card').paddingTop, cardBg: cs('card').backgroundColor, boot: cs('boot').paddingTop, ad: cs('ad').color, acc: cs('acc').color, locked: cs('locked').paddingTop, inline: cs('inline').paddingTop }
  })
  // tw:p-6 beats the app's .locked !important (layered !important wins); the inline !important still wins (known limit).
  expect(got).toEqual({ cardPad: '24px', cardBg: 'rgb(4, 5, 6)', boot: '16px', ad: 'rgb(11, 12, 13)', acc: 'rgb(9, 9, 9)', locked: '24px', inline: '5px' })

  const tokens = spawnSync(process.execPath, [join(SCRIPTS, 'tokens.mjs'), '--data', data], { cwd: r, encoding: 'utf8' })
  expect(tokens.stdout).toContain('--accent')
}, 90000)
