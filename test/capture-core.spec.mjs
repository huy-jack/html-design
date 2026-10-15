import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { processCapture } from '../plugin/scripts/capture-core.mjs'
import { DEFAULTS } from '../plugin/scripts/config.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'

const cfg = { ...DEFAULTS, css: 'app.css', themeVars: ['--color-brand'] }
let r
beforeEach(() => {
  r = mkdtempSync(join(tmpdir(), 'cc-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n')
  makeSkeleton(r, cfg)
})
const base = (over = {}) => ({ root: r, cfg, screen: 'Checkout', state: 'empty', width: 1440,
  clean: { html: '<img src="__asset__0"><p class="text-brand">Empty</p>', htmlClass: 'font-x', bodyClass: '', lang: 'en', assets: [{ url: 'http://h/a.png', ref: '__asset__0' }], remote: [], warnings: [] },
  sheetTexts: [{ href: null, text: ':root{--color-brand:#1}' }, { href: 'http://h/lib.css', text: '@font-face{font-family:F;src:url(/f.woff2)} .lib{--tw-x:1;background:url(/bg.png)}' }],
  files: new Map([['http://h/a.png', Buffer.from('png')], ['http://h/f.woff2', Buffer.from('font')], ['http://h/bg.png', Buffer.from('bg')]]), ...over })

describe('processCapture', () => {
  it('writes a base state, assets, fonts, page css; drops the project sheet', () => {
    const out = processCapture(base())
    expect(out).toMatchObject({ status: 201, kind: 'base', images: 1 })
    const page = readFileSync(join(r, 'design/page.css'), 'utf8')
    expect(page).toContain('.lib'); expect(page).not.toContain('--color-brand'); expect(page).toMatch(/url\(\.\/assets\/[0-9a-f]{12}\.png\)/)
    expect(readFileSync(join(r, 'design/fonts.css'), 'utf8')).toContain('data:font/woff2;base64,')
    expect(readFileSync(join(r, 'design/screens/checkout.html'), 'utf8')).toMatch(/assets\/[0-9a-f]{12}\.png/)
  })
  it('same id same width → 409 without replace; replace → 201', () => {
    processCapture(base()); expect(processCapture(base()).status).toBe(409)
    expect(processCapture(base({ replace: true })).status).toBe(201)
  })
  it('css style keeps every sheet, even one that looks like Tailwind output', () => {
    const out = processCapture(base({ cfg: { ...DEFAULTS, style: 'css', css: null }, sheetTexts: [{ href: null, text: '/*! tailwindcss v4.1.18 */ :root{--color-brand:#1}' }] }))
    expect(out.status).toBe(201)
    expect(readFileSync(join(r, 'design/page.css'), 'utf8')).toContain('--color-brand')
  })
  it('same id other width: width copy only when different', () => {
    processCapture(base())
    expect(processCapture(base({ width: 375 })).kind).toBe('same-as-base')
    expect(processCapture(base({ width: 375, clean: { ...base().clean, html: '<p>phone</p>', assets: [] } })).kind).toBe('width-copy')
  })
  it('no @theme: drops the app sheet by its exact tailwind banner (D2)', () => {
    processCapture(base({ cfg: { ...cfg, themeVars: [], tailwindVersion: '4.3.3' }, sheetTexts: [{ href: null, text: '/*! tailwindcss v4.3.3 */ .app-only{color:red}' }, { href: 'http://h/lib.css', text: '/*! tailwindcss v4.1.0 */ .lib{--tw-x:1}' }] }))
    const page = readFileSync(join(r, 'design/page.css'), 'utf8')
    expect(page).not.toContain('.app-only'); expect(page).toContain('.lib')
  })
  it('view-only mode keeps every sheet', () => {
    processCapture(base({ cfg: { ...cfg, css: null, themeVars: [] } }))
    expect(readFileSync(join(r, 'design/page.css'), 'utf8')).toContain('--color-brand')
  })
  it('replaces every url() occurrence and warns on a missing download', () => {
    const t = '.a{background:url(/bg.png)} .b{background:url("/bg.png")} .c{background:url(/gone.png)}'
    const out = processCapture(base({ sheetTexts: [{ href: 'http://h/lib.css', text: t }] }))
    const page = readFileSync(join(r, 'design/page.css'), 'utf8')
    expect(page.match(/url\(\.\/assets\/[0-9a-f]{12}\.png\)/g)).toHaveLength(2)
    expect(page).toContain('url(/gone.png)')
    expect(out.warnings.join()).toContain('http://h/gone.png')
  })
  const snap = () => JSON.stringify(['assets', 'screens', ''].map((sub) => readdirSync(join(r, 'design', sub)).sort())) + ['page.css', 'fonts.css', 'screens/checkout.html'].map((f) => readFileSync(join(r, 'design', f), 'utf8')).join('|')
  it('a 409 changes nothing on disk', () => {
    processCapture(base())
    const before = snap()
    const out = processCapture(base({ sheetTexts: [{ href: 'http://h/o.css', text: '@font-face{font-family:G;src:url(/f.woff2)} .other{background:url(/bg.png)}' }], files: new Map([['http://h/a.png', Buffer.from('new')], ['http://h/f.woff2', Buffer.from('font')], ['http://h/bg.png', Buffer.from('bg')]]) }))
    expect(out.status).toBe(409)
    expect(snap()).toBe(before)
  })
  it('a same-as-base copy leaves design/ unchanged, even with new sheets and fonts on the page', () => {
    processCapture(base())
    const snap = () => {
      const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [[join(d, e.name), readFileSync(join(d, e.name), 'utf8')]]))
      return Object.fromEntries(walk(join(r, 'design')))
    }
    const before = snap()
    const out = processCapture(base({
      width: 375,
      sheetTexts: [{ href: 'http://h/m.css', text: '@font-face{font-family:M;src:url(/m.woff2)} .mobile-only{background:url(/m.png)}' }],
      files: new Map([...base().files, ['http://h/m.woff2', Buffer.from('mfont')], ['http://h/m.png', Buffer.from('m')]]),
    }))
    expect(out.kind).toBe('same-as-base')
    expect(snap()).toEqual(before)
  })
  it('same-as-base drops the old variant for that width', () => {
    processCapture(base())
    processCapture(base({ width: 375, clean: { ...base().clean, html: '<p>phone</p>', assets: [] } }))
    expect(readFileSync(join(r, 'design/screens/checkout.html'), 'utf8')).toContain('data-variant-of')
    expect(processCapture(base({ width: 375 })).kind).toBe('same-as-base')
    expect(readFileSync(join(r, 'design/screens/checkout.html'), 'utf8')).not.toContain('data-variant-of')
  })
  it('view-only mode still writes fonts.css', () => {
    processCapture(base({ cfg: { ...cfg, css: null, themeVars: [] } }))
    expect(readFileSync(join(r, 'design/fonts.css'), 'utf8')).toContain('data:font/woff2;base64,')
  })
  it('replace at another width is a width copy, not a base overwrite', () => {
    processCapture(base())
    const out = processCapture(base({ width: 375, replace: true, clean: { ...base().clean, html: '<p>phone</p>', assets: [] } }))
    expect(out.kind).toBe('width-copy')
    const text = readFileSync(join(r, 'design/screens/checkout.html'), 'utf8')
    expect(text).toContain('Empty'); expect(text).toContain('phone')
  })
})

describe('fonts bundled inside the project sheet (Next.js puts next/font CSS in the Tailwind chunk)', () => {
  it('keeps @font-face and the html/body class rules, drops the rest', () => {
    const project = '/*! tailwindcss v4.1.18 */ :root{--color-brand:#1} .p-4{padding:1rem} '
      + '@font-face{font-family:Inter;src:url(/f.woff2)} '
      + '.__variable_abc{--font-inter:"Inter"} .__className_x{font-family:Inter} .other-class{color:red}'
    const out = processCapture(base({
      clean: { ...base().clean, htmlClass: '__variable_abc font-x', bodyClass: '__className_x' },
      sheetTexts: [{ href: 'http://h/app.css', text: project }],
    }))
    expect(out.status).toBe(201)
    const fonts = readFileSync(join(r, 'design/fonts.css'), 'utf8')
    const page = readFileSync(join(r, 'design/page.css'), 'utf8')
    expect(fonts).toContain('font-family:Inter')
    expect(fonts).toContain('data:font/woff2;base64,')
    expect(page).toContain('.__variable_abc{--font-inter:"Inter"}')
    expect(page).toContain('.__className_x{font-family:Inter}')
    expect(page).not.toContain('.p-4')
    expect(page).not.toContain('.other-class')
    expect(page).not.toContain('--color-brand')
  })
})
