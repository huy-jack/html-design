import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DEFAULTS, darkMarker, readConfig, writeConfig } from '../plugin/scripts/config.mjs'
it('round-trips with defaults', () => {
  const r = mkdtempSync(join(tmpdir(), 'c-'))
  writeConfig(r, { css: 'src/index.css', url: 'http://localhost:5173' })
  const c = readConfig(r)
  expect(c.widths).toEqual([1440, 1024, 375]); expect(c.dir).toBe('design'); expect(c.css).toBe('src/index.css')
})
it('throws without a file', () => expect(() => readConfig(mkdtempSync(join(tmpdir(), 'c-')))).toThrow('run /html-design setup'))
it('parses dark markers', () => {
  expect(darkMarker('.dark')).toEqual({ kind: 'class', name: 'dark' })
  expect(darkMarker('[data-theme=dark]')).toEqual({ kind: 'attr', name: 'data-theme', value: 'dark' })
  expect(DEFAULTS.browser).toBe('chromium')
  expect(DEFAULTS.tailwindVersion).toBe(null)
})
it('names the file and the parse error when design-mode.json is broken', () => {
  const r = mkdtempSync(join(tmpdir(), 'c-'))
  writeFileSync(join(r, 'design-mode.json'), '{ "dir": ')
  expect(() => readConfig(r)).toThrow(/design-mode\.json is not valid JSON: .+/)
})
