// Tailwind 3 lives only in test/fixture-tw3, with its own package.json. Installed once per machine
// (about 25 MB, needs the network the first time), before any test file runs.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const TW3_DIR = join(import.meta.dirname, '..', 'fixture-tw3')
export const TW3_MODULES = join(TW3_DIR, 'node_modules')
export function ensureTw3() {
  if (existsSync(join(TW3_MODULES, 'tailwindcss', 'package.json'))) return
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: TW3_DIR, stdio: 'inherit' })
}
