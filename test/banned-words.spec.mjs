// Words that must never ship in plugin/ (names from other projects). The list lives in
// test/.banned-words.txt, one word per line, git-ignored, so the repo never spells them out.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const list = join(import.meta.dirname, '.banned-words.txt')
const words = existsSync(list) ? readFileSync(list, 'utf8').split('\n').map((w) => w.trim()).filter(Boolean) : []
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))

it.skipIf(words.length === 0)('plugin/ holds no banned word', () => {
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
  expect(walk(join(import.meta.dirname, '..', 'plugin')).filter((f) => re.test(readFileSync(f, 'utf8')))).toEqual([])
})
