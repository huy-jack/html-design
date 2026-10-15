// usage: node notes.mjs list | done <id> | reopen <id> --data <dir>  (run in the project root)
// The designer's Pick notes (<dir>/.local/notes.json). "list" finds each open note's element in its screen
// file, so Claude edits the right element without searching a large file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { jsdom, loadRuntime, setDataDir } from './runtime.mjs'
import { isMain, parseDataArg } from './deps.mjs'
import { projectRoot, readConfig } from './config.mjs'
import { loadSwitcher } from './switcher-node.mjs'

export const notesFile = (root, cfg) => join(root, cfg.dir, '.local/notes.json')

// A file that does not parse is an error, never an empty list: a write would replace every note.
export function readNotes(root, cfg) {
  const f = notesFile(root, cfg)
  if (!existsSync(f)) return []
  let v
  try {
    v = JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    v = null
  }
  if (!Array.isArray(v)) throw new Error(`The notes file is not valid JSON: fix or delete ${cfg.dir}/.local/notes.json.`)
  return v
}

// Write then rename, so a reader never sees a half-written file.
export function writeNotes(root, cfg, notes) {
  const f = notesFile(root, cfg)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(`${f}.tmp`, JSON.stringify(notes, null, 2) + '\n')
  renameSync(`${f}.tmp`, f)
}

export const markDone = (root, cfg, id) => setDone(root, cfg, id, true)
// After an undo: the change is gone, so the note is open again.
export const reopen = (root, cfg, id) => setDone(root, cfg, id, false)

function setDone(root, cfg, id, done) {
  const notes = readNotes(root, cfg)
  const n = notes.find((x) => x.id === id)
  if (!n) return false
  n.done = done
  writeNotes(root, cfg, notes)
  return true
}

// The note's element: by its path while the text still matches; else by its text inside the same block.
// Two or zero text matches: report, never guess (Claude asks the designer).
export function locateNote(document, note, SD) {
  const tpl = document.getElementById(note.state)
  if (!tpl || tpl.tagName !== 'TEMPLATE') return { status: 'no-block' }
  const top = tpl.content
  const same = (e) => !!e && e.tagName.toLowerCase() === note.tag && SD.noteText(e) === note.text
  const el = SD.resolvePath(top, note.path)
  if (same(el)) return { status: 'ok', html: el.outerHTML }
  const found = [...top.querySelectorAll(note.tag)].filter(same)
  if (found.length === 1) return { status: 'moved', html: found[0].outerHTML, path: SD.elementPath(found[0], top) }
  return { status: found.length ? 'ambiguous' : 'missing', count: found.length }
}

// Every open note on every screen, each with where its element is now.
export function listNotes(root, cfg) {
  const open = readNotes(root, cfg).filter((n) => !n.done)
  if (!open.length) return []
  const SD = loadSwitcher()
  const docs = new Map()
  return open.map((n) => {
    const file = join(root, cfg.dir, 'screens', `${n.screen}.html`)
    if (!docs.has(file)) docs.set(file, existsSync(file) ? new (jsdom().JSDOM)(readFileSync(file, 'utf8')).window.document : null)
    const d = docs.get(file)
    return { note: n, result: d ? locateNote(d, n, SD) : { status: 'no-screen' } }
  })
}

function main() {
  setDataDir(parseDataArg(process.argv))
  loadRuntime()
  const root = projectRoot(process.cwd())
  const cfg = readConfig(root)
  const [cmd, id] = process.argv.slice(2)
  if ((cmd === 'done' || cmd === 'reopen') && id) {
    if (!(cmd === 'done' ? markDone : reopen)(root, cfg, id)) {
      console.error(`No note ${id}.`)
      process.exit(2)
    }
    return console.log(`${cmd === 'done' ? 'Done' : 'Open again'}: ${id}`)
  }
  if (cmd !== 'list') {
    console.error('usage: notes.mjs list | done <id> | reopen <id> --data <dir>')
    process.exit(2)
  }
  const rows = listNotes(root, cfg)
  if (!rows.length) return console.log('No open notes.')
  for (const { note: n, result: r } of rows) {
    console.log(`${n.id}  ${n.screen}#${n.state} @${n.width} (${n.theme})  [${r.status}${r.count != null ? ` x${r.count}` : ''}]  note: "${n.note}"`)
    if (r.path) console.log(`  moved to path ${r.path.join(' > ')}`)
    if (r.html) console.log(`  element: ${r.html.length > 300 ? `${r.html.slice(0, 300)}...` : r.html}`)
  }
}

if (isMain(import.meta.url)) {
  try {
    main()
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
}
