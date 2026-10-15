import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../plugin/scripts/config.mjs'
import { serializeScreen } from '../plugin/scripts/screen-file.mjs'
import { loadSwitcher } from '../plugin/scripts/switcher-node.mjs'
import { listNotes, locateNote, markDone, readNotes, reopen } from '../plugin/scripts/notes.mjs'

const SD = loadSwitcher()
const cfg = { ...DEFAULTS }
const SCREEN = serializeScreen({
  screen: 'x',
  states: [
    {
      id: 'long',
      attrs: { 'data-flow': 'f' },
      html: '<div><p>Wide caption</p><p>Here is the long caption text</p></div>',
      variants: [{ widths: [375], html: '<section><p>Here is the long caption text</p></section>' }],
    },
    { id: 'twice', attrs: { 'data-flow': 'f' }, html: '<div><p>Same</p><p>Same</p></div>' },
  ],
})
const doc = () => new JSDOM(SCREEN).window.document
const notesFile = (r) => join(r, 'design/.local/notes.json')

describe('notes', () => {
  it('finds a note picked on a width copy inside that copy', () => {
    const note = { state: 'long@375', path: [1, 1], tag: 'p', text: 'Here is the long caption text' }
    expect(locateNote(doc(), note, SD)).toEqual({ status: 'ok', html: '<p>Here is the long caption text</p>' })
  })
  it('follows an element that moved, by its text', () => {
    const note = { state: 'long', path: [1, 1], tag: 'p', text: 'Here is the long caption text' }
    expect(locateNote(doc(), note, SD)).toEqual({ status: 'moved', html: '<p>Here is the long caption text</p>', path: [1, 2] })
  })
  it('refuses to guess between two matches, and reports a missing block', () => {
    expect(locateNote(doc(), { state: 'twice', path: [9], tag: 'p', text: 'Same' }, SD)).toEqual({ status: 'ambiguous', count: 2 })
    expect(locateNote(doc(), { state: 'twice', path: [9], tag: 'p', text: 'Gone' }, SD)).toEqual({ status: 'missing', count: 0 })
    expect(locateNote(doc(), { state: 'nope', path: [1], tag: 'p', text: '' }, SD)).toEqual({ status: 'no-block' })
  })
  it('reads notes from <dir>/.local/notes.json and marks one done', () => {
    const root = mkdtempSync(join(tmpdir(), 'hd-notes-'))
    expect(readNotes(root, cfg)).toEqual([])
    mkdirSync(join(root, 'design/.local'), { recursive: true })
    writeFileSync(notesFile(root), JSON.stringify([{ id: 'n-1', done: false }, { id: 'n-2', done: false }]))
    expect(readNotes(root, cfg)).toHaveLength(2)
    expect(markDone(root, cfg, 'n-2')).toBe(true)
    expect(markDone(root, cfg, 'n-9')).toBe(false)
    expect(JSON.parse(readFileSync(notesFile(root), 'utf8')).map((n) => n.done)).toEqual([false, true])
    expect(reopen(root, cfg, 'n-2')).toBe(true)
    expect(readNotes(root, cfg).map((n) => n.done)).toEqual([false, false])
    writeFileSync(notesFile(root), '[{"id"')
    expect(() => readNotes(root, cfg)).toThrow(/not valid JSON/)
  })
  it('list covers open notes on every screen', () => {
    const root = mkdtempSync(join(tmpdir(), 'hd-notes-'))
    mkdirSync(join(root, 'design/.local'), { recursive: true })
    mkdirSync(join(root, 'design/screens'), { recursive: true })
    writeFileSync(join(root, 'design/screens/x.html'), SCREEN)
    writeFileSync(notesFile(root), JSON.stringify([
      { id: 'n-1', screen: 'x', state: 'long', path: [1, 2], tag: 'p', text: 'Here is the long caption text', theme: 'light', note: 'a', done: false },
      { id: 'n-2', screen: 'y', state: 's', path: [1], tag: 'p', text: '', theme: 'light', note: 'b', done: false },
      { id: 'n-3', screen: 'x', state: 'long', path: [1], tag: 'p', text: '', theme: 'light', note: 'c', done: true },
    ]))
    const out = listNotes(root, cfg)
    expect(out.map((n) => [n.note.id, n.result.status])).toEqual([['n-1', 'ok'], ['n-2', 'no-screen']])
  })
})

describe('notes CLI', () => {
  const run = (cwd, args) => spawnSync(process.execPath, [join(import.meta.dirname, '../plugin/scripts/notes.mjs'), ...args], { cwd, encoding: 'utf8' })
  it('names setup and exits 2 without a stack when the data folder is missing', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hd-notes-cli-'))
    const r = run(cwd, ['list', '--data', join(cwd, 'no-data')])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/run \/html-design setup/)
    expect(r.stderr).not.toMatch(/\n\s+at /)
  })
  it('names setup and exits 2 without a stack when design-mode.json is missing', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hd-notes-cli-'))
    const r = run(cwd, ['list', '--data', join(import.meta.dirname, '..')])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/No design-mode.json: run \/html-design setup/)
    expect(r.stderr).not.toMatch(/\n\s+at /)
  })
})
