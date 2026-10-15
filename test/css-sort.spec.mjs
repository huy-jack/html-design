import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { appendUnique, cssUrls, isProjectSheet, splitFontFaces } from '../plugin/scripts/css-sort.mjs'
const vars = ['--color-primary', '--radius-card']
it('project sheet: any one recorded theme var (Review Focus 2)', () => {
  const o = { themeVars: vars, tailwindVersion: null }
  expect(isProjectSheet('@layer theme{:root{--color-primary:#000;--radius-card:4px}}', o)).toBe(true)
  expect(isProjectSheet('@layer theme{:root{--color-primary:#000}}', o)).toBe(true)
  expect(isProjectSheet('@layer theme{:root{--tw-shadow:0}} .btn{--tw-ring:1}', o)).toBe(false)
  expect(isProjectSheet('.x{}', { themeVars: [], tailwindVersion: null })).toBe(false)
})
it('D1: Monorepo vars with breakpoints match on the font var', () => {
  const o = { themeVars: ['--font-display', '--color-primary'], tailwindVersion: null }
  expect(isProjectSheet('/*! tailwindcss v4.1.18 */ :root{--font-display:x} @media (width>=48rem){.md\\:flex{display:flex}}', o)).toBe(true)
})
it('D2: no @theme, the exact version banner matches', () => {
  const o = { themeVars: [], tailwindVersion: '4.3.3' }
  expect(isProjectSheet('/*! tailwindcss v4.3.3 | MIT License */ :root{--tw-x:1}', o)).toBe(true)
})
it('a library with --tw- and a different banner version is kept', () => {
  const o = { themeVars: ['--color-brand'], tailwindVersion: '4.3.3' }
  expect(isProjectSheet('/*! tailwindcss v4.1.0 */ .lib{--tw-ring:1}', o)).toBe(false)
  expect(isProjectSheet('/*! tailwindcss v4.3.30 */ .lib{--tw-ring:1}', o)).toBe(false)
})
it('a var name does not match a longer name', () => {
  const o = { themeVars: ['--color-brand'], tailwindVersion: null }
  expect(isProjectSheet(':root{--color-brand-2:#000}', o)).toBe(false)
  expect(isProjectSheet(':root{--x--color-brand:#000}', o)).toBe(false)
})
it('splits font faces', () => {
  const r = splitFontFaces('@font-face{font-family:A;src:url(/a.woff2)} .x{color:red}')
  expect(r.faces).toHaveLength(1); expect(r.rest.trim()).toBe('.x{color:red}')
})
it('finds url() targets, absolute', () => {
  expect(cssUrls('.a{background:url("/i.png")} .b{background:url(data:x)}', 'http://h/c/s.css')).toEqual(['http://h/i.png'])
})
it('appends once per content', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'a-')), 'page.css'); writeFileSync(f, '')
  expect(appendUnique(f, '.x{}')).toBe(true); expect(appendUnique(f, '.x{}')).toBe(false)
  expect(readFileSync(f, 'utf8').match(/hd:/g)).toHaveLength(1)
})
it('cssUrls: spaces inside url(), uppercase URL(, http(s) only', () => {
  const css = '.a{background:url( "/a.png" )} .b{background:URL(  /b.png )} .c{background:Url(\'c.png\')} .d{background:url(blob:http://h/x)} .e{background:url(  data:image/png;base64,AA== )} .f{mask:url(#m)}'
  expect(cssUrls(css, 'http://h/c/s.css')).toEqual(['http://h/a.png', 'http://h/b.png', 'http://h/c/c.png'])
  expect(cssUrls('.x{background:url(ftp://h/a.png)}', 'http://h/')).toEqual([])
})
it('appendUnique creates a missing file', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'a-')), 'fonts.css')
  expect(appendUnique(f, '.y{}')).toBe(true)
  expect(readFileSync(f, 'utf8')).toContain('.y{}')
})
