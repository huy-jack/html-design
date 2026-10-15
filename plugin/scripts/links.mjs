// usage: node links.mjs add --screen <s> --from <id> --button <text> --to <id|screen#id> [--motion <m>] [--ms <n>] [--nth <n>] [--morph a,b]
//        node links.mjs list --screen <s>
//        node links.mjs remove --screen <s> --index <n>
// Edits only a screen file's link list, so Claude never rewrites or searches the states for a link change.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { projectRoot, readConfig } from './config.mjs'
import { isMain } from './deps.mjs'
import { loadRuntime, setDataDir } from './runtime.mjs'
import { parseScreen, screenTargets, validateLinks, writeLinksBlock } from './screen-file.mjs'

// opts: { screen, targets } so a link to another screen file is checked against the files that exist.
export function addLink(text, link, opts = {}) {
  const p = parseScreen(text)
  const links = [...p.links, link]
  const errors = validateLinks(links, p.states.map((s) => s.id), opts)
  if (errors.length) throw new Error(errors.join('\n'))
  return writeLinksBlock(text, links)
}

export function removeLink(text, index) {
  const { links } = parseScreen(text)
  if (!Number.isInteger(index) || index < 1 || index > links.length) throw new Error(`There is no link ${index} (the file has ${links.length}).`)
  return writeLinksBlock(text, links.filter((_, i) => i !== index - 1))
}

function summary(l) {
  const parts = [`${l.from}: "${l.button}"${l.nth ? ` (#${l.nth})` : ''} -> ${l.to}`, `${l.motion ?? 'none'} ${l.ms ?? 300} ms`]
  if (l.morph) parts.push(`morph ${l.morph.join(', ')}`)
  return parts.join(', ')
}

function main() {
  const [cmd] = process.argv.slice(2)
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      screen: { type: 'string' }, from: { type: 'string' }, button: { type: 'string' }, to: { type: 'string' },
      motion: { type: 'string' }, ms: { type: 'string' }, nth: { type: 'string' }, morph: { type: 'string' },
      index: { type: 'string' }, data: { type: 'string' },
    },
  })
  if (!values.screen || !['add', 'list', 'remove'].includes(cmd)) {
    console.error('usage: links.mjs add|list|remove --screen <screen> ... (see the header of this file)')
    process.exit(2)
  }
  setDataDir(values.data)
  try { loadRuntime() } catch (e) { console.error(e.message); process.exit(2) }
  const dir = join(projectRoot(), readConfig(projectRoot()).dir, 'screens')
  const file = join(dir, `${values.screen}.html`)
  try {
    const text = readFileSync(file, 'utf8')
    if (cmd === 'list') {
      const { links } = parseScreen(text)
      if (!links.length) return console.log('No links.')
      links.forEach((l, i) => console.log(`${i + 1}. ${summary(l)}`))
      return
    }
    if (cmd === 'remove') {
      writeFileSync(file, removeLink(text, Number(values.index)))
      return console.log(`Removed link ${values.index}.`)
    }
    const link = { from: values.from, button: values.button, to: values.to }
    if (values.nth) link.nth = Number(values.nth)
    if (values.motion) link.motion = values.motion
    if (values.ms) link.ms = Number(values.ms)
    if (values.morph) link.morph = values.morph.split(',').map((s) => s.trim())
    writeFileSync(file, addLink(text, link, { screen: values.screen, targets: screenTargets(dir, values.screen) }))
    console.log(`Added: ${summary(link)}`)
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
}

if (isMain(import.meta.url)) main()
