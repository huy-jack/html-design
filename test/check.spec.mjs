import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { checkScreens } from '../plugin/scripts/check.mjs'
import { serializeScreen } from '../plugin/scripts/screen-file.mjs'
it('flags raw colors, styles, scripts, broken links', () => {
  const d = mkdtempSync(join(tmpdir(), 'k-')); mkdirSync(d, { recursive: true })
  const html = '<div class="text-[#754aa1] p-4" style="color: red;"><script>x</script><button>Go</button></div>'
  writeFileSync(join(d, 'a.html'), serializeScreen({ screen: 'a', states: [{ id: 'one', attrs: {}, html, variants: [] }], links: [{ from: 'one', button: 'Go', to: 'missing', motion: 'fade', ms: 300 }] }))
  const rules = checkScreens(d).map((f) => f.rule).sort()
  expect(rules).toEqual(['inline style', 'link', 'raw color', 'script'])
})

const screenFile = (name, html, links = []) => serializeScreen({ screen: name, states: [{ id: 'one', attrs: {}, html, variants: [] }], links })
it('flags a style tag', () => {
  const d = mkdtempSync(join(tmpdir(), 'k-'))
  writeFileSync(join(d, 'a.html'), screenFile('a', '<div><style>p{color:red}</style><p>x</p></div>'))
  expect(checkScreens(d).map((f) => f.rule)).toEqual(['style tag'])
})
it('a link to another screen file: valid gives no finding, missing gives one', () => {
  const d = mkdtempSync(join(tmpdir(), 'k-'))
  writeFileSync(join(d, 'b.html'), screenFile('b', '<p>b</p>'))
  writeFileSync(join(d, 'a.html'), screenFile('a', '<button>Go</button>', [{ from: 'one', button: 'Go', to: 'b#one' }]))
  expect(checkScreens(d)).toEqual([])
  writeFileSync(join(d, 'a.html'), screenFile('a', '<button>Go</button>', [{ from: 'one', button: 'Go', to: 'c#one' }, { from: 'one', button: 'Go', to: 'b#two' }]))
  expect(checkScreens(d).map((f) => f.value)).toEqual([expect.stringMatching(/"c" does not exist/), expect.stringMatching(/"two" is not in b/)])
})
it('CLI exits 1 on a problem and 0 when clean', () => {
  const r = mkdtempSync(join(tmpdir(), 'kc-'))
  writeFileSync(join(r, 'design-mode.json'), JSON.stringify({ dir: 'design' }))
  mkdirSync(join(r, 'design/screens'), { recursive: true })
  const run = () => spawnSync(process.execPath, [join(import.meta.dirname, '../plugin/scripts/check.mjs'), '--data', join(import.meta.dirname, '..')], { cwd: r, encoding: 'utf8' })
  writeFileSync(join(r, 'design/screens/a.html'), screenFile('a', '<p style="color:red">x</p>'))
  let p = run()
  expect(p.status).toBe(1)
  expect(p.stdout).toMatch(/a\.html#one: inline style/)
  writeFileSync(join(r, 'design/screens/a.html'), screenFile('a', '<p>x</p>'))
  p = run()
  expect(p.status).toBe(0)
  expect(p.stdout).toMatch(/No problems/)
})
