// usage: node tokens.mjs --data <dir>   (run in the project root)
// Prints the style and prefix, then the tokens Claude may use (one per line), then where they came from.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, readConfig } from './config.mjs'
import { isMain, parseDataArg } from './deps.mjs'
import { setDataDir } from './runtime.mjs'
import { adapterFor, styleName } from './styles/index.mjs'
import { declaredVars, trackedStyleFiles } from './styles/vars.mjs'

// Variables a class may name: the style's tokens plus every --var that some rule or attribute sets, in the
// app's CSS files, page.css or the screens (a wrapper's style="--w: 3rem", data-html-vars, [--x:1] classes).
export function knownVars(root, cfg) {
  const names = new Set(adapterFor(cfg).tokens(root, cfg).list.map((t) => t.name).filter((n) => n.startsWith('--')))
  const d = join(root, cfg.dir)
  const screens = join(d, 'screens')
  const files = [...trackedStyleFiles(root, cfg.dir).map((f) => join(root, f)), join(d, 'page.css'), ...(existsSync(screens) ? readdirSync(screens).filter((f) => f.endsWith('.html')).map((f) => join(screens, f)) : [])]
  for (const f of files) {
    let text
    try { text = readFileSync(f, 'utf8') } catch { continue }
    for (const n of declaredVars(text)) names.add(n)
  }
  return names
}

export function formatTokens(style, t) {
  const lines = [`style: ${style}${t.prefix ? `  prefix: ${t.prefix}` : ''}`]
  for (const x of t.list) lines.push(`${x.kind.padEnd(6)}  ${x.name.padEnd(22)}  ${x.value.padEnd(16)}  ${x.use}`.trimEnd())
  for (const n of t.notes) lines.push(n)
  const counts = new Map()
  for (const x of t.list) counts.set(x.source, (counts.get(x.source) ?? 0) + 1)
  lines.push(`sources: ${[...counts].map(([s, n]) => `${n} from ${s}`).join(', ') || 'no tokens yet'}`)
  return lines.join('\n')
}

if (isMain(import.meta.url)) {
  setDataDir(parseDataArg(process.argv))
  const root = projectRoot()
  let cfg
  try { cfg = readConfig(root) } catch (e) { console.error(e.message); process.exit(6) }
  console.log(formatTokens(styleName(cfg), adapterFor(cfg).tokens(root, cfg)))
}
