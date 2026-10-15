import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import tw3, { configTokens, loadTwConfig, mapDarkMode } from '../plugin/scripts/styles/tw3.mjs'
import { makeData } from './helpers/data.mjs'
import { TW3_DIR, TW3_MODULES } from './helpers/tw3.mjs'

const code = (fn) => { try { fn(); return null } catch (e) { return e.code } }
const msg = (fn) => { try { fn(); return null } catch (e) { return e.message } }
const flags = { dir: 'design' }
function project({ link = true } = {}) {
  const r = mkdtempSync(join(tmpdir(), 'tw3-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  cpSync(join(TW3_DIR, 'tailwind.config.ts'), join(r, 'tailwind.config.ts'))
  cpSync(join(TW3_DIR, 'src'), join(r, 'src'), { recursive: true })
  if (link) symlinkSync(TW3_MODULES, join(r, 'node_modules'))
  execFileSync('git', ['add', 'tailwind.config.ts', 'src'], { cwd: r })
  return r
}
const fakeTailwind = (r, version) => {
  mkdirSync(join(r, 'node_modules/tailwindcss'), { recursive: true })
  writeFileSync(join(r, 'node_modules/tailwindcss/package.json'), JSON.stringify({ version }))
}

describe('tw3 detect', () => {
  it('finds the config and the @tailwind file; darkMode media becomes .dark with a warning', () => {
    const out = tw3.detect(project(), flags)
    expect(out).toMatchObject({ css: 'src/styles.css', twConfig: 'tailwind.config.ts', themeVars: [], tailwindVersion: '3.4.17', dark: '.dark' })
    expect(out.warnings[0]).toMatch(/darkMode "media" is rebuilt as the class \.dark/)
  })
  it('null without a config', () => {
    const r = mkdtempSync(join(tmpdir(), 'tw3-'))
    execFileSync('git', ['init', '-q'], { cwd: r })
    expect(tw3.detect(r, flags)).toBe(null)
  })
  it('exit 4 for several configs (--tw-config picks one) and for no or several CSS files', () => {
    const r = project()
    mkdirSync(join(r, 'apps/b'), { recursive: true })
    writeFileSync(join(r, 'apps/b/tailwind.config.js'), 'module.exports = {}')
    execFileSync('git', ['add', 'apps'], { cwd: r })
    expect(code(() => tw3.detect(r, flags))).toBe(4)
    expect(tw3.detect(r, { ...flags, twConfig: 'tailwind.config.ts' }).twConfig).toBe('tailwind.config.ts')
    const n = project()
    execFileSync('git', ['rm', '-q', '--cached', 'src/styles.css'], { cwd: n })
    expect(msg(() => tw3.detect(n, flags))).toMatch(/No CSS file with @tailwind/)
    writeFileSync(join(n, 'src/a.css'), '@tailwind base;'); writeFileSync(join(n, 'src/b.css'), '@tailwind utilities;')
    execFileSync('git', ['add', 'src'], { cwd: n })
    expect(code(() => tw3.detect(n, flags))).toBe(4)
  })
  it('--css must have @tailwind lines; both exit-4 CSS messages name --style css (final review I2)', () => {
    const r = project()
    writeFileSync(join(r, 'src/plain.css'), '.a { color: red; }')
    execFileSync('git', ['add', 'src/plain.css'], { cwd: r })
    expect(code(() => tw3.detect(r, { ...flags, css: 'src/plain.css' }))).toBe(4)
    expect(msg(() => tw3.detect(r, { ...flags, css: 'src/plain.css' }))).toMatch(/--style css/)
    const n = project()
    execFileSync('git', ['rm', '-q', '--cached', 'src/styles.css'], { cwd: n })
    expect(msg(() => tw3.detect(n, flags))).toMatch(/--style css/)
  })
  it('setup warns when the CSS file has no @tailwind base (final review I3)', () => {
    const r = project()
    writeFileSync(join(r, 'src/styles.css'), '@tailwind utilities;')
    expect(tw3.detect(r, flags).warnings.some((w) => /@tailwind base/.test(w))).toBe(true)
    expect(tw3.detect(project(), flags).warnings.some((w) => /@tailwind base/.test(w))).toBe(false)
  })
  it('exit 6 without tailwindcss (naming --style css), exit 7 below 3.3, null for a v4 package', () => {
    const r = project({ link: false })
    expect(code(() => tw3.detect(r, flags))).toBe(6)
    expect(msg(() => tw3.detect(r, flags))).toMatch(/--style css/)
    fakeTailwind(r, '3.2.7')
    expect(code(() => tw3.detect(r, flags))).toBe(7)
    fakeTailwind(r, '4.1.18')
    expect(tw3.detect(r, flags)).toBe(null)
  })
})

it('mapDarkMode', () => {
  expect(mapDarkMode('class')).toEqual({ dark: '.dark', warning: null })
  expect(mapDarkMode('selector').dark).toBe('.dark')
  expect(mapDarkMode(['class', '[data-mode="dark"]'])).toEqual({ dark: '[data-mode=dark]', warning: null })
  expect(mapDarkMode(['selector', '.night'])).toEqual({ dark: '.night', warning: null })
  expect(mapDarkMode('media').warning).toMatch(/media/)
  expect(mapDarkMode(undefined)).toEqual({ dark: '.dark', warning: expect.stringMatching(/media/) })
})

it('loadTwConfig unwraps a module namespace (Tailwind 3.3.0 with a .ts config)', () => {
  expect(loadTwConfig('/x/tailwind.config.ts', () => () => ({ __esModule: true, default: { darkMode: 'class' } }))).toEqual({ darkMode: 'class' })
  expect(loadTwConfig('/x/tailwind.config.js', () => () => ({ darkMode: 'media' }))).toEqual({ darkMode: 'media' })
})

it('configTokens: own theme flattened, prefix applied, defaults note', () => {
  const t = configTokens({ prefix: 'tw-', theme: { extend: { colors: { brand: { DEFAULT: '#123456', light: '#abcdef' } }, borderRadius: { card: '12px' } } } })
  expect(t.prefix).toBe('tw-')
  expect(t.list).toEqual([
    { kind: 'color', name: 'brand', value: '#123456', use: 'tw-bg-brand tw-text-brand', source: 'config' },
    { kind: 'color', name: 'brand-light', value: '#abcdef', use: 'tw-bg-brand-light tw-text-brand-light', source: 'config' },
    { kind: 'length', name: 'card', value: '12px', use: 'tw-rounded-card', source: 'config' },
  ])
  expect(t.notes).toEqual(['Tailwind 3 defaults: colors kept.'])
  expect(configTokens({ theme: { colors: { ink: '#000' } } }).notes).toEqual(['Tailwind 3 defaults: colors replaced by the config.'])
})

describe('tw3 build', () => {
  const cfg = { dir: 'design', css: 'src/styles.css', twConfig: 'tailwind.config.ts', dark: '.dark', tailwindVersion: '3.4.17', themeVars: [] }
  const withClasses = (r, classes) => { mkdirSync(join(r, 'design/.local'), { recursive: true }); writeFileSync(join(r, 'design/.local/screens-classes.txt'), classes); return r }
  it('app CSS + app config, content replaced by the screens, dark as a class', async () => {
    const out = await tw3.build(withClasses(project(), 'bg-brand mt-7 dark:text-brand'), cfg, makeData({ tw3: true }))
    expect(out).toMatch(/tailwindcss v3\.4\.17/)
    expect(out).toContain('.mt-7')
    expect(out).toContain('18 52 86')
    expect(out).toContain('.app-card')
    expect(out).toMatch(/\.dark\\:text-brand:is\(\.dark \*\)/)
    expect(out).not.toMatch(/\.p-4\s*\{/)
  }, 60000)
  it('own sheet without preflight: the Tailwind 3 defaults block marks it, not the banner (final review I3)', async () => {
    const r = withClasses(project(), 'p-6')
    writeFileSync(join(r, 'tailwind.config.cjs'), 'module.exports = { content: [], corePlugins: { preflight: false } }')
    const out = await tw3.build(r, { ...cfg, twConfig: 'tailwind.config.cjs' }, makeData({ tw3: true }))
    expect(out).not.toMatch(/tailwindcss v3/)
    expect(tw3.ownSheet(out, cfg)).toBe(true)
    expect(tw3.ownSheet('*,:after,:before{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0}', cfg)).toBe(true)
    expect(tw3.ownSheet('.lib{--tw-border-spacing-x:0.5rem;--tw-border-spacing-y:0.5rem}', cfg)).toBe(false)
  }, 60000)
  it('a config plugin that is not installed: rejects with Cannot find module (Review Focus 3)', async () => {
    const r = withClasses(project(), '')
    writeFileSync(join(r, 'tailwind.config.cjs'), "module.exports = { content: [], plugins: [require('@acme/not-installed')] }")
    await expect(tw3.build(r, { ...cfg, twConfig: 'tailwind.config.cjs' }, makeData({ tw3: true }))).rejects.toThrow(/Cannot find module/)
  })
  it('ready: postcss-import from the data folder or the project, else run setup', () => {
    expect(tw3.ready(makeData({ tw3: true }), cfg, project({ link: false }))).toBe(null)
    expect(tw3.ready(makeData(), cfg, project({ link: false }))).toBe('Run /html-design setup again')
  })
  it('tokens, installs, ownSheet, watchDirs, designCss', () => {
    const t = tw3.tokens(project(), cfg)
    expect(t.list.map((x) => x.name)).toEqual(['brand', 'brand-light'])
    expect(tw3.installs()).toEqual([{ dir: 'tw3', pkgs: ['postcss-import@16.1.0', 'postcss@8'] }])
    expect(tw3.ownSheet('/*! tailwindcss v3.4.17 | MIT License */', cfg)).toBe(true)
    expect(tw3.ownSheet('/*! tailwindcss v3.4.16 */', cfg)).toBe(false)
    expect(tw3.mustBuild('p-4')).toBe(false)
    const w = tw3.watchDirs('/p', cfg)
    expect(w.map((x) => [x.dir, x.recursive])).toEqual([['/p/src', true], ['/p', false]])
    expect([w[1].match('/p/tailwind.config.ts'), w[1].match('/p/other.ts')]).toEqual([true, false])
    expect(tw3.designCss('/p', cfg)).toMatch(/src\/styles\.css/)
  })
})
