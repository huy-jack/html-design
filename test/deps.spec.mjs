import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dataPaths, loadDep, loadDepDataFirst, parseDataArg } from '../plugin/scripts/deps.mjs'

const fakePkg = (dir, name) => {
  mkdirSync(join(dir, 'node_modules', name), { recursive: true })
  writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
  writeFileSync(join(dir, 'node_modules', name, 'index.js'), `module.exports = { from: ${JSON.stringify(dir)} }`)
}
describe('loadDep', () => {
  it('prefers the project folder, walking up', () => {
    const proj = mkdtempSync(join(tmpdir(), 'p-')); fakePkg(proj, 'zz-dep')
    const deep = join(proj, 'a', 'b'); mkdirSync(deep, { recursive: true })
    expect(loadDep(null, 'zz-dep', deep).from).toBe(proj)
  })
  // A fresh root with an explicit fromDir inside it: nothing above tmpdir can change the answer,
  // because the names are unique per run.
  it('falls back to the data folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-')); const from = join(root, 'proj'); mkdirSync(from)
    const name = `zz-dep2-${process.pid}-${Date.now()}`
    const data = join(root, 'data'); fakePkg(data, name)
    expect(loadDep(data, name, from).from).toBe(data)
  })
  it('names setup when missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-'))
    expect(() => loadDep(null, `zz-nope-${process.pid}-${Date.now()}`, root)).toThrow('run /html-design setup')
  })
  it('parses --data', () => {
    expect(parseDataArg(['--data', '/x', 'start'])).toBe('/x')
    expect(dataPaths('/x').profiles).toBe('/x/profiles')
  })
})
describe('loadDepDataFirst (jsdom, prettier)', () => {
  it('prefers the data folder over the project', () => {
    const proj = mkdtempSync(join(tmpdir(), 'p-')); fakePkg(proj, 'zz-df')
    const data = mkdtempSync(join(tmpdir(), 'd-')); fakePkg(data, 'zz-df')
    expect(loadDepDataFirst(data, 'zz-df', proj).from).toBe(data)
  })
  it('falls back to the project, and refuses a project copy that fails the check', () => {
    const proj = mkdtempSync(join(tmpdir(), 'p-')); fakePkg(proj, 'zz-df2')
    expect(loadDepDataFirst(null, 'zz-df2', proj).from).toBe(proj)
    expect(() => loadDepDataFirst(null, 'zz-df2', proj, () => false)).toThrow('run /html-design setup')
  })
})
