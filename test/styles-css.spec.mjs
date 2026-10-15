import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import css, { cssEntry } from '../plugin/scripts/styles/css.mjs'
import { makeData } from './helpers/data.mjs'

const cfg = (over = {}) => ({ dir: 'design', dark: '.dark', css: null, ...over })
function project(classes = '') {
  const r = mkdtempSync(join(tmpdir(), 'cssa-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  mkdirSync(join(r, 'design/.local'), { recursive: true })
  writeFileSync(join(r, 'design/.local/screens-classes.txt'), classes)
  return r
}

describe('css adapter build', () => {
  it('builds only tw: classes, !important, no palette, no preflight, no scan of other files', async () => {
    const r = project('tw:p-6 tw:bg-(--brand) tw:bg-blue-500 tw:text-white tw:rounded-lg tw:dark:bg-(--ink) p-3 flex')
    writeFileSync(join(r, 'stray.html'), '<p class="tw:m-7"></p>')
    const out = await css.build(r, cfg(), makeData())
    expect(out).toMatch(/\.tw\\:p-6 \{\s*padding: calc\(var\(--tw-spacing\) \* 6\) !important;/)
    expect(out).toContain('background-color: var(--brand) !important')
    expect(out).toContain('.tw\\:rounded-lg')
    expect(out).toContain('.tw\\:dark\\:bg-\\(--ink\\)')
    expect(out).toContain(':where(.dark, .dark *)')
    for (const gone of ['tw\\:bg-blue-500', 'tw\\:text-white', 'tw\\:m-7', 'box-sizing: border-box']) expect(out).not.toContain(gone)
    expect(out).not.toMatch(/\.p-3\s*\{/)
    expect(out).not.toMatch(/\.flex\s*\{/)
  }, 60000)
  it('the entry names the dark selector, the classes file, and source(none)', () => {
    expect(cssEntry('/tw', '[data-theme=dark]', '/p/c.txt')).toContain('@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));')
    expect(cssEntry('/tw', '.dark', '/p/c.txt')).toContain('@source "/p/c.txt";')
    expect(cssEntry('/tw', '.dark', '/p/c.txt')).toContain('layer(utilities) important source(none);')
    expect(cssEntry('/tw', '.dark', '/p/c.txt')).toContain('@theme { --color-*: initial; }')
  })
  it('without the plugin Tailwind: ready says run setup, build rejects', async () => {
    const d = makeData({ tailwind: false })
    expect(css.ready(d)).toBe('Run /html-design setup again')
    expect(css.ready(null)).toBe('Run /html-design setup again')
    expect(css.ready(makeData())).toBe(null)
    await expect(css.build(project('tw:p-6'), cfg(), d)).rejects.toThrow(/run \/html-design setup/)
  })
})

describe('css adapter setup parts', () => {
  it('detect: the dark selector comes from tracked app CSS, never from the design folder', () => {
    const r = project()
    writeFileSync(join(r, 'app.css'), ':root{--brand:#111} [data-theme="dark"]{--brand:#eee}')
    execFileSync('git', ['add', '.'], { cwd: r })
    expect(css.detect(r, { dir: 'design' })).toEqual({ css: null, twConfig: null, themeVars: [], tailwindVersion: null, dark: '[data-theme=dark]', warnings: [] })
    const p = project()
    writeFileSync(join(p, 'app.css'), ':root{--a:1}')
    writeFileSync(join(p, 'design/page.css'), ':root{--x:1} [data-mode=dark]{--x:2}')
    execFileSync('git', ['add', '.'], { cwd: p })
    expect(css.detect(p, { dir: 'design' }).dark).toBe('.dark')
  })
  it('detect: dark vars only under prefers-color-scheme give a warning', () => {
    const r = project()
    writeFileSync(join(r, 'app.css'), ':root{--a:1} @media (prefers-color-scheme: dark){ :root{--a:2} }')
    execFileSync('git', ['add', '.'], { cwd: r })
    const out = css.detect(r, { dir: 'design' })
    expect(out.dark).toBe('.dark')
    expect(out.warnings[0]).toMatch(/prefers-color-scheme/)
  })
  it('tokens: app CSS, then page.css, then states; first source wins; class forms', () => {
    const r = project()
    writeFileSync(join(r, 'app.css'), ':root { --brand: #2563eb; --gap: 4px; --font-ui: Inter, sans-serif }')
    execFileSync('git', ['add', 'app.css'], { cwd: r })
    writeFileSync(join(r, 'design/page.css'), ':root { --brand: #000; --radius: 8px }')
    mkdirSync(join(r, 'design/screens'))
    writeFileSync(join(r, 'design/screens/a.html'), '<template id="s" data-html-vars="--accent:rgb(9, 9, 9)"></template>')
    const t = css.tokens(r, cfg())
    expect(t.prefix).toBe('tw:')
    expect(t.list).toEqual([
      { kind: 'color', name: '--brand', value: '#2563eb', use: 'tw:bg-(--brand) tw:text-(--brand)', source: 'app CSS' },
      { kind: 'length', name: '--gap', value: '4px', use: 'tw:*-(--gap)', source: 'app CSS' },
      { kind: 'font', name: '--font-ui', value: 'Inter, sans-serif', use: 'tw:font-(family-name:--font-ui)', source: 'app CSS' },
      { kind: 'length', name: '--radius', value: '8px', use: 'tw:*-(--radius)', source: 'page.css' },
      { kind: 'color', name: '--accent', value: 'rgb(9, 9, 9)', use: 'tw:bg-(--accent) tw:text-(--accent)', source: 'states' },
    ])
  })
  it('installs, mustBuild, ownSheet, watchDirs, designCss', () => {
    expect(css.installs()).toEqual([{ dir: join('tailwind', '4.1.18'), pkgs: ['tailwindcss@4.1.18', '@tailwindcss/postcss@4.1.18', 'postcss@8'] }])
    expect(css.mustBuild('tw:p-6')).toBe(true)
    expect(css.mustBuild('card_x7f2')).toBe(false)
    expect(css.ownSheet('/*! tailwindcss v4.1.18 */ .a{}', {})).toBe(false)
    expect(css.watchDirs()).toEqual([])
    expect(css.designCss()).toMatch(/not used/)
  })
})
