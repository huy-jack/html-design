import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DEFAULTS, writeConfig } from '../plugin/scripts/config.mjs'
import { formatTokens, knownVars } from '../plugin/scripts/tokens.mjs'
import { makeData } from './helpers/data.mjs'

it('formatTokens: style line, one row per token, notes, sources', () => {
  const out = formatTokens('css', { prefix: 'tw:', list: [{ kind: 'color', name: '--brand', value: '#2563eb', use: 'tw:bg-(--brand) tw:text-(--brand)', source: 'app CSS' }, { kind: 'length', name: '--radius', value: '8px', use: 'tw:*-(--radius)', source: 'page.css' }], notes: ['No palette.'] }).split('\n')
  expect(out[0]).toBe('style: css  prefix: tw:')
  expect(out[1]).toMatch(/^color\s+--brand\s+#2563eb\s+tw:bg-\(--brand\) tw:text-\(--brand\)$/)
  expect(out.at(-2)).toBe('No palette.')
  expect(out.at(-1)).toBe('sources: 1 from app CSS, 1 from page.css')
  expect(formatTokens('tw4', { prefix: null, list: [], notes: [] })).toBe('style: tw4\nsources: no tokens yet')
})

it('knownVars: tw4 @theme names plus :root vars from app CSS and page.css', () => {
  const r = mkdtempSync(join(tmpdir(), 'kv-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n:root { --background: #fff }\n@theme inline { --color-background: var(--background) }')
  execFileSync('git', ['add', 'app.css'], { cwd: r })
  mkdirSync(join(r, 'design'))
  writeFileSync(join(r, 'design/page.css'), ':root{--lib-gap:2px}')
  expect([...knownVars(r, { ...DEFAULTS, css: 'app.css' })].sort()).toEqual(['--background', '--color-background', '--lib-gap'])
})

it('CLI lists css tokens that a copy wrote to page.css (Review Focus 4)', () => {
  const r = mkdtempSync(join(tmpdir(), 'tk-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  writeConfig(r, {})
  mkdirSync(join(r, 'design'))
  writeFileSync(join(r, 'design/page.css'), ':root{--brand:#123}')
  const p = spawnSync(process.execPath, [join(import.meta.dirname, '../plugin/scripts/tokens.mjs'), '--data', makeData()], { cwd: r, encoding: 'utf8' })
  expect(p.status).toBe(0)
  expect(p.stdout).toMatch(/^style: css  prefix: tw:/)
  expect(p.stdout).toContain('--brand')
  expect(p.stdout).toContain('1 from page.css')
})
