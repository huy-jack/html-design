import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readConfig, writeConfig } from '../plugin/scripts/config.mjs'
import { startSession } from '../plugin/scripts/session.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'
import { startFixture } from './fixture/server.mjs'
import { makeData } from './helpers/data.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
let stops = []
afterEach(async () => { for (const f of stops) await f(); stops = [] })

describe('automation port', () => {
  it('writes cdpPort and version, and copies the tab named by target id', async () => {
    const fx = await startFixture()
    const r = mkdtempSync(join(tmpdir(), 'auto-'))
    execFileSync('git', ['init', '-q'], { cwd: r })
    writeConfig(r, { url: fx.a + '/login' })
    makeSkeleton(r, readConfig(r))
    const s = await startSession({ root: r, cfg: readConfig(r), data: makeData({ version: '1.56.1\n' }), headless: true, openPages: false })
    stops.push(async () => { await s.close(); fx.close() })
    const info = JSON.parse(readFileSync(join(r, 'design/.local/session.json'), 'utf8'))
    expect(info.cdpPort).toBeGreaterThan(0)
    expect(info.version).toBe('0.3.0')
    expect(existsSync(join(info.pluginRoot, 'scripts/build-css.mjs'))).toBe(true)
    await s.browser.appPages()[0].waitForLoadState('load')
    const remote = await chromium.connectOverCDP(`http://127.0.0.1:${info.cdpPort}`)
    const ctx = remote.contexts()[0]
    const mine = await ctx.newPage()
    await mine.goto(fx.a + '/page')
    await mine.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>mine-marker</p>'))
    const cdp = await ctx.newCDPSession(mine)
    const { targetInfo } = await cdp.send('Target.getTargetInfo')
    const copy = (tab, state) => fetch(`${s.view.url}/__copy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ screen: 'auto', state, tab }) })
    expect((await copy(`target:${targetInfo.targetId}`, 'home')).status).toBe(201)
    expect(readFileSync(join(r, 'design/screens/auto.html'), 'utf8')).toContain('mine-marker')
    expect((await copy('target:nope', 'x')).status).toBe(400)
    await mine.close()
    await remote.close()
    expect(s.browser.appPages().length).toBe(1)
  }, 60000)

  it('a copy never stores the tools\' own freeze style in page.css', async () => {
    const fx = await startFixture()
    const r = mkdtempSync(join(tmpdir(), 'auto-'))
    execFileSync('git', ['init', '-q'], { cwd: r })
    writeConfig(r, { url: fx.a + '/login' })
    makeSkeleton(r, readConfig(r))
    const s = await startSession({ root: r, cfg: readConfig(r), data: makeData({ version: '1.56.1\n' }), headless: true, openPages: false })
    stops.push(async () => { await s.close(); fx.close() })
    await s.browser.appPages()[0].waitForLoadState('load')
    const res = await fetch(`${s.view.url}/__copy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ screen: 'auto', state: 'home' }) })
    expect(res.status).toBe(201)
    const page = readFileSync(join(r, 'design/page.css'), 'utf8')
    expect(page).toContain('.lib')
    expect(page).not.toContain('transition: none')
  }, 60000)
})
