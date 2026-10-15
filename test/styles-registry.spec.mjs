import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adapterFor, detectStyle, styleName } from '../plugin/scripts/styles/index.mjs'
import { TW3_MODULES } from './helpers/tw3.mjs'

const code = (fn) => { try { fn(); return null } catch (e) { return e.code } }
function repo(files) {
  const r = mkdtempSync(join(tmpdir(), 'reg-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  for (const [p, t] of Object.entries(files)) { mkdirSync(join(r, p, '..'), { recursive: true }); writeFileSync(join(r, p), t) }
  execFileSync('git', ['add', '.'], { cwd: r })
  return r
}

it('styleName: the config key wins; old configs map by css', () => {
  expect(styleName({ style: 'tw3', css: 'a.css' })).toBe('tw3')
  expect(styleName({ style: null, css: 'a.css' })).toBe('tw4')
  expect(styleName({ css: null })).toBe('css')
  expect(adapterFor({ css: null }).name).toBe('css')
})
it('adapterFor names design-mode.json for an unknown style', () => expect(() => adapterFor({ style: 'sass' })).toThrow(/design-mode\.json/))

describe('detectStyle', () => {
  it('falls back to css; a bad --style is exit 2; a forced style with nothing found is exit 4', () => {
    const r = repo({ 'a.css': 'body{}' })
    expect(detectStyle(r, { dir: 'design' }).style).toBe('css')
    expect(code(() => detectStyle(r, { dir: 'design', style: 'sass' }))).toBe(2)
    expect(code(() => detectStyle(r, { dir: 'design', style: 'tw3' }))).toBe(4)
  })
  it('leftover config in a plain-CSS app: exit 6 naming --style css; --style css works (Review Focus 1)', () => {
    const r = repo({ 'tailwind.config.js': 'module.exports = {}', 'app.css': ':root{--a:1}' })
    expect(code(() => detectStyle(r, { dir: 'design' }))).toBe(6)
    expect(detectStyle(r, { dir: 'design', style: 'css' }).style).toBe('css')
  })
  it('monorepo with Tailwind 4 and Tailwind 3 apps: tw4 by default, flags pick tw3 (Review Focus 2)', () => {
    const r = repo({
      'apps/new/app.css': '@import "tailwindcss";',
      'apps/new/node_modules/tailwindcss/package.json': '{"version":"4.1.18"}',
      'apps/old/tailwind.config.js': "module.exports = { content: [], darkMode: 'class' }",
      'apps/old/src/styles.css': '@tailwind base;\n@tailwind utilities;',
    })
    symlinkSync(TW3_MODULES, join(r, 'apps/old/node_modules'))
    expect(detectStyle(r, { dir: 'design' }).style).toBe('tw4')
    const tw3 = detectStyle(r, { dir: 'design', style: 'tw3', css: 'apps/old/src/styles.css', twConfig: 'apps/old/tailwind.config.js' })
    expect([tw3.style, tw3.css, tw3.twConfig, tw3.dark]).toEqual(['tw3', 'apps/old/src/styles.css', 'apps/old/tailwind.config.js', '.dark'])
  })
})
