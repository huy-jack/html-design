import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readConfig, writeConfig } from '../plugin/scripts/config.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'
import { isOurSession, psCommand, startSession } from '../plugin/scripts/session.mjs'
import { createServer } from 'node:http'
import { startFixture } from './fixture/server.mjs'

const SESSION = join(import.meta.dirname, '..', 'plugin/scripts/session.mjs')
function project() {
  const r = mkdtempSync(join(tmpdir(), 'ses-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  writeConfig(r, {})
  makeSkeleton(r, readConfig(r))
  return r
}
function data(version = '1.56.1\n') {
  const d = mkdtempSync(join(tmpdir(), 'sdata-'))
  mkdirSync(join(d, 'node_modules'))
  symlinkSync(join(import.meta.dirname, '..', 'node_modules', 'playwright'), join(d, 'node_modules', 'playwright'))
  if (version !== null) writeFileSync(join(d, 'playwright-version.txt'), version)
  return d
}
const ses = (r, d, ...a) => spawnSync(process.execPath, [SESSION, ...a, '--data', d], { cwd: r, encoding: 'utf8' })
const portOpen = (port) => fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)

let stops = []
afterEach(async () => { for (const f of stops) await f(); stops = [] })

describe('session', () => {
  it('start, status, stop (headless)', async () => {
    const r = project(), d = data()
    stops.push(() => ses(r, d, 'stop'))
    const st = ses(r, d, 'start', '--headless')
    expect(st.status).toBe(0)
    const { port, pid } = JSON.parse(readFileSync(join(r, 'design/.local/session.json'), 'utf8'))
    expect(st.stdout).toContain(`Viewer http://127.0.0.1:${port}/  Copy window http://127.0.0.1:${port}/__copy`)
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200)
    expect(ses(r, d, 'start', '--headless').stdout).toContain(`127.0.0.1:${port}/`)
    const s = ses(r, d, 'status')
    expect(s.stdout).toContain('running')
    expect(JSON.parse(s.stdout)).toEqual({ running: true, port, screens: 0, openNotes: 0 })
    expect(ses(r, d, 'stop').status).toBe(0)
    expect(existsSync(join(r, 'design/.local/session.json'))).toBe(false)
    expect(() => process.kill(pid, 0)).toThrow()
    expect(await portOpen(port)).toBe(false)
  }, 60000)

  it('a stale session.json counts as not running', () => {
    const r = project(), d = data()
    mkdirSync(join(r, 'design/.local'), { recursive: true })
    writeFileSync(join(r, 'design/.local/session.json'), JSON.stringify({ pid: 2 ** 22 + 12345, port: 1 }))
    expect(JSON.parse(ses(r, d, 'status').stdout)).toEqual({ running: false })
  })

  it('missing or different playwright version exits 6', () => {
    const r = project()
    for (const v of [null, '1.0.0\n']) {
      const out = ses(r, data(v), 'start', '--headless')
      expect(out.status).toBe(6)
      expect(out.stderr).toContain('Run /html-design setup again')
    }
  }, 30000)

  it('chord copies the page with the posted preset', async () => {
    const fx = await startFixture()
    const r = mkdtempSync(join(tmpdir(), 'ses-'))
    execFileSync('git', ['init', '-q'], { cwd: r })
    writeConfig(r, { url: fx.a + '/login' })
    makeSkeleton(r, readConfig(r))
    const s = await startSession({ root: r, cfg: readConfig(r), data: data(), headless: true, openPages: false })
    stops.push(async () => { await s.close(); fx.close() })
    const post = (body, headers = {}) => fetch(`${s.view.url}/__preset`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    expect((await post({ screen: 'Fixture', state: 'chord-state' })).status).toBe(200)
    expect((await post({ screen: 'x', state: 'a' }, { origin: 'http://evil.example' })).status).toBe(403)
    expect((await post('nope', { 'content-type': 'text/plain' })).status).toBe(415)
    const page = s.browser.appPages()[0]
    await page.waitForLoadState('load')
    await page.keyboard.press('Control+Shift+S')
    const file = join(r, 'design/screens/fixture.html')
    for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise((x) => setTimeout(x, 100))
    expect(readFileSync(file, 'utf8')).toContain('chord-state')
  }, 60000)

  it('without ps, the session check falls back to a live pid whose port serves the viewer page', async () => {
    const serve = (body) => new Promise((ok) => { const srv = createServer((q, res) => res.end(body)).listen(0, '127.0.0.1', () => ok(srv)) })
    const viewer = await serve('<!doctype html><html><head><title>Designs</title></head><body></body></html>')
    const other = await serve('<html><title>Other app</title></html>')
    stops.push(() => new Promise((ok) => viewer.close(ok)), () => new Promise((ok) => other.close(ok)))
    const noPs = () => null
    expect(await isOurSession({ pid: process.pid, port: viewer.address().port }, { ps: noPs })).toBe(true)
    expect(await isOurSession({ pid: process.pid, port: other.address().port }, { ps: noPs })).toBe(false)
    expect(await isOurSession({ pid: process.pid, port: 1 }, { ps: noPs })).toBe(false)
    // With ps, its answer decides and the port is not asked.
    expect(await isOurSession({ pid: 1, port: viewer.address().port }, { ps: () => '' })).toBe(false)
    expect(await isOurSession({ pid: 1, port: 1 }, { ps: () => 'node session.mjs run --data x' })).toBe(true)
    expect(psCommand(process.pid)).toContain('node')
  })
})
