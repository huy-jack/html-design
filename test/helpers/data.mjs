// A plugin data folder for tests, laid out like setup's installs, with links to this repo's packages.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NM = join(import.meta.dirname, '..', '..', 'node_modules')
export function makeData({ tailwind = true, version = '1.56.1\n' } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'hdata-'))
  mkdirSync(join(d, 'node_modules'))
  for (const p of ['playwright', 'jsdom', 'prettier']) symlinkSync(join(NM, p), join(d, 'node_modules', p))
  if (version !== null) writeFileSync(join(d, 'playwright-version.txt'), version)
  if (tailwind) {
    mkdirSync(join(d, 'tailwind', '4.1.18'), { recursive: true })
    symlinkSync(NM, join(d, 'tailwind', '4.1.18', 'node_modules'))
  }
  return d
}
