// Tailwind v4 projects: the design build runs the app's own Tailwind on design/design.css, which imports the
// app's Tailwind file and adds the screens' class list as a source.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { isProjectSheet } from '../css-sort.mjs'
import { dataPaths, findPackage, loadDep } from '../deps.mjs'
import { SetupExit } from './setup-exit.mjs'
import { varKind } from './vars.mjs'

const TW_IMPORT = /@import\s+["']tailwindcss["']/
const read = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }

export function findCssEntries(root) {
  const files = execFileSync('git', ['ls-files', '--cached', '*.css'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  return files.filter((f) => !f.includes('node_modules/') && TW_IMPORT.test(readFileSync(join(root, f), 'utf8'))).sort()
}
export function detectDark(css) {
  const m = /@custom-variant\s+dark\s*\(([^;]*)\);/.exec(css)
  if (!m) return null
  const attr = /\[([\w-]+)=["']?([\w-]+)["']?\]/.exec(m[1])
  if (attr) return `[${attr[1]}=${attr[2]}]`
  const cls = /\.([\w-]+)/.exec(m[1])
  return cls ? `.${cls[1]}` : null
}
// Tailwind v4 never emits --breakpoint-* as variables, so they cannot identify the app sheet.
export function themeVars(css, n = 5) {
  const block = /@theme[^{]*\{([\s\S]*?)\}/.exec(css)
  return block ? [...block[1].matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1]).filter((v) => !v.startsWith('--breakpoint-')).slice(0, n) : []
}

export function designCss({ cssRel, dark }) {
  const lines = ['/* Design CSS entry, built by html-design into dist/design.css. Do not edit by hand. */', `@import '${cssRel}';`, `@source './.local/screens-classes.txt';`]
  if (!dark) lines.push('@custom-variant dark (&:where(.dark, .dark *));')
  return lines.join('\n') + '\n'
}

const USE = [['--color-', (n) => `bg-${n} text-${n}`], ['--font-', (n) => `font-${n}`], ['--radius-', (n) => `rounded-${n}`], ['--text-', (n) => `text-${n}`], ['--shadow-', (n) => `shadow-${n}`], ['--spacing-', (n) => `p-${n}`]]
// Every variable in the @theme blocks of the app's Tailwind file, with the class that uses it.
export function themeTokens(css) {
  const p = /@import\s+["']tailwindcss["'][^;]*prefix\((\w+)\)/.exec(css)?.[1] ?? null
  const list = []
  for (const block of css.matchAll(/@theme[^{]*\{([^}]*)\}/g)) {
    for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]*)/g)) {
      const name = m[1]
      const value = m[2].trim()
      const hit = USE.find(([pre]) => name.startsWith(pre) && name.length > pre.length)
      const use = hit ? hit[1](name.slice(hit[0].length)).split(' ').map((c) => (p ? `${p}:${c}` : c)).join(' ') : ''
      list.push({ kind: name.startsWith('--color-') ? 'color' : varKind(name, value), name, value, use, source: 'theme' })
    }
  }
  return { prefix: p ? `${p}:` : null, list }
}

export default {
  name: 'tw4',
  detect(root, flags) {
    if (flags.css && !TW_IMPORT.test(read(join(root, flags.css)))) return null
    const found = flags.css ? [flags.css] : findCssEntries(root)
    if (!found.length) return null
    if (found.length > 1) throw new SetupExit(4, `Several Tailwind files: ${found.join(', ')}. Pass --css.`)
    const css = found[0]
    const pkg = findPackage('tailwindcss', dirname(join(root, css)), root)
    if (!pkg) throw new SetupExit(6, `Cannot find tailwindcss next to ${css}. Install the project dependencies, then run setup again.`)
    const text = read(join(root, css))
    return { css, twConfig: null, themeVars: themeVars(text), tailwindVersion: JSON.parse(readFileSync(pkg, 'utf8')).version ?? null, dark: detectDark(text) ?? '.dark', warnings: [] }
  },
  installs(root, cfg) {
    if (findPackage('@tailwindcss/postcss', dirname(join(root, cfg.css)), root)) return []
    return [{ dir: join('tailwind', cfg.tailwindVersion), pkgs: [`@tailwindcss/postcss@${cfg.tailwindVersion}`, 'postcss@8'] }]
  },
  ready: () => null,
  designCss(root, cfg) {
    const app = join(root, cfg.css)
    return designCss({ cssRel: relative(join(root, cfg.dir), app), dark: detectDark(read(app)) })
  },
  async build(root, cfg, dataDir) {
    const from = join(root, cfg.dir, 'design.css')
    const cssDir = dirname(join(root, cfg.css))
    const ver = loadDep(null, 'tailwindcss/package.json', cssDir).version
    const fallback = join(dataPaths(dataDir ?? '').tailwind, ver)
    const postcss = loadDep(fallback, 'postcss', cssDir)
    const tailwind = loadDep(fallback, '@tailwindcss/postcss', cssDir)
    return (await postcss([tailwind({ optimize: false })]).process(readFileSync(from, 'utf8'), { from })).css
  },
  ownSheet: (text, cfg) => isProjectSheet(text, cfg),
  mustBuild: () => false,
  tokens: (root, cfg) => ({ ...themeTokens(read(join(root, cfg.css))), notes: [] }),
  watchDirs: (root, cfg) => [{ dir: dirname(join(root, cfg.css)), recursive: true, match: (f) => f.endsWith('.css') }],
}
