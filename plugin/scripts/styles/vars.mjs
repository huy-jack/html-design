// CSS custom properties (--name: value) read from CSS text, from page.css and from the state attributes.
// Used by the css adapter (tokens, dark switch) and by the check (known variables).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export const decodeEntities = (v) => v.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m)))

const ROOT_SEL = new Set([':root', 'html', ':host'])
const SCSS = '\u0000'
// "html.dark" and ":root[data-theme='dark']" become ".dark" and "[data-theme=dark]", the form design-mode.json uses.
export const normSel = (s) => s.trim().replace(/^(html|:root)(?=[.[])/, '').replace(/["'\s]/g, '')

// Innermost rule blocks that define at least one variable. Blocks inside @media or @layer count too: each
// piece between two "}" holds at most one innermost block, after its last "{". A split, not a regex over
// the whole text, so a large page.css stays linear. SCSS #{...} is masked first: its braces would break
// the split, and its value is unknown until SCSS runs.
export function varBlocks(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/#\{[^{}]*\}/g, SCSS)
  const out = []
  for (const piece of src.split('}')) {
    const open = piece.lastIndexOf('{')
    if (open < 0) continue
    const vars = [...piece.slice(open + 1).matchAll(/(--[\w-]+)\s*:\s*([^;]*)/g)].map((v) => [v[1], v[2].includes(SCSS) ? '?' : v[2].trim()])
    if (!vars.length) continue
    // The selector starts after an outer "{" (@media, @layer) or a ";" (@charset, @import).
    const head = piece.slice(0, open)
    const sel = head.slice(Math.max(head.lastIndexOf('{'), head.lastIndexOf(';')) + 1)
    out.push({ selectors: sel.split(',').map((s) => s.trim()).filter(Boolean), vars })
  }
  return out
}

// Light values come from :root, html or :host blocks. A name defined only in the dark block keeps its dark value.
export function rootVars(text, dark = '.dark') {
  const light = new Map()
  const darkOnly = new Map()
  for (const b of varBlocks(text)) {
    const isLight = b.selectors.some((s) => ROOT_SEL.has(s))
    const isDark = !isLight && b.selectors.some((s) => normSel(s) === dark)
    if (!isLight && !isDark) continue
    const into = isLight ? light : darkOnly
    for (const [n, v] of b.vars) if (!into.has(n)) into.set(n, v)
  }
  for (const [n, v] of darkOnly) if (!light.has(n)) light.set(n, v)
  return light
}

const DARKISH = /^(\.[\w-]*dark[\w-]*|\[[\w-]+=[\w-]*dark[\w-]*\])$/
// The first class or attribute selector with "dark" in it that redefines a root variable.
export function detectDarkSelector(text) {
  const blocks = varBlocks(text)
  const rootNames = new Set(blocks.filter((b) => b.selectors.some((s) => ROOT_SEL.has(s))).flatMap((b) => b.vars.map((v) => v[0])))
  for (const b of blocks) {
    for (const s of b.selectors) {
      const n = normSel(s)
      if (DARKISH.test(n) && b.vars.some(([name]) => rootNames.has(name))) return n
    }
  }
  return null
}
export const mediaDarkOnly = (text) => /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{\s*(:root|html)\b/.test(text)

export function varKind(name, value) {
  if (value === '?') return 'other'
  if (/^(#[0-9a-f]{3,8}$|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(|transparent$|currentcolor$)/i.test(value)) return 'color'
  if (/^-?[\d.]+(px|rem|em|%|vh|vw|ch)$/.test(value)) return 'length'
  if (/font/i.test(name) || value.includes(',')) return 'font'
  return 'other'
}

export const parseVarList = (attr) => [...attr.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()])

// Git-tracked style files outside node_modules (and outside skipDir). Outside a git repo: none.
export function trackedStyleFiles(root, skipDir = null) {
  let out
  try {
    out = execFileSync('git', ['ls-files', '--cached', '*.css', '*.scss', '*.less'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return []
  }
  return out.split('\n').filter((f) => f && !f.includes('node_modules/') && !(skipDir && f.startsWith(`${skipDir}/`)))
}

// The 3 places a css project defines variables: its own files, page.css (copied sheets), and the
// --vars copied from <html>/<body> onto each state. Each map: name -> light value, first one wins.
export function varSources(root, cfg) {
  const d = join(root, cfg.dir)
  const app = new Map()
  for (const f of trackedStyleFiles(root, cfg.dir)) {
    let text
    try { text = readFileSync(join(root, f), 'utf8') } catch { continue }
    for (const [n, v] of rootVars(text, cfg.dark)) if (!app.has(n)) app.set(n, v)
  }
  const pageFile = join(d, 'page.css')
  const page = existsSync(pageFile) ? rootVars(readFileSync(pageFile, 'utf8'), cfg.dark) : new Map()
  const data = new Map()
  const screens = join(d, 'screens')
  if (existsSync(screens)) {
    for (const f of readdirSync(screens).filter((x) => x.endsWith('.html')).sort()) {
      for (const m of readFileSync(join(screens, f), 'utf8').matchAll(/\sdata-(?:html|body)-vars="([^"]*)"/g)) {
        for (const [n, v] of parseVarList(decodeEntities(m[1]))) if (!data.has(n)) data.set(n, v)
      }
    }
  }
  return { app, page, data }
}
