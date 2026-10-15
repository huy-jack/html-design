import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCss, buildCssInChild, screenClasses } from '../plugin/scripts/build-css.mjs'
import { DEFAULTS, writeConfig } from '../plugin/scripts/config.mjs'
import { serializeScreen } from '../plugin/scripts/screen-file.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'
import { makeData } from './helpers/data.mjs'

const readConfigOr = (c) => ({ ...DEFAULTS, ...c })
const cfgBase = { dir: 'design', css: 'app.css', dark: '.dark', widths: [1440] }
function project(html) {
  const r = mkdtempSync(join(tmpdir(), 'b-'))
  writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n@theme { --color-brand: #123456; }\n')
  symlinkSync(join(process.cwd(), 'node_modules'), join(r, 'node_modules'))
  makeSkeleton(r, cfgBase, join(process.cwd(), 'plugin'))
  writeFileSync(join(r, 'design/screens/a.html'), serializeScreen({ screen: 'a', states: [{ id: 's', attrs: {}, html, variants: [] }] }))
  return r
}

describe('screenClasses', () => {
  it('decodes entities and reads html/body class attributes', () => {
    const d = mkdtempSync(join(tmpdir(), 'sc-'))
    writeFileSync(join(d, 'a.html'), '<div class="[&amp;_p]:text-3xl [&amp;&gt;svg]:size-4"></div><template data-html-class="scroll-smooth" data-body-class="h-dvh"></template>')
    const t = screenClasses(d)
    expect(t).toContain('[&_p]:text-3xl')
    expect(t).toContain('[&>svg]:size-4')
    expect(t).toContain('scroll-smooth')
    expect(t).toContain('h-dvh')
  })
  it('returns empty for a missing folder', () => expect(screenClasses('/nonexistent-xyz')).toBe(''))
})

describe('buildCss', () => {
  it('builds a used token class and an escaped class', async () => {
    const r = project('<p class="text-brand [&amp;_b]:font-bold">x</p>')
    const css = await buildCss(r, readConfigOr(cfgBase), null)
    expect(css).toContain('#123456')
    expect(css).toMatch(/\.\\\[\\&_b\\\]\\:font-bold/)
  }, 60000)
  it('css style: builds tw: classes with the plugin Tailwind from the data folder', async () => {
    const r = mkdtempSync(join(tmpdir(), 'bc-'))
    const cfg = readConfigOr({ dir: 'design', css: null })
    makeSkeleton(r, cfg, join(process.cwd(), 'plugin'))
    writeFileSync(join(r, 'design/screens/a.html'), serializeScreen({ screen: 'a', states: [{ id: 's', attrs: {}, html: '<p class="tw:p-6 p-3">x</p>', variants: [] }] }))
    const css = await buildCss(r, cfg, makeData())
    expect(css).toContain('.tw\\:p-6')
    expect(css).not.toMatch(/\.p-3\s*\{/)
  }, 60000)
  it('CLI prints only the message when the build fails (Review Focus 3)', () => {
    const r = mkdtempSync(join(tmpdir(), 'bc-'))
    writeConfig(r, { dir: 'design' })
    makeSkeleton(r, readConfigOr({ dir: 'design' }), join(process.cwd(), 'plugin'))
    const p = spawnSync(process.execPath, [join(process.cwd(), 'plugin/scripts/build-css.mjs'), '--data', makeData({ tailwind: false })], { cwd: r, encoding: 'utf8' })
    expect(p.status).toBe(1)
    expect(p.stderr).toContain('Missing Tailwind 4.1.18: run /html-design setup')
    expect(p.stderr).not.toMatch(/^file:\/\//m)
  })
  it('a fresh child build drops classes that left the screens', async () => {
    const r = project('<p class="italic">x</p>')
    writeConfig(r, cfgBase)
    const out = join(r, 'design/dist/design.css')
    await buildCssInChild(r, null)
    expect(readFileSync(out, 'utf8')).toContain('.italic')
    writeFileSync(join(r, 'design/screens/a.html'), '<p class="underline"></p>')
    await buildCssInChild(r, null)
    expect(readFileSync(out, 'utf8')).not.toContain('.italic')
    expect(readFileSync(out, 'utf8')).toContain('.underline')
  }, 90000)
})

describe('build-css CLI', () => {
  it('builds from another screens folder into another file', () => {
    const r = project('<p class="mt-17">x</p>')
    writeConfig(r, cfgBase)
    const dir = mkdtempSync(join(tmpdir(), 'scr-'))
    writeFileSync(join(dir, 'x.html'), '<template id="a"><p class="mt-23">x</p></template>')
    const out = join(dir, 'out.css')
    const res = spawnSync(process.execPath, [join(process.cwd(), 'plugin/scripts/build-css.mjs'), '--screens', dir, '--out', out, '--data', makeData()], { cwd: r, encoding: 'utf8' })
    expect(res.stderr).toBe('')
    expect(res.status).toBe(0)
    const css = readFileSync(out, 'utf8')
    // The other folder's classes are built. Tailwind 4 may also scan the project by itself (no source(none) in
    // the app file), so today's classes can be there too: a superset, never a missing class.
    expect(css).toContain('.mt-23')
  }, 30000)
})
