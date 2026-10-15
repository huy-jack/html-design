// usage: node check.mjs --data <dir>   (exit 1 when any screen file has a problem). Builds the CSS first, so
// "unknown class" reads a fresh dist/design.css.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { buildCssInChild } from './build-css.mjs'
import { projectRoot, readConfig } from './config.mjs'
import { isMain, parseDataArg } from './deps.mjs'
import { loadRuntime, setDataDir } from './runtime.mjs'
import { lintAdded, parseScreen, screenTargets, validateLinks } from './screen-file.mjs'
import { adapterFor } from './styles/index.mjs'
import { decodeEntities } from './styles/vars.mjs'
import { knownVars } from './tokens.mjs'

export const PAGE_CSS_WARN = 10 * 1024 * 1024
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Tailwind escapes every character outside [A-Za-z0-9_-] in a class selector with a backslash.
export const classSelector = (c) => '.' + c.replace(/[^\w-]/g, (ch) => '\\' + ch)

// unknown class: a class the style must build (css: tw:...) with no rule in the built CSS, so it renders nothing.
// unknown var: a (--x) or var(--x) inside a class that names no known variable, so it renders empty.
export function lintTokens(state, { builtCss = null, mustBuild = () => false, known = null } = {}) {
  const html = [state.html, ...(state.variants ?? []).map((v) => v.html)].join('\n')
  const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => decodeEntities(m[1]).split(/\s+/).filter(Boolean)))
  const out = []
  for (const c of classes) {
    if (builtCss !== null && mustBuild(c) && !new RegExp(`${escRe(classSelector(c))}(?![\\w\\\\-])`).test(builtCss)) out.push({ rule: 'unknown class', value: c })
    if (known) for (const m of c.matchAll(/(?:\(|var\()(--[\w-]+)/g)) if (!known.has(m[1])) out.push({ rule: 'unknown var', value: `${m[1]} in ${c}` })
  }
  return out
}

export function checkScreens(dir, ctx = {}) {
  const out = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html')).sort()) {
    const screen = f.slice(0, -5)
    const p = parseScreen(readFileSync(join(dir, f), 'utf8'))
    for (const s of p.states) for (const x of [...lintAdded(null, s), ...lintTokens(s, ctx)]) out.push({ screen: f, state: s.id, ...x })
    const ids = p.states.map((s) => s.id)
    for (const e of validateLinks(p.links, ids, { screen, targets: screenTargets(dir, screen) })) out.push({ screen: f, state: '', rule: 'link', value: e })
  }
  return out
}

if (isMain(import.meta.url)) {
  const data = parseDataArg(process.argv)
  setDataDir(data)
  try { loadRuntime() } catch (e) { console.error(e.message); process.exit(2) }
  const root = projectRoot()
  const cfg = readConfig(root)
  const d = join(root, cfg.dir)
  try {
    await buildCssInChild(root, data)
  } catch (e) {
    console.log(`build: ${e.message.trim().split('\n')[0]}`)
    console.log('1 problems.')
    process.exit(1)
  }
  const found = checkScreens(join(d, 'screens'), { builtCss: readFileSync(join(d, 'dist/design.css'), 'utf8'), mustBuild: adapterFor(cfg).mustBuild, known: knownVars(root, cfg) })
  for (const x of found) console.log(`${x.screen}#${x.state}: ${x.rule} ${x.value}`)
  const page = join(d, 'page.css')
  if (existsSync(page) && statSync(page).size > PAGE_CSS_WARN) console.log(`warning: page.css is ${(statSync(page).size / 1048576).toFixed(1)} MB (over 10 MB)`)
  console.log(found.length ? `${found.length} problems.` : 'No problems.')
  process.exit(found.length ? 1 : 0)
}
