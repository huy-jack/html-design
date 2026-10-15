import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeEntities, detectDarkSelector, mediaDarkOnly, parseVarList, rootVars, varKind, varSources } from '../plugin/scripts/styles/vars.mjs'

describe('rootVars', () => {
  it('reads :root, html and :host, also inside @media and @layer, never other rules', () => {
    const v = rootVars('@charset "utf-8";\n:root { --brand: #2563eb; --gap: 4px }\n@layer base { html { --ink: rgb(1 2 3) } }\n@media (min-width: 1px) { :host { --font-ui: Inter, sans-serif } }\n.card { --local: 1 }')
    expect([...v]).toEqual([['--brand', '#2563eb'], ['--gap', '4px'], ['--ink', 'rgb(1 2 3)'], ['--font-ui', 'Inter, sans-serif']])
  })
  it('keeps the light value; a name only in the dark block keeps its dark value', () => {
    const v = rootVars(':root { --brand: #111 }\n.dark { --brand: #eee; --glow: #f0f }', '.dark')
    expect(v.get('--brand')).toBe('#111')
    expect(v.get('--glow')).toBe('#f0f')
  })
  it('SCSS interpolation gives ? and does not break the other values', () => {
    const v = rootVars(':root { --brand: #{$blue}; --ink: #000 }')
    expect(v.get('--brand')).toBe('?')
    expect(v.get('--ink')).toBe('#000')
  })
  it('ignores comments', () => expect(rootVars('/* :root { --x: 1 } */ :root { --y: 2 }').has('--x')).toBe(false))
  it('stays fast on 10 MB with no braces (a regex over the whole text would be quadratic)', () => {
    const t = Date.now()
    expect(rootVars(' '.repeat(10 * 1024 * 1024)).size).toBe(0)
    expect(Date.now() - t).toBeLessThan(2000)
  })
})

describe('dark selector', () => {
  it('finds class and attribute forms that redefine a root var', () => {
    expect(detectDarkSelector(':root{--a:1} .dark{--a:2}')).toBe('.dark')
    expect(detectDarkSelector(':root{--a:1} html.theme-dark{--a:2}')).toBe('.theme-dark')
    expect(detectDarkSelector(':root{--a:1} :root[data-theme="dark"]{--a:2}')).toBe('[data-theme=dark]')
  })
  it('null when the dark block defines no root var, or there is none', () => {
    expect(detectDarkSelector(':root{--a:1} .dark{--b:2}')).toBe(null)
    expect(detectDarkSelector(':root{--a:1}')).toBe(null)
  })
  it('mediaDarkOnly spots prefers-color-scheme root blocks', () => {
    expect(mediaDarkOnly('@media (prefers-color-scheme: dark) { :root { --a: 2 } }')).toBe(true)
    expect(mediaDarkOnly(':root { --a: 1 }')).toBe(false)
  })
})

it('varKind', () => {
  expect(varKind('--brand', '#2563eb')).toBe('color')
  expect(varKind('--b', 'oklch(0.5 0.1 200)')).toBe('color')
  expect(varKind('--gap', '1.5rem')).toBe('length')
  expect(varKind('--font-ui', 'Inter, sans-serif')).toBe('font')
  expect(varKind('--primary', '222 47% 11%')).toBe('other')
  expect(varKind('--x', '?')).toBe('other')
})

it('parseVarList and decodeEntities', () => {
  expect(parseVarList('--a:1;--b: rgb(1, 2, 3)')).toEqual([['--a', '1'], ['--b', 'rgb(1, 2, 3)']])
  expect(decodeEntities('[&amp;_p]:x &#x41;&#66;')).toBe('[&_p]:x AB')
})

describe('varSources', () => {
  it('reads tracked app files, page.css and state attributes, never the design folder', () => {
    const r = mkdtempSync(join(tmpdir(), 'vs-'))
    execFileSync('git', ['init', '-q'], { cwd: r })
    mkdirSync(join(r, 'src'))
    mkdirSync(join(r, 'design/screens'), { recursive: true })
    writeFileSync(join(r, 'src/vars.scss'), ':root { --brand: #111 }')
    writeFileSync(join(r, 'design/dist.css'), ':root { --not-app: 1 }')
    writeFileSync(join(r, 'untracked.css'), ':root { --untracked: 1 }')
    execFileSync('git', ['add', 'src/vars.scss', 'design/dist.css'], { cwd: r })
    writeFileSync(join(r, 'design/page.css'), ':root { --from-page: 2px }')
    writeFileSync(join(r, 'design/screens/a.html'), '<template id="s" data-html-vars="--accent:rgb(9, 9, 9)" data-body-vars="--gap:4px"></template>')
    const s = varSources(r, { dir: 'design', dark: '.dark' })
    expect([...s.app.keys()]).toEqual(['--brand'])
    expect([...s.page.keys()]).toEqual(['--from-page'])
    expect([...s.data]).toEqual([['--accent', 'rgb(9, 9, 9)'], ['--gap', '4px']])
  })
  it('outside a git repo it reads no app files', () => {
    expect(varSources(mkdtempSync(join(tmpdir(), 'vs-')), { dir: 'design', dark: '.dark' }).app.size).toBe(0)
  })
})
