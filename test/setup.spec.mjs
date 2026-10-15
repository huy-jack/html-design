import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { designCss, detectDark, findCssEntries, findPackage, makeSkeleton, themeVars } from '../plugin/scripts/setup.mjs'

const repo = () => { const r = mkdtempSync(join(tmpdir(), 's-')); execFileSync('git', ['init', '-q'], { cwd: r }); return r }
const put = (r, p, t) => { mkdirSync(join(r, p, '..'), { recursive: true }); writeFileSync(join(r, p), t) }

describe('findCssEntries', () => {
  it('ignores untracked worktree copies (Review Focus 4)', () => {
    const r = repo()
    put(r, 'apps/web/src/app/globals.css', '@import "tailwindcss";')
    put(r, '.worktrees/x/apps/web/src/app/globals.css', '@import "tailwindcss";')
    put(r, '.gitignore', '.worktrees/\n')
    execFileSync('git', ['add', 'apps', '.gitignore'], { cwd: r })
    expect(findCssEntries(r)).toEqual(['apps/web/src/app/globals.css'])
  })
  it('accepts single quotes and returns [] for none', () => {
    const r = repo(); put(r, 'a.css', "@import 'tailwindcss' source(none);"); put(r, 'b.css', 'body{}')
    execFileSync('git', ['add', '.'], { cwd: r })
    expect(findCssEntries(r)).toEqual(['a.css'])
  })
})
it('detects dark', () => {
  expect(detectDark('@custom-variant dark (&:where(.dark, .dark *));')).toBe('.dark')
  expect(detectDark('@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));')).toBe('[data-theme=dark]')
  expect(detectDark('@theme {}')).toBe(null)
})
it('reads theme vars', () => {
  expect(themeVars('@theme inline { --color-primary: #754aa1; --radius-card: 12px; --font-sans: x; --color-x: y; }')).toEqual(['--color-primary', '--radius-card', '--font-sans', '--color-x'])
  expect(themeVars('@theme { --font-display: x; --breakpoint-md: 48rem; --breakpoint-laptop: 64rem; --a: 1; --b: 2; --c: 3; --d: 4; --e: 5; }')).toEqual(['--font-display', '--a', '--b', '--c', '--d'])
})
it('design.css adds a class dark variant when the project has none', () => {
  const css = designCss({ cssRel: '../src/index.css', dark: null })
  expect(css).toContain('@custom-variant dark (&:where(.dark, .dark *));')
  expect(css).toContain("@source './.local/screens-classes.txt';")
  expect(designCss({ cssRel: '../src/index.css', dark: '.dark' })).not.toContain('@custom-variant')
})
it('skeleton writes folders, ignore file, switcher', () => {
  const r = repo()
  put(r, 'src/index.css', '@import "tailwindcss";')
  makeSkeleton(r, { dir: 'design', css: 'src/index.css', dark: '.dark', widths: [1440, 1024, 375] }, join(process.cwd(), 'plugin'))
  for (const p of ['design/screens', 'design/assets', 'design/switcher.js', 'design/design.css', 'design/README.md', 'design/page.css', 'design/fonts.css']) expect(existsSync(join(r, p))).toBe(true)
  expect(readFileSync(join(r, 'design/.gitignore'), 'utf8')).toContain('.local/')
})

describe('CLI exits before any npm call', () => {
  const run = (r, args = []) => {
    const bin = mkdtempSync(join(tmpdir(), 'bin-')); const log = join(bin, 'log')
    writeFileSync(join(bin, 'npm'), `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 })
    writeFileSync(log, '')
    let status = 0
    try { execFileSync('node', [join(process.cwd(), 'plugin/scripts/setup.mjs'), '--data', mkdtempSync(join(tmpdir(), 'data-')), ...args], { cwd: r, stdio: 'pipe', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }) } catch (e) { status = e.status }
    return { status, calls: readFileSync(log, 'utf8') }
  }
  it('exit 4 on several Tailwind files, 0 npm calls', () => {
    const r = repo(); put(r, 'a.css', '@import "tailwindcss";'); put(r, 'b.css', '@import "tailwindcss";')
    execFileSync('git', ['add', '.'], { cwd: r })
    expect(run(r)).toEqual({ status: 4, calls: '' })
  })
  it('exit 5 on a foreign design/ folder, 0 npm calls', () => {
    const r = repo(); put(r, 'design/other.txt', 'x')
    expect(run(r)).toEqual({ status: 5, calls: '' })
  })
  // The repo sits under a parent that does hold tailwindcss: setup searches only inside the project,
  // so the parent copy must not count, whatever exists above tmpdir.
  it('exit 6 when tailwindcss is not installed, 0 npm calls', () => {
    const outer = mkdtempSync(join(tmpdir(), 'outer-'))
    put(outer, 'node_modules/tailwindcss/package.json', '{"name":"tailwindcss","version":"4.0.0"}')
    const r = join(outer, 'proj'); mkdirSync(r); execFileSync('git', ['init', '-q'], { cwd: r })
    put(r, 'a.css', '@import "tailwindcss";')
    execFileSync('git', ['add', '.'], { cwd: r })
    expect(run(r)).toEqual({ status: 6, calls: '' })
  })

})

describe('findPackage', () => {
  it('walks up to the root and stops there', () => {
    const outer = mkdtempSync(join(tmpdir(), 'fp-'))
    put(outer, 'node_modules/zz/package.json', '{}')
    put(outer, 'proj/node_modules/yy/package.json', '{}')
    mkdirSync(join(outer, 'proj/src/app'), { recursive: true })
    const root = join(outer, 'proj')
    expect(findPackage('yy', join(root, 'src/app'), root)).toBe(join(root, 'node_modules/yy/package.json'))
    expect(findPackage('zz', join(root, 'src/app'), root)).toBe(null)
  })
})

it('view-only CLI: no Tailwind file gives css null, a warning on stderr, exit 0', () => {
  const r = repo(); put(r, 'b.css', 'body{}'); execFileSync('git', ['add', '.'], { cwd: r })
  const p = spawnSync('node', [join(process.cwd(), 'plugin/scripts/setup.mjs'), '--data', mkdtempSync(join(tmpdir(), 'data-')), '--skip-install'], { cwd: r, encoding: 'utf8' })
  expect(p.status).toBe(0)
  const out = JSON.parse(p.stdout.trim())
  expect(out.css).toBe(null)
  expect(out.viewOnly).toBe(true)
  expect(p.stderr).toMatch(/View-only mode/)
  expect(existsSync(join(r, 'design/design.css'))).toBe(true)
})
