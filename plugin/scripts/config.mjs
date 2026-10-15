// -------------------------------------------------------------
// Reads and writes design-mode.json at the project root.
// -------------------------------------------------------------
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export const CONFIG_FILE = 'design-mode.json'
export const DEFAULTS = { dir: 'design', css: null, themeVars: [], tailwindVersion: null, dark: '.dark', widths: [1440, 1024, 375], browser: 'chromium', url: null }

export function projectRoot(cwd = process.cwd()) {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return cwd }
}
export function readConfig(root) {
  const f = join(root, CONFIG_FILE)
  if (!existsSync(f)) throw new Error('No design-mode.json: run /html-design setup')
  let cfg
  try { cfg = JSON.parse(readFileSync(f, 'utf8')) } catch (e) { throw new Error(`${f} is not valid JSON: ${e.message}`) }
  return { ...DEFAULTS, ...cfg }
}
export function writeConfig(root, cfg) {
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ ...DEFAULTS, ...cfg }, null, 2) + '\n')
}
export function darkMarker(dark) {
  const attr = /^\[([\w-]+)=["']?([\w-]+)["']?\]$/.exec(dark)
  if (attr) return { kind: 'attr', name: attr[1], value: attr[2] }
  return { kind: 'class', name: dark.replace(/^\./, '') }
}
