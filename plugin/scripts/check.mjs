// usage: node check.mjs --data <dir>   (exit 1 when any screen file has a problem)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, readConfig } from './config.mjs'
import { isMain, parseDataArg } from './deps.mjs'
import { loadRuntime, setDataDir } from './runtime.mjs'
import { lintAdded, parseScreen, screenTargets, validateLinks } from './screen-file.mjs'

export function checkScreens(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html')).sort()) {
    const screen = f.slice(0, -5)
    const p = parseScreen(readFileSync(join(dir, f), 'utf8'))
    for (const s of p.states) for (const x of lintAdded(null, s)) out.push({ screen: f, state: s.id, ...x })
    const ids = p.states.map((s) => s.id)
    for (const e of validateLinks(p.links, ids, { screen, targets: screenTargets(dir, screen) })) out.push({ screen: f, state: '', rule: 'link', value: e })
  }
  return out
}

if (isMain(import.meta.url)) {
  setDataDir(parseDataArg(process.argv))
  try { loadRuntime() } catch (e) { console.error(e.message); process.exit(2) }
  const root = projectRoot()
  const dir = join(root, readConfig(root).dir, 'screens')
  const found = checkScreens(dir)
  for (const x of found) console.log(`${x.screen}#${x.state}: ${x.rule} ${x.value}`)
  console.log(found.length ? `${found.length} problems.` : 'No problems.')
  process.exit(found.length ? 1 : 0)
}
