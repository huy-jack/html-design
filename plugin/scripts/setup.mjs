// plugin/scripts/setup.mjs
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { projectRoot, writeConfig } from './config.mjs'
import { dataPaths, findPackage, isMain } from './deps.mjs'
import { designCss, detectDark, findCssEntries, themeVars } from './styles/tw4.mjs'
import { setDataDir } from './runtime.mjs'
import { writeSwitcher } from './switcher-node.mjs'

export { designCss, detectDark, findCssEntries, findPackage, themeVars }

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..')

export function makeSkeleton(root, cfg, pluginRoot = PLUGIN) {
  const d = join(root, cfg.dir)
  for (const p of ['screens', 'assets', 'dist', '.local']) mkdirSync(join(d, p), { recursive: true })
  const cssRel = cfg.css ? relative(d, join(root, cfg.css)) : null
  const entry = cfg.css ? designCss({ cssRel, dark: detectDark(readFileSync(join(root, cfg.css), 'utf8')) }) : '/* View-only mode: no Tailwind file. */\n'
  writeFileSync(join(d, 'design.css'), entry)
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
  const { values } = parseArgs({ options: { data: { type: 'string' }, css: { type: 'string' }, url: { type: 'string' }, dir: { type: 'string', default: 'design' }, 'skip-install': { type: 'boolean', default: false } } })
  setDataDir(values.data)
  const root = projectRoot()
  const found = values.css ? [values.css] : findCssEntries(root)
  if (found.length > 1) { console.error(`Several Tailwind files: ${found.join(', ')}. Pass --css.`); process.exit(4) }
  const css = found[0] ?? null
  const d = join(root, values.dir)
  if (existsSync(d) && !existsSync(join(d, 'design.css')) && readdirSync(d).length) { console.error(`${values.dir}/ holds other files. Pass --dir.`); process.exit(5) }
  const cssDir = css ? dirname(join(root, css)) : null
  const tailwindPkg = css ? findPackage('tailwindcss', cssDir, root) : null
  const tailwindVersion = tailwindPkg ? JSON.parse(readFileSync(tailwindPkg, 'utf8')).version ?? null : null
  let twVersion = null
  if (css && !values['skip-install'] && !findPackage('@tailwindcss/postcss', cssDir, root)) {
    twVersion = tailwindVersion
    if (!twVersion) { console.error(`Cannot find tailwindcss next to ${css}. Install the project dependencies, then run setup again.`); process.exit(6) }
  }
  const text = css ? readFileSync(join(root, css), 'utf8') : ''
  const cfg = { dir: values.dir, css, themeVars: themeVars(text), tailwindVersion, dark: detectDark(text) ?? '.dark', url: values.url ?? null }
  writeConfig(root, cfg)
  makeSkeleton(root, { ...cfg, widths: [1440, 1024, 375] })
  if (!values['skip-install']) {
    install(values.data, ['playwright@1.56.1', 'jsdom@26.1.0', 'prettier@2.8.8'])
    execFileSync(join(values.data, 'node_modules', '.bin', 'playwright'), ['install', 'chromium'], { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: dataPaths(values.data).browsers } })
    writeFileSync(join(values.data, 'playwright-version.txt'), '1.56.1\n')
    if (twVersion) install(join(dataPaths(values.data).tailwind, twVersion), [`@tailwindcss/postcss@${twVersion}`, 'postcss@8'])
  }
  console.log(JSON.stringify({ css, viewOnly: !css, dark: cfg.dark, themeVars: cfg.themeVars, tailwindVersion, dir: values.dir }))
  if (!css) console.error('View-only mode: no Tailwind v4 file found. New classes will not render.')
}
if (isMain(import.meta.url)) await main()
