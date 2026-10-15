// Tailwind 3.3+ projects: the design build runs the app's own Tailwind 3 on the app's CSS file, with the app's
// config, and with the config's content list replaced by the screens' class list. Tailwind 3 cannot follow
// @import on its own, so postcss-import runs first. The app's own PostCSS config is not used.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { isProjectSheet } from '../css-sort.mjs'
import { dataPaths, findPackage, loadDep, loadDepDataFirst } from '../deps.mjs'
import { SetupExit } from './setup-exit.mjs'

const CONFIG_RE = /(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/
const TW3_CSS = /@tailwind\s+(base|components|utilities)\b|@import\s+["']tailwindcss\/(base|components|utilities)/
const MISSING = 'Run /html-design setup again'
const read = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }
const tracked = (root, spec) => {
  try {
    return execFileSync('git', ['ls-files', '--cached', spec], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((f) => f && !f.includes('node_modules/'))
  } catch {
    return []
  }
}
const appRequire = (dir) => createRequire(join(dir, 'noop.js'))
const tw3Dir = (dataDir) => (dataDir ? dataPaths(dataDir).tw3 : null)

// Tailwind 3.3.0 returns a .ts config as its module namespace ({ default }); 3.4 returns the object itself.
export function loadTwConfig(file, req) {
  const raw = req('tailwindcss/loadConfig')(file)
  return raw?.default ?? raw
}

// The viewer's Dark button sets a class or an attribute. "media" (the Tailwind 3 default) follows the system
// setting instead, so the design build uses the class .dark.
export function mapDarkMode(dm) {
  if (dm === 'class' || dm === 'selector') return { dark: '.dark', warning: null }
  if (Array.isArray(dm) && (dm[0] === 'class' || dm[0] === 'selector') && typeof dm[1] === 'string') {
    const s = dm[1].replace(/["'\s]/g, '')
    if (/^(\.[\w-]+|\[[\w-]+=[\w-]+\])$/.test(s)) return { dark: s, warning: null }
  }
  return { dark: '.dark', warning: `darkMode ${JSON.stringify(dm ?? 'media')} is rebuilt as the class .dark, so the Dark button works. The design CSS differs from the app on this point.` }
}

const flatten = (obj, pre = '') =>
  Object.entries(obj ?? {}).flatMap(([k, v]) => {
    const name = k === 'DEFAULT' ? pre.replace(/-$/, '') : `${pre}${k}`
    if (v && typeof v === 'object' && !Array.isArray(v)) return flatten(v, `${name}-`)
    return [[name, typeof v === 'function' ? '?' : Array.isArray(v) ? v.join(', ') : String(v)]]
  })
const KEYS = [['colors', 'color', (n) => `bg-${n} text-${n}`], ['fontFamily', 'font', (n) => `font-${n}`], ['borderRadius', 'length', (n) => `rounded-${n}`], ['spacing', 'length', (n) => `p-${n}`]]
// The project's own theme values (theme and theme.extend). Tailwind 3 defaults are not listed: Claude knows them.
export function configTokens(config) {
  const prefix = config.prefix || null
  const theme = config.theme ?? {}
  const own = (key) => ({ ...(theme[key] && typeof theme[key] === 'object' ? theme[key] : {}), ...(theme.extend?.[key] && typeof theme.extend[key] === 'object' ? theme.extend[key] : {}) })
  const list = []
  for (const [key, kind, use] of KEYS) {
    for (const [name, value] of flatten(own(key))) list.push({ kind, name, value, use: use(name).split(' ').map((c) => `${prefix ?? ''}${c}`).join(' '), source: 'config' })
  }
  return { prefix, list, notes: [`Tailwind 3 defaults: colors ${theme.colors ? 'replaced by the config' : 'kept'}.`] }
}

export default {
  name: 'tw3',
  detect(root, flags) {
    const configs = flags.twConfig ? [flags.twConfig] : tracked(root, '*tailwind.config.*').filter((f) => CONFIG_RE.test(f))
    if (!configs.length) return null
    if (configs.length > 1) throw new SetupExit(4, `Several Tailwind configs: ${configs.join(', ')}. Pass --tw-config.`)
    const twConfig = configs[0]
    const cfgDir = dirname(join(root, twConfig))
    const pkg = findPackage('tailwindcss', cfgDir, root)
    if (!pkg) throw new SetupExit(6, `Cannot find tailwindcss next to ${twConfig}. Install the project dependencies, then run setup again. If the app no longer uses Tailwind, run setup with --style css.`)
    const version = JSON.parse(readFileSync(pkg, 'utf8')).version ?? '0.0.0'
    const [major, minor] = version.split('.').map(Number)
    if (major !== 3) return null
    if (minor < 3) throw new SetupExit(7, `Tailwind ${version} is older than 3.3. Upgrade Tailwind, or run setup with --style css.`)
    const cssFiles = flags.css ? [flags.css] : tracked(root, '*.css').filter((f) => TW3_CSS.test(read(join(root, f))))
    if (!cssFiles.length) throw new SetupExit(4, 'No CSS file with @tailwind lines found. Pass --css.')
    if (cssFiles.length > 1) throw new SetupExit(4, `Several Tailwind CSS files: ${cssFiles.join(', ')}. Pass --css.`)
    let config
    try {
      config = loadTwConfig(join(root, twConfig), appRequire(cfgDir))
    } catch (e) {
      throw new SetupExit(6, `Could not load ${twConfig}: ${e.message.split('\n')[0]}`)
    }
    const { dark, warning } = mapDarkMode(config.darkMode)
    return { css: cssFiles[0], twConfig, themeVars: [], tailwindVersion: version, dark, warnings: warning ? [warning] : [] }
  },
  installs: () => [{ dir: 'tw3', pkgs: ['postcss-import@16.1.0', 'postcss@8'] }],
  ready(dataDir, cfg, root) {
    try {
      loadDepDataFirst(tw3Dir(dataDir), 'postcss-import', dirname(join(root, cfg.css)))
      return null
    } catch {
      return MISSING
    }
  },
  designCss: (root, cfg) => `/* Tailwind 3 project: html-design builds dist/design.css from ${cfg.css} with ${cfg.twConfig}. This file is not used. */\n`,
  async build(root, cfg, dataDir) {
    const cssFile = join(root, cfg.css)
    const cssDir = dirname(cssFile)
    const req = appRequire(dirname(join(root, cfg.twConfig)))
    const config = { ...loadTwConfig(join(root, cfg.twConfig), req), content: [join(root, cfg.dir, '.local', 'screens-classes.txt')], darkMode: ['class', cfg.dark] }
    const postcss = loadDep(tw3Dir(dataDir), 'postcss', cssDir)
    const atImport = loadDepDataFirst(tw3Dir(dataDir), 'postcss-import', cssDir)
    return (await postcss([atImport(), req('tailwindcss')(config)]).process(readFileSync(cssFile, 'utf8'), { from: cssFile })).css
  },
  ownSheet: (text, cfg) => isProjectSheet(text, cfg),
  mustBuild: () => false,
  tokens: (root, cfg) => configTokens(loadTwConfig(join(root, cfg.twConfig), appRequire(dirname(join(root, cfg.twConfig))))),
  watchDirs: (root, cfg) => [
    { dir: dirname(join(root, cfg.css)), recursive: true, match: (f) => f.endsWith('.css') },
    { dir: dirname(join(root, cfg.twConfig)), recursive: false, match: (f) => basename(f) === basename(cfg.twConfig) },
  ],
}
