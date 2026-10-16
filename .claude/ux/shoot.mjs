// Screenshots of the plugin's own pages (home, viewer, Pick, Copy tab) for the ui-ux-reviewer agent.
// Runs the real viewer server on a project folder with a fake app browser, so no app needs to run.
// Run from the repo root:
//   node .claude/ux/shoot.mjs <project-root> <out-dir> [screen]   a project with copied screens
//   node .claude/ux/shoot.mjs --empty <out-dir>                    the first run: no screens, no app tab
// Writes <page>@<width>.png and <page>.aria.txt. Never commit the output: it shows the project's app.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = process.env.HD_REPO ?? resolve(import.meta.dirname, '..', '..')
const load = (p) => import(pathToFileURL(join(repo, p)).href)
const { readConfig, writeConfig } = await load('plugin/scripts/config.mjs')
const { makeSkeleton } = await load('plugin/scripts/setup.mjs')
const { createViewServer } = await load('plugin/scripts/view.mjs')
const { chromium } = createRequire(join(repo, 'package.json'))('playwright')

const args = process.argv.slice(2)
const empty = args[0] === '--empty'
let [root, out, screen] = empty ? [null, args[1]] : args
if (!out) {
  console.error('Usage: node .claude/ux/shoot.mjs <project-root> <out-dir> [screen] | --empty <out-dir>')
  process.exit(2)
}
if (empty) {
  root = mkdtempSync(join(tmpdir(), 'ux-empty-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(root, 'app.css'), '@import "tailwindcss";\n')
  writeConfig(root, { css: 'app.css', themeVars: [], url: 'http://localhost:5173' })
  makeSkeleton(root, readConfig(root))
}
const cfg = readConfig(root)
mkdirSync(out, { recursive: true })
const screens = readdirSync(join(root, cfg.dir, 'screens')).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort()
screen ??= screens[0]

const tab = (title, url) => ({ title: async () => title, url: () => url, evaluate: async () => cfg.widths[0] })
const tabs = empty ? [] : [tab('Example app – Settings', 'http://localhost:5173/settings'), tab('Example app – Home', 'http://localhost:5173/')]
const browser = { appPages: () => tabs, copyFrom: async () => ({ status: 201, saved: 'x', images: 0, warnings: [] }), resize: async () => {}, badge: async () => {}, toast: async () => {} }
const view = await createViewServer({ root, cfg, build: false, watch: false, dataDir: null, port: 0, browser })
const base = `http://127.0.0.1:${view.port}`
const b = await chromium.launch()

async function shoot(name, path, sizes, after) {
  for (const [w, h] of sizes) {
    const p = await b.newPage({ viewport: { width: w, height: h } })
    await p.goto(base + path, { waitUntil: 'load' })
    await p.waitForTimeout(1500)
    if (after) await after(p)
    await p.screenshot({ path: join(out, `${name}@${w}.png`) })
    if (w === sizes[0][0]) writeFileSync(join(out, `${name}.aria.txt`), await p.locator('body').ariaSnapshot())
    await p.close()
  }
}
const desktop = [[1440, 900], [1024, 768]]
const prefix = empty ? 'empty-' : ''
await shoot(`${prefix}home`, '/', desktop)
await shoot(`${prefix}copy`, '/__copy', desktop)
if (screen) {
  await shoot('viewer', `/screens/${screen}.html`, desktop)
  await shoot('viewer-pick', `/screens/${screen}.html`, desktop.slice(0, 1), async (p) => {
    const pick = p.getByRole('button', { name: /pick/i }).first()
    if (await pick.count()) await pick.click()
    await p.waitForTimeout(500)
  })
}
await b.close()
await view.close()
console.log(`Saved to ${out}${screen ? ` (screen: ${screen})` : ''}`)
