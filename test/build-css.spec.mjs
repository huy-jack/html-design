import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCss, buildCssInChild, screenClasses } from '../plugin/scripts/build-css.mjs'
import { DEFAULTS, writeConfig } from '../plugin/scripts/config.mjs'
import { serializeScreen } from '../plugin/scripts/screen-file.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'

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
  it('returns null in view-only mode', async () => expect(await buildCss('/tmp', { dir: 'design', css: null }, null)).toBe(null))
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
