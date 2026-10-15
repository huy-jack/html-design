// C1: an installed plugin has no node_modules near it. Its scripts must load jsdom and prettier from --data.
import { spawnSync, execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { readConfig, writeConfig } from '../plugin/scripts/config.mjs'
import { serializeScreen } from '../plugin/scripts/screen-file.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'

const REPO = join(import.meta.dirname, '..')
let scripts, data, proj
beforeAll(() => {
  const inst = mkdtempSync(join(tmpdir(), 'inst-'))
  cpSync(join(REPO, 'plugin'), join(inst, 'plugin'), { recursive: true })
  scripts = join(inst, 'plugin', 'scripts')
  data = mkdtempSync(join(tmpdir(), 'pdata-'))
  mkdirSync(join(data, 'node_modules'))
  for (const p of ['jsdom', 'prettier', 'playwright']) symlinkSync(join(REPO, 'node_modules', p), join(data, 'node_modules', p))
  // The project has no Tailwind, so it is a css project: check builds with the plugin Tailwind from the data folder.
  mkdirSync(join(data, 'tailwind', '4.1.18'), { recursive: true })
  symlinkSync(join(REPO, 'node_modules'), join(data, 'tailwind', '4.1.18', 'node_modules'))
  proj = mkdtempSync(join(tmpdir(), 'iproj-'))
  execFileSync('git', ['init', '-q'], { cwd: proj })
  writeConfig(proj, {})
  makeSkeleton(proj, readConfig(proj))
  const cfg = readConfig(proj)
  writeFileSync(join(proj, cfg.dir, 'screens', 'home.html'), serializeScreen({ screen: 'home', states: [{ id: 'a', attrs: {}, html: '<p>a</p>' }] }))
})
const run = (file, args) => spawnSync(process.execPath, [join(scripts, file), ...args], { cwd: proj, encoding: 'utf8' })

describe('installed plugin outside the repo', () => {
  it('check, links list and notes list start with --data', () => {
    for (const [f, a, out] of [['check.mjs', [], 'No problems.'], ['links.mjs', ['list', '--screen', 'home'], 'No links.'], ['notes.mjs', ['list'], 'No open notes.']]) {
      const r = run(f, [...a, '--data', data])
      expect(r.stderr, f).toBe('')
      expect(r.status, f).toBe(0)
      expect(r.stdout, f).toContain(out)
    }
  })
  it('without --data they stop with the setup message', () => {
    for (const [f, a] of [['check.mjs', []], ['links.mjs', ['list', '--screen', 'home']], ['notes.mjs', ['list']]]) {
      const r = run(f, a)
      expect(r.status, f).not.toBe(0)
      expect(r.stderr, f).toContain('run /html-design setup')
    }
  })
})
