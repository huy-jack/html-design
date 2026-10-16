// usage: node export.mjs --design <dir> --out <dir> [--app-url <url>] [--name <project name>]
// Writes the design folder as a static site for any static host (S3, a plain web server): the Screens page at
// index.html and screens/index.html, every screen file, and one small page per state for the card previews.
// No browser, no server, no npm packages. Exit 1 on an empty design folder, an output folder that is not empty,
// or a screen or state name that could write outside the output folder.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { isMain } from './deps.mjs'
import { loadSwitcherSource } from './switcher-node.mjs'
import { homePage, statesFromText, summaryOf } from './view.mjs'

const SCREEN_NAME = /^[a-z0-9-]{1,80}$/
const STATE_NAME = /^[\w-][\w.-]{0,119}$/
const TEMPLATE = join(import.meta.dirname, '..', 'templates', 'switcher.js')
const WIDTHS_LINE = /\/\*WIDTHS\*\/(\[[^\]\n]*\])/
const DARK_LINE = /\/\*DARK\*\/(\{[^\n]*\})/
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const git = (cwd, args) => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}
// The last commit that changed a file. A CI checkout gives every file the same file time, so that cannot be used.
// A shallow clone may not reach the commit: then null, and the card shows the export time.
const gitCommitTime = (file) => {
  const t = Number(git(resolve(file, '..'), ['log', '-1', '--format=%ct', '--', basename(file)]))
  return t ? t * 1000 : null
}

export function exportSite({ design, out, appUrl = '', name = basename(resolve(design, '..')), now = Date.now(), commit = git(design, ['rev-parse', '--short', 'HEAD']), commitTime = gitCommitTime }) {
  const dir = resolve(design)
  const site = resolve(out)
  const screensDir = join(dir, 'screens')
  const files = existsSync(screensDir) ? readdirSync(screensDir).filter((f) => f.endsWith('.html')).sort() : []
  if (!files.length) throw new Error(`No screen files in ${join(design, 'screens')}. Nothing was written.`)
  if (existsSync(site) && readdirSync(site).length) throw new Error(`${out} is not empty. Give an empty or new folder.`)
  if (site === dir || site.startsWith(dir + sep)) throw new Error(`${out} is inside the design folder. Give a folder outside it.`)
  for (const f of files) {
    const n = f.replace(/\.html$/, '')
    if (!SCREEN_NAME.test(n)) throw new Error(`Screen file "${f}" needs a name of a-z, 0-9 and - only. Nothing was written.`)
  }

  // This plugin's viewer with the project's own 2 settings (setup writes them into the project's copy), so the
  // site has the viewer that knows it is a site even when the project's copy is from an older plugin.
  const project = existsSync(join(dir, 'switcher.js')) ? readFileSync(join(dir, 'switcher.js'), 'utf8') : ''
  let viewer = readFileSync(TEMPLATE, 'utf8')
  const widths = WIDTHS_LINE.exec(project)
  const dark = DARK_LINE.exec(project)
  if (widths) viewer = viewer.replace(WIDTHS_LINE, () => '/*WIDTHS*/' + widths[1])
  if (dark) viewer = viewer.replace(DARK_LINE, () => '/*DARK*/' + dark[1])

  // Read and check every screen before writing anything.
  const sw = loadSwitcherSource(viewer)
  const width = sw.WIDTHS?.[0] ?? 1440
  const screens = files.map((file) => {
    const path = join(screensDir, file)
    let text
    try { text = readFileSync(path, 'utf8') } catch (e) { return { file, error: e.message } }
    const all = statesFromText(text)
    for (const s of all) if (!STATE_NAME.test(s.id) || s.id.includes('..')) throw new Error(`State "${s.id}" in ${file} needs an id of letters, digits, - _ and . only. Nothing was written.`)
    return { file, text, all, ...summaryOf(all), mtime: commitTime(path) ?? now }
  })

  // Shared files and screens as they are; the designer's own working files (.local and other dot files) stay out.
  mkdirSync(site, { recursive: true })
  cpSync(dir, site, { recursive: true, filter: (src) => !relative(dir, src).split(sep).some((p) => p.startsWith('.')) })
  writeFileSync(join(site, 'switcher.js'), viewer)
  const mark = `<meta name="hd-site" data-home="../index.html"${appUrl ? ` data-app-url="${esc(String(appUrl).replace(/\/+$/, ''))}"` : ''}>`
  let count = 0
  for (const s of screens) {
    if (s.error) continue
    const head = /<head(?:\s[^>]*)?>/i.exec(s.text)
    const marked = head ? s.text.slice(0, head.index + head[0].length) + mark + s.text.slice(head.index + head[0].length) : mark + s.text
    writeFileSync(join(site, 'screens', s.file), marked)
    const statesDir = join(site, 'states', s.file.replace(/\.html$/, ''))
    mkdirSync(statesDir, { recursive: true })
    for (const st of s.all) writeFileSync(join(statesDir, `${st.id}.html`), sw.buildStateDoc(st, { theme: 'light', base: '../../screens/', width }))
    count += s.all.length
  }
  const cards = screens.map(({ text, all, ...card }) => card)
  writeFileSync(join(site, 'index.html'), homePage(cards, { project: name, site: { base: '', updated: now, commit } }))
  writeFileSync(join(site, 'screens', 'index.html'), homePage(cards, { project: name, site: { base: '../', updated: now, commit } }))
  return { screens: screens.length, states: count }
}

function main() {
  const { values } = parseArgs({ options: { design: { type: 'string' }, out: { type: 'string' }, 'app-url': { type: 'string' }, name: { type: 'string' } } })
  if (!values.design || !values.out) {
    console.error('usage: node export.mjs --design <dir> --out <dir> [--app-url <url>] [--name <project name>]')
    process.exit(1)
  }
  try {
    const r = exportSite({ design: values.design, out: values.out, appUrl: values['app-url'] ?? '', ...(values.name ? { name: values.name } : {}) })
    console.log(`${r.screens} screens, ${r.states} states -> ${values.out}`)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}

if (isMain(import.meta.url)) main()
