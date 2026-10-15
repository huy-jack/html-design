// Loads templates/switcher.js in node, so tools reuse the exact helpers the browser uses (one copy, no drift).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { darkMarker } from './config.mjs'

export function loadSwitcher(file = join(import.meta.dirname, '..', 'templates', 'switcher.js')) {
  const ctx = {}
  vm.runInNewContext(readFileSync(file, 'utf8'), ctx)
  return ctx.HtmlDesign
}

export function writeSwitcher(pluginRoot, designDir, cfg) {
  const widthsMark = '/*WIDTHS*/[1440, 1024, 375]'
  const darkMark = "/*DARK*/{ kind: 'class', name: 'dark' }"
  let src = readFileSync(join(pluginRoot, 'templates', 'switcher.js'), 'utf8')
  for (const m of [widthsMark, darkMark]) if (!src.includes(m)) throw new Error(`switcher template is missing placeholder ${m}`)
  src = src.replace(widthsMark, () => '/*WIDTHS*/' + JSON.stringify(cfg.widths)).replace(darkMark, () => '/*DARK*/' + JSON.stringify(darkMarker(cfg.dark)))
  const out = join(designDir, 'switcher.js')
  if (!existsSync(out) || readFileSync(out, 'utf8') !== src) { writeFileSync(out, src); return true }
  return false
}
