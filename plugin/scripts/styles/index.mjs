// The only code that reads cfg.style. Every other step asks the adapter, so a new style family is one new
// adapter file and one line here.
import css from './css.mjs'
import { SetupExit } from './setup-exit.mjs'
import tw3 from './tw3.mjs'
import tw4 from './tw4.mjs'

const ADAPTERS = { tw4, tw3, css }
const ORDER = ['tw4', 'tw3', 'css']

// A config from before styles existed: a Tailwind file means tw4, none means css (the old view-only mode).
export const styleName = (cfg) => cfg.style ?? (cfg.css ? 'tw4' : 'css')

export function adapterFor(cfg) {
  const a = ADAPTERS[styleName(cfg)]
  if (!a) throw new Error(`Unknown style "${cfg.style}" in design-mode.json: use tw4, tw3 or css`)
  return a
}

// Tries tw4, then tw3, then css; the first adapter that finds its setup wins. flags.style tries only that one.
export function detectStyle(root, flags) {
  if (flags.style && !ADAPTERS[flags.style]) throw new SetupExit(2, '--style must be tw4, tw3 or css')
  for (const name of flags.style ? [flags.style] : ORDER) {
    const found = ADAPTERS[name].detect(root, flags)
    if (found) return { style: name, adapter: ADAPTERS[name], ...found }
  }
  throw new SetupExit(4, `--style ${flags.style}: no ${flags.style} setup found in this project`)
}
