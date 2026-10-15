// Any CSS that is not Tailwind (plain, CSS modules, CSS-in-JS): the copy keeps every sheet, and new styles come
// from the plugin's own Tailwind with the prefix tw:. Every rule is !important, because Tailwind puts rules in a
// cascade layer and the copied page.css (outside any layer) would beat them. No palette: colors come from the
// app's variables. No preflight: the app's own base styles stay. source(none): only the screens are scanned.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { darkMarker } from '../config.mjs'
import { dataPaths } from '../deps.mjs'
import { detectDarkSelector, mediaDarkOnly, trackedStyleFiles, varKind, varSources } from './vars.mjs'

export const CSS_TW = '4.1.18'
const MISSING = 'Run /html-design setup again'
const twDir = (dataDir) => join(dataPaths(dataDir).tailwind, CSS_TW)
const ready = (dataDir) => (dataDir && existsSync(join(twDir(dataDir), 'node_modules', '@tailwindcss', 'postcss')) ? null : MISSING)

export function cssEntry(tw, dark, classesFile) {
  const m = darkMarker(dark)
  const sel = m.kind === 'class' ? `.${m.name}` : `[${m.name}=${m.value}]`
  const pkg = join(tw, 'node_modules', 'tailwindcss')
  return [
    '@layer theme, base, components, utilities;',
    `@import "${join(pkg, 'theme.css')}" layer(theme) prefix(tw);`,
    `@import "${join(pkg, 'utilities.css')}" layer(utilities) important source(none);`,
    '@theme { --color-*: initial; }',
    `@custom-variant dark (&:where(${sel}, ${sel} *));`,
    `@source "${classesFile}";`,
  ].join('\n') + '\n'
}

const useFor = (kind, name) => (kind === 'color' ? `tw:bg-(${name}) tw:text-(${name})` : kind === 'font' ? `tw:font-(family-name:${name})` : `tw:*-(${name})`)
const read = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }

export default {
  name: 'css',
  detect(root, flags) {
    const texts = trackedStyleFiles(root, flags.dir).map((f) => read(join(root, f)))
    const dark = texts.map(detectDarkSelector).find(Boolean) ?? null
    const warnings = !dark && texts.some(mediaDarkOnly) ? ['Your dark colors switch only with the system setting (prefers-color-scheme), so the Dark button cannot switch them.'] : []
    return { css: null, twConfig: null, themeVars: [], tailwindVersion: null, dark: dark ?? '.dark', warnings }
  },
  installs: () => [{ dir: join('tailwind', CSS_TW), pkgs: [`tailwindcss@${CSS_TW}`, `@tailwindcss/postcss@${CSS_TW}`, 'postcss@8'] }],
  ready,
  designCss: () => '/* Not a Tailwind project: html-design builds dist/design.css with its own Tailwind (classes start with tw:). This file is not used. */\n',
  async build(root, cfg, dataDir) {
    if (ready(dataDir)) throw new Error(`Missing Tailwind ${CSS_TW}: run /html-design setup`)
    const tw = twDir(dataDir)
    const req = createRequire(join(tw, 'noop.js'))
    const local = join(root, cfg.dir, '.local')
    const text = cssEntry(tw, cfg.dark, join(local, 'screens-classes.txt'))
    return (await req('postcss')([req('@tailwindcss/postcss')({ optimize: false })]).process(text, { from: join(local, 'entry.css') })).css
  },
  ownSheet: () => false,
  mustBuild: (cls) => cls.startsWith('tw:'),
  tokens(root, cfg) {
    const src = varSources(root, cfg)
    const seen = new Set()
    const list = []
    for (const [source, vars] of [['app CSS', src.app], ['page.css', src.page], ['states', src.data]]) {
      for (const [name, value] of vars) {
        if (seen.has(name)) continue
        seen.add(name)
        const kind = varKind(name, value)
        list.push({ kind, name, value, use: useFor(kind, name), source })
      }
    }
    return { prefix: 'tw:', list, notes: ['No color palette: colors come only from the variables above.'] }
  },
  watchDirs: () => [],
}
