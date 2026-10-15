import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import tw4, { themeTokens } from '../plugin/scripts/styles/tw4.mjs'

const code = (fn) => { try { fn(); return null } catch (e) { return e.code } }
function repo(files, pkgs = { tailwindcss: '4.1.18' }) {
  const r = mkdtempSync(join(tmpdir(), 'tw4-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  for (const [p, t] of Object.entries(files)) { mkdirSync(join(r, p, '..'), { recursive: true }); writeFileSync(join(r, p), t) }
  execFileSync('git', ['add', '.'], { cwd: r })
  for (const [name, version] of Object.entries(pkgs)) { mkdirSync(join(r, 'node_modules', name), { recursive: true }); writeFileSync(join(r, 'node_modules', name, 'package.json'), JSON.stringify({ version })) }
  return r
}

describe('tw4 detect', () => {
  it('reads the file, theme vars, version and dark switch', () => {
    const r = repo({ 'a.css': '@import "tailwindcss";\n@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));\n@theme { --color-brand: #123; }' })
    expect(tw4.detect(r, { dir: 'design' })).toEqual({ css: 'a.css', twConfig: null, themeVars: ['--color-brand'], tailwindVersion: '4.1.18', dark: '[data-theme=dark]', warnings: [] })
  })
  it('null without a Tailwind 4 file, and null when --css names a file without @import "tailwindcss"', () => {
    expect(tw4.detect(repo({ 'b.css': 'body{}' }), { dir: 'design' })).toBe(null)
    const r = repo({ 'a.css': '@import "tailwindcss";', 'old.css': '@tailwind base;' })
    expect(tw4.detect(r, { dir: 'design', css: 'old.css' })).toBe(null)
  })
  it('exit 4 for several files, exit 6 without the package', () => {
    expect(code(() => tw4.detect(repo({ 'a.css': '@import "tailwindcss";', 'b.css': "@import 'tailwindcss';" }), { dir: 'design' }))).toBe(4)
    expect(code(() => tw4.detect(repo({ 'a.css': '@import "tailwindcss";' }, {}), { dir: 'design' }))).toBe(6)
  })
})

it('themeTokens: @theme names, class forms with the import prefix, kinds', () => {
  const t = themeTokens('@import "tailwindcss" prefix(ui);\n@theme inline { --color-primary: var(--primary); --font-sans: Inter, sans-serif; --radius-card: 12px; --color-*: initial; --breakpoint-md: 48rem }')
  expect(t.prefix).toBe('ui:')
  expect(t.list).toEqual([
    { kind: 'color', name: '--color-primary', value: 'var(--primary)', use: 'ui:bg-primary ui:text-primary', source: 'theme' },
    { kind: 'font', name: '--font-sans', value: 'Inter, sans-serif', use: 'ui:font-sans', source: 'theme' },
    { kind: 'length', name: '--radius-card', value: '12px', use: 'ui:rounded-card', source: 'theme' },
    { kind: 'length', name: '--breakpoint-md', value: '48rem', use: '', source: 'theme' },
  ])
  expect(themeTokens('@import "tailwindcss";\n@theme { --color-x: #1 }').prefix).toBe(null)
})

it('installs, ready, ownSheet, mustBuild, watchDirs', () => {
  const r = repo({ 'src/a.css': '@import "tailwindcss";' })
  const cfg = { css: 'src/a.css', tailwindVersion: '4.1.18', themeVars: [] }
  expect(tw4.installs(r, cfg)).toEqual([{ dir: join('tailwind', '4.1.18'), pkgs: ['@tailwindcss/postcss@4.1.18', 'postcss@8'] }])
  const withPostcss = repo({ 'src/a.css': '@import "tailwindcss";' }, { tailwindcss: '4.1.18', '@tailwindcss/postcss': '4.1.18' })
  expect(tw4.installs(withPostcss, cfg)).toEqual([])
  expect(tw4.ready()).toBe(null)
  expect(tw4.ownSheet('/*! tailwindcss v4.1.18 | MIT License */', cfg)).toBe(true)
  expect(tw4.ownSheet('.lib{}', cfg)).toBe(false)
  expect(tw4.mustBuild('p-4')).toBe(false)
  const [w] = tw4.watchDirs('/p', cfg)
  expect([w.dir, w.recursive, w.match('/p/src/x.css'), w.match('/p/src/x.ts')]).toEqual(['/p/src', true, true, false])
})
