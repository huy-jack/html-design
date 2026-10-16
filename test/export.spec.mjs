import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportSite } from '../plugin/scripts/export.mjs'

const SCRIPT = join(import.meta.dirname, '..', 'plugin', 'scripts', 'export.mjs')
const TEMPLATE = readFileSync(join(import.meta.dirname, '..', 'plugin', 'templates', 'switcher.js'), 'utf8')
const SCREEN_A =
  '<!DOCTYPE html><html lang="en" data-screen="Alpha"><head><meta charset="utf-8"><title>a</title><script src="../switcher.js" defer></script></head><body>\n' +
  '<template id="s1" data-label="One" data-url="/en/a" data-proposed="T-1"><main>one at 1440</main></template>\n' +
  '<template id="s1@375" data-variant-of="s1" data-widths="375"><main>one at 375</main></template>\n' +
  '<template id="s2" data-label="Menu open"><main>two</main></template>\n' +
  '</body></html>\n'
const SCREEN_B = '<!DOCTYPE html><html><head></head><body><template id="t1" data-label="Only"><p>b</p></template></body></html>\n'

function design(screens = { 'a.html': SCREEN_A, 'b.html': SCREEN_B }) {
  const d = mkdtempSync(join(tmpdir(), 'ex-'))
  mkdirSync(join(d, 'screens'))
  for (const [f, t] of Object.entries(screens)) writeFileSync(join(d, 'screens', f), t)
  mkdirSync(join(d, 'dist'))
  writeFileSync(join(d, 'dist', 'design.css'), 'main{color:red}')
  writeFileSync(join(d, 'fonts.css'), '')
  writeFileSync(join(d, 'page.css'), '')
  writeFileSync(join(d, 'switcher.js'), TEMPLATE)
  mkdirSync(join(d, 'assets'))
  writeFileSync(join(d, 'assets', 'x.png'), 'png')
  mkdirSync(join(d, '.local'))
  writeFileSync(join(d, '.local', 'session.json'), '{}')
  return d
}
const outDir = () => join(mkdtempSync(join(tmpdir(), 'ex-out-')), 'site')
const opts = (d, out, extra = {}) => ({ design: d, out, appUrl: 'https://dev.example.com', now: Date.UTC(2026, 9, 16, 7, 5), commit: 'cc81468', commitTime: () => Date.UTC(2026, 9, 12), ...extra })
const read = (out, p) => readFileSync(join(out, p), 'utf8')

describe('export', () => {
  it('writes the Screens page twice, every screen file, one page per state and the shared files; never .local', () => {
    const out = outDir()
    const r = exportSite(opts(design(), out))
    expect(r).toEqual({ screens: 2, states: 3 })
    for (const p of ['index.html', 'screens/index.html', 'screens/a.html', 'screens/b.html', 'states/a/s1.html', 'states/a/s2.html', 'states/b/t1.html', 'dist/design.css', 'fonts.css', 'page.css', 'switcher.js', 'assets/x.png']) expect(existsSync(join(out, p)), p).toBe(true)
    expect(existsSync(join(out, '.local'))).toBe(false)
    expect(existsSync(join(out, 'states/a/s1@375.html'))).toBe(false)
  })

  it('marks each screen copy as part of a site with the app address, and changes nothing else', () => {
    const out = outDir()
    exportSite(opts(design(), out))
    const a = read(out, 'screens/a.html')
    expect(a).toContain('<meta name="hd-site" data-home="../index.html" data-app-url="https://dev.example.com">')
    expect(a.replace(/<meta name="hd-site"[^>]*>/, '')).toBe(SCREEN_A)
  })

  it('a state page is that one state, light, at the first width, with links that reach the shared CSS', () => {
    const out = outDir()
    exportSite(opts(design(), out))
    const s1 = read(out, 'states/a/s1.html')
    expect(s1).toContain('<base href="../../screens/">')
    expect(s1).toContain('<link rel="stylesheet" href="../dist/design.css">')
    expect(s1).toContain('one at 1440')
    expect(s1).not.toContain('one at 375')
    expect(s1).not.toContain('two')
  })

  it('the Screens page works from any folder of a static host: relative links, no server calls, no designer tools', () => {
    const out = outDir()
    exportSite(opts(design(), out))
    const home = read(out, 'index.html')
    const inScreens = read(out, 'screens/index.html')
    expect(home).toContain('href="screens/a.html#s1"')
    expect(home).toContain('src="states/a/s1.html"')
    expect(home).not.toContain('<base ')
    expect(inScreens).toContain('<base href="../">')
    for (const page of [home, inScreens]) {
      expect(page).not.toContain('/__')
      expect(page).not.toContain('Open Copy tab')
      expect(page).not.toContain('id="steps"')
      expect(page).not.toContain('>Live<')
    }
  })

  it('the Screens page has a ticket filter and says when and from which commit it was made', () => {
    const out = outDir()
    exportSite(opts(design(), out))
    const home = read(out, 'index.html')
    expect(home).toContain('<option value="T-1">T-1</option>')
    expect(home).toContain('data-t="T-1"')
    expect(home).toContain('cc81468')
    expect(home).toContain(`data-mtime="${Date.UTC(2026, 9, 12)}"`)
    expect(home).toContain(`data-updated="${Date.UTC(2026, 9, 16, 7, 5)}"`)
  })

  it("ships this plugin's viewer with the project's widths and dark mode, even when the project's copy is older", () => {
    const d = design()
    writeFileSync(join(d, 'switcher.js'), "var HtmlDesign = (function () {\n  var WIDTHS = /*WIDTHS*/[1280,390]\n  var DARK = /*DARK*/{\"kind\":\"attr\",\"name\":\"data-theme\",\"value\":\"dark\"}\n  return {} })()\n")
    const out = outDir()
    exportSite(opts(d, out))
    const sw = read(out, 'switcher.js')
    expect(sw).toContain('meta[name="hd-site"]')
    expect(sw).toContain('/*WIDTHS*/[1280,390]')
    expect(sw).toContain('/*DARK*/{"kind":"attr","name":"data-theme","value":"dark"}')
  })

  it('a screen file that cannot be read is a card that says so; the rest still exports', () => {
    const d = design()
    mkdirSync(join(d, 'screens', 'broken.html'))
    const out = outDir()
    expect(exportSite(opts(d, out))).toEqual({ screens: 3, states: 3 })
    expect(read(out, 'index.html')).toContain('This file could not be read')
  })

  it('refuses an empty design folder, so a sync with delete never runs on nothing', () => {
    const out = outDir()
    expect(() => exportSite(opts(design({}), out))).toThrow('No screen files in')
    expect(existsSync(out)).toBe(false)
  })

  it('refuses an output folder that is not empty', () => {
    const out = outDir()
    mkdirSync(out)
    writeFileSync(join(out, 'keep.txt'), 'x')
    expect(() => exportSite(opts(design(), out))).toThrow('is not empty')
    expect(readFileSync(join(out, 'keep.txt'), 'utf8')).toBe('x')
  })

  it('refuses a screen or state name that could write outside the output folder', () => {
    const bad = SCREEN_B.replace('id="t1"', 'id="../../x"')
    expect(() => exportSite(opts(design({ 'b.html': bad }), outDir()))).toThrow('../../x')
    expect(() => exportSite(opts(design({ 'Bad Name.html': SCREEN_B }), outDir()))).toThrow('Bad Name')
  })

  it('as a command: exit 0 with a summary, exit 1 with the reason', () => {
    const out = outDir()
    const ok = execFileSync('node', [SCRIPT, '--design', design(), '--out', out, '--app-url', 'https://dev.example.com'], { encoding: 'utf8' })
    expect(ok).toContain('2 screens, 3 states')
    let err = null
    try { execFileSync('node', [SCRIPT, '--design', design({}), '--out', outDir()], { encoding: 'utf8', stdio: 'pipe' }) } catch (e) { err = e }
    expect(err.status).toBe(1)
    expect(String(err.stderr)).toContain('No screen files in')
  })
})
