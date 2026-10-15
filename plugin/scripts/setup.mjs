// plugin/scripts/setup.mjs
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { projectRoot, readConfig, writeConfig } from './config.mjs'
import { dataPaths, findPackage, isMain } from './deps.mjs'
import { designCss, detectDark, findCssEntries, themeVars } from './styles/tw4.mjs'
import { setDataDir } from './runtime.mjs'
import { adapterFor, detectStyle } from './styles/index.mjs'
import { SetupExit } from './styles/setup-exit.mjs'
import { writeSwitcher } from './switcher-node.mjs'

export { designCss, detectDark, findCssEntries, findPackage, themeVars }

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..')

export function makeSkeleton(root, cfg, pluginRoot = PLUGIN) {
  const d = join(root, cfg.dir)
  for (const p of ['screens', 'assets', 'dist', '.local']) mkdirSync(join(d, p), { recursive: true })
  writeFileSync(join(d, 'design.css'), adapterFor(cfg).designCss(root, cfg))
  for (const f of ['page.css', 'fonts.css']) if (!existsSync(join(d, f))) writeFileSync(join(d, f), '')
  writeFileSync(join(d, '.gitignore'), '.local/\n')
  copyFileSync(join(pluginRoot, 'templates', 'README.md'), join(d, 'README.md'))
  writeSwitcher(pluginRoot, d, cfg)
}

function install(data, pkgs) {
  mkdirSync(data, { recursive: true })
  if (!existsSync(join(data, 'package.json'))) writeFileSync(join(data, 'package.json'), '{"private":true}\n')
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--prefix', data, ...pkgs], { stdio: 'inherit' })
}

async function main() {
  const { values } = parseArgs({ options: { data: { type: 'string' }, css: { type: 'string' }, url: { type: 'string' }, dir: { type: 'string', default: 'design' }, style: { type: 'string' }, 'tw-config': { type: 'string' }, 'skip-install': { type: 'boolean', default: false } } })
  setDataDir(values.data)
  const root = projectRoot()
  let found
  try {
    found = detectStyle(root, { css: values.css, twConfig: values['tw-config'], style: values.style, dir: values.dir })
  } catch (e) {
    if (!(e instanceof SetupExit)) throw e
    console.error(e.message)
    process.exit(e.code)
  }
  const d = join(root, values.dir)
  if (existsSync(d) && !existsSync(join(d, 'design.css')) && readdirSync(d).length) { console.error(`${values.dir}/ holds other files. Pass --dir.`); process.exit(5) }
  const { adapter, style, warnings, ...detected } = found
  writeConfig(root, { style, dir: values.dir, ...detected, url: values.url ?? null })
  const cfg = readConfig(root)
  makeSkeleton(root, cfg)
  if (!values['skip-install']) {
    install(values.data, ['playwright@1.56.1', 'jsdom@26.1.0', 'prettier@2.8.8'])
    execFileSync(join(values.data, 'node_modules', '.bin', 'playwright'), ['install', 'chromium'], { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: dataPaths(values.data).browsers } })
    writeFileSync(join(values.data, 'playwright-version.txt'), '1.56.1\n')
    for (const i of adapter.installs(root, cfg)) install(join(values.data, i.dir), i.pkgs)
  }
  for (const w of warnings) console.error(w)
  const tokens = adapter.tokens(root, cfg).list.length
  if (!tokens) console.error('No theme tokens or CSS variables found yet. CSS variables also come from page.css after the first copy.')
  console.log(JSON.stringify({ style, css: cfg.css, twConfig: cfg.twConfig, dark: cfg.dark, tokens, dir: cfg.dir }))
}

if (isMain(import.meta.url)) await main()
