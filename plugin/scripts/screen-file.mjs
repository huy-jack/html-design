// Screen files: design/screens/<screen>.html, one <template> per state. Parse, write, merge, diff, lint.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jsdom, prettier } from './runtime.mjs'

export const STATE_ATTRS = ['data-flow', 'data-label', 'data-width', 'data-group', 'data-note', 'data-url', 'data-source', 'data-html-class', 'data-body-class', 'data-html-lang', 'data-html-vars', 'data-body-vars']
// Measured in a real project: 73 states ≈ 19 MB. A design change diffs only its changed lines.
export const SIZE_LIMIT = 25 * 1024 * 1024
export const LINK_MOTIONS = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'morph']
const LINKS_RE = /<script\b[^>]*\bid=["']sd-links["'][^>]*>[\s\S]*?<\/script>\n?/
// "</" inside JSON would end the script early; \u003c reads back as "<".
const linksBlock = (links) => `<script type="application/json" id="sd-links">\n${JSON.stringify(links, null, 2).replace(/</g, '\\u003c')}\n</script>\n`

function parseLinks(document) {
  const el = document.getElementById('sd-links')
  if (!el) return []
  let v
  try {
    v = JSON.parse(el.textContent)
  } catch {
    throw new Error('The link list (sd-links) is not valid JSON. Fix it before saving: a rewrite would drop every link.')
  }
  if (!Array.isArray(v)) throw new Error('The link list (sd-links) is not valid JSON. Fix it before saving: it must be a list.')
  return v
}

export const slugScreen = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const escText = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')

export function parseScreen(text) {
  const { document } = new (jsdom().JSDOM)(text).window
  return {
    screen: document.documentElement.getAttribute('data-screen') ?? '',
    states: [...document.querySelectorAll('body > template[id]:not([data-variant-of])')].map((t) => ({
      id: t.id,
      attrs: Object.fromEntries(STATE_ATTRS.filter((a) => t.hasAttribute(a)).map((a) => [a, t.getAttribute(a)])),
      html: t.innerHTML.trim(),
      variants: [...document.querySelectorAll('body > template[data-variant-of]')]
        .filter((v) => v.getAttribute('data-variant-of') === t.id)
        .map((v) => ({ widths: v.getAttribute('data-widths').split(' ').map(Number), html: v.innerHTML.trim() })),
    })),
    links: parseLinks(document),
  }
}

// The app may build a different page below 1440 (JS layout, not only CSS breakpoints). A width whose page
// equals the first width's page gets no copy; widths with the same page share one variant.
export function groupVariants(byWidth, widths = [1440, 1024, 375]) {
  const variants = []
  for (const w of widths.slice(1)) {
    if (byWidth[w] === byWidth[widths[0]]) continue
    const same = variants.find((v) => v.html === byWidth[w])
    if (same) same.widths.push(w)
    else variants.push({ widths: [w], html: byWidth[w] })
  }
  return { html: byWidth[widths[0]], variants }
}

// One canonical form for markup: the browser that captured it writes ">" in attributes as "&gt;", the
// parser here writes ">". Without this, the first rewrite of a file changes lines in untouched states.
export function canonicalHtml(html) {
  const { document } = new (jsdom().JSDOM)('<template></template>').window
  const t = document.querySelector('template')
  t.innerHTML = html
  return t.innerHTML
}

export function serializeScreen({ screen, states, links = [] }) {
  const body = states
    .map((s) => {
      const attrs = [`id="${escAttr(s.id)}"`, ...STATE_ATTRS.filter((a) => s.attrs[a] != null && s.attrs[a] !== '').map((a) => `${a}="${escAttr(s.attrs[a])}"`)]
      const variants = (s.variants ?? []).map((v) => `<template id="${escAttr(`${s.id}@${v.widths[0]}`)}" data-variant-of="${escAttr(s.id)}" data-widths="${v.widths.join(' ')}">\n${canonicalHtml(v.html)}\n</template>`)
      return [`<template ${attrs.join(' ')}>\n${canonicalHtml(s.html)}\n</template>`, ...variants].join('\n')
    })
    .join('\n')
  const src = `<!doctype html>\n<html lang="en" data-screen="${escAttr(screen)}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escText(screen)}: design</title>\n<script src="../switcher.js" defer></script>\n</head>\n<body>\n${body}\n</body>\n</html>\n`
  // strict: the formatter never adds visible whitespace (a whitespace-pre-wrap element shows every space).
  return writeLinksBlock(prettier().format(src, { parser: 'html', printWidth: 120, htmlWhitespaceSensitivity: 'strict' }), links)
}

// Changes only the link list, so a link edit never rewrites the states (a screen file is up to 25 MB).
export function writeLinksBlock(text, links) {
  const without = text.replace(LINKS_RE, '')
  if (!links.length) return without
  const body = without.lastIndexOf('</body>')
  // No </body> (a hand-made file): append, never put the block before the doctype.
  if (body === -1) return `${without}${without.endsWith('\n') ? '' : '\n'}${linksBlock(links)}`
  // At the start of the </body> line, so the block sits on its own lines and </body> keeps its indent.
  const at = without.lastIndexOf('\n', body) + 1
  return `${without.slice(0, at)}${linksBlock(links)}${without.slice(at)}`
}

// The state ids of a screen file, read with a pattern instead of a DOM parse: other screen files can be 19 MB.
export function listScreenIds(text) {
  const ids = []
  for (const m of String(text).matchAll(/<template\b([^>]*)>/g)) {
    if (/\bdata-variant-of=/.test(m[1])) continue
    const id = /\bid="([^"]+)"/.exec(m[1])
    if (id) ids.push(id[1])
  }
  return ids
}

// { screen: [state ids] } for every other screen file, for validateLinks' targets.
export function screenTargets(dir, exceptScreen) {
  if (!existsSync(dir)) return {}
  const out = {}
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.html') || f === `${exceptScreen}.html`) continue
    out[f.slice(0, -5)] = listScreenIds(readFileSync(join(dir, f), 'utf8'))
  }
  return out
}

const isWholeNumber = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
// opts.screen: this file's name; opts.targets: { otherScreen: [state ids] }. Without targets, a link to
// another file is checked for shape only.
export function validateLinks(links, stateIds, opts = {}) {
  const errors = []
  links.forEach((l, i) => {
    const at = `link ${i + 1} (${l.from} -> ${l.to})`
    if (!stateIds.includes(l.from)) errors.push(`${at}: from "${l.from}" is not a state of this file`)
    if (typeof l.button !== 'string' || !l.button.trim()) errors.push(`${at}: button must be the visible text or aria-label`)
    if (typeof l.to !== 'string' || !l.to) errors.push(`${at}: to is missing`)
    else if (!l.to.includes('#') && !stateIds.includes(l.to)) errors.push(`${at}: to "${l.to}" is not a state of this file (another file: <screen>#<state>)`)
    else if (l.to.includes('#')) {
      const [screen, state] = [l.to.slice(0, l.to.indexOf('#')), l.to.slice(l.to.indexOf('#') + 1)]
      if (screen === opts.screen && !stateIds.includes(state)) errors.push(`${at}: to "${l.to}" is not a state of this file`)
      else if (screen !== opts.screen && opts.targets && !opts.targets[screen]) errors.push(`${at}: screen file "${screen}" does not exist`)
      else if (screen !== opts.screen && opts.targets && !opts.targets[screen].includes(state)) errors.push(`${at}: state "${state}" is not in ${screen}`)
    }
    if (l.to === l.from) errors.push(`${at}: to is the same state as from`)
    if (l.motion !== undefined && !LINK_MOTIONS.includes(l.motion)) errors.push(`${at}: motion "${l.motion}" is not one of ${LINK_MOTIONS.join(', ')}`)
    if (l.ms !== undefined && !isWholeNumber(l.ms, 50, 2000)) errors.push(`${at}: ms must be a whole number from 50 to 2000`)
    if (l.nth !== undefined && !isWholeNumber(l.nth, 1, 100)) errors.push(`${at}: nth must be 1 or more`)
    if (l.motion === 'morph' && !(Array.isArray(l.morph) && l.morph.length && l.morph.every((n) => /^[a-z0-9-]{1,40}$/.test(n)))) {
      errors.push(`${at}: morph needs a list of shared names (lowercase letters, digits, dashes), the same data-morph value on the element in both states`)
    }
  })
  return errors
}

export function mergeStates(existing, captured, { replace }) {
  const states = existing.map((s) => ({ ...s, attrs: { ...s.attrs } }))
  const added = []
  const kept = []
  const replaced = []
  for (const c of captured) {
    const i = states.findIndex((s) => s.id === c.id)
    if (i === -1) {
      states.push(c)
      added.push(c.id)
      continue
    }
    if (states[i].attrs['data-flow'] && states[i].attrs['data-flow'] !== c.attrs['data-flow']) {
      throw new Error(`State "${c.id}" already belongs to another flow (${states[i].attrs['data-flow']}).`)
    }
    if (replace.has(c.id)) {
      states[i] = c
      replaced.push(c.id)
    } else kept.push(c.id)
  }
  return { states, added, kept, replaced }
}

const comparable = (s) => JSON.stringify([s.html, s.variants ?? [], Object.entries(s.attrs).sort()])

export function diffStates(oldText, newText) {
  return diffStateLists(oldText ? parseScreen(oldText).states : [], parseScreen(newText).states)
}

export function diffStateLists(beforeStates, after) {
  const before = new Map(beforeStates.map((s) => [s.id, s]))
  const ids = new Set(after.map((s) => s.id))
  return {
    added: after.filter((s) => !before.has(s.id)).map((s) => s.id),
    changed: after.filter((s) => before.has(s.id) && comparable(before.get(s.id)) !== comparable(s)).map((s) => s.id),
    removed: [...before.keys()].filter((id) => !ids.has(id)),
  }
}

const classTokens = (html) => new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean)))
const styleValues = (html) => new Set([...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]))
const count = (html, re) => (html.match(re) ?? []).length
const RAW_COLOR = /\[(#|rgba?\(|hsla?\(|oklch\(|color-mix\()/i

const allHtml = (s) => (s ? [s.html, ...(s.variants ?? []).map((v) => v.html)].join('\n') : '')

export function lintAdded(oldState, newState) {
  const oldHtml = allHtml(oldState)
  const newHtml = allHtml(newState)
  const out = []
  const oldClasses = classTokens(oldHtml)
  for (const c of classTokens(newHtml)) if (!oldClasses.has(c) && RAW_COLOR.test(c)) out.push({ rule: 'raw color', value: c })
  const oldStyles = styleValues(oldHtml)
  for (const s of styleValues(newHtml)) if (!oldStyles.has(s)) out.push({ rule: 'inline style', value: s })
  if (count(newHtml, /<style\b/g) > count(oldHtml, /<style\b/g)) out.push({ rule: 'style tag', value: '<style>' })
  if (count(newHtml, /<script\b/g) > 0) out.push({ rule: 'script', value: '<script>' })
  return out
}
