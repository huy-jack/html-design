// Pure part of a copy: no browser. Input = what the browser part collected; output = files.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { appendUnique, splitFontFaces } from './css-sort.mjs'
import { canonicalHtml, mergeStates, parseScreen, serializeScreen, slugScreen, SIZE_LIMIT } from './screen-file.mjs'
import { adapterFor } from './styles/index.mjs'

const MIME = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' }
const URL_RE = /url\(\s*(["']?)(.*?)\1\s*\)/g
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12)
const pathExt = (url) => extname(new URL(url).pathname).toLowerCase()

const assetName = (url, buf) => `${sha(buf)}${pathExt(url).slice(0, 6) || '.bin'}`
function saveAsset(d, url, buf) {
  const name = assetName(url, buf)
  const p = join(d, 'assets', name)
  if (!existsSync(p)) writeFileSync(p, buf)
  return name
}

// Replaces every url() in css. fn(absoluteUrl) returns the new url text, or null to leave it and warn.
function rewriteUrls(css, base, files, warnings, label, fn) {
  return css.replace(URL_RE, (whole, _q, raw) => {
    if (!raw || raw.startsWith('data:') || raw.startsWith('#')) return whole
    let abs
    try { abs = new URL(raw, base).href } catch { return whole }
    const buf = files.get(abs)
    if (!buf) { warnings.push(`${label} not downloaded: ${abs}`); return whole }
    return `url(${fn(abs, buf)})`
  })
}

const widthOf = (s, cfg) => Number(s.attrs['data-width'] ?? cfg.widths[0])

const withoutWidth = (variants, width) => variants.map((v) => ({ ...v, widths: v.widths.filter((w) => w !== width) })).filter((v) => v.widths.length)

export function processCapture({ root, cfg, screen, state, label, width, replace = false, clean, sheetTexts, files }) {
  const d = join(root, cfg.dir)
  const warnings = [...clean.warnings]
  const file = join(d, 'screens', `${slugScreen(screen)}.html`)
  const existing = existsSync(file) ? parseScreen(readFileSync(file, 'utf8')) : { screen, states: [], links: [] }
  const old = existing.states.find((s) => s.id === state)
  const sameWidth = old && widthOf(old, cfg) === width
  // Decide first: a conflict changes nothing on disk.
  if (sameWidth && !replace) return { status: 409, images: 0, warnings }

  // Image names come from their bytes, so the final html is known before anything is written.
  let html = clean.html
  let images = 0
  const pending = []
  for (const a of clean.assets) {
    const buf = files.get(a.url)
    if (!buf) { warnings.push(`image not downloaded: ${a.url}`); continue }
    html = html.split(a.ref).join(`../assets/${assetName(a.url, buf)}`); images += 1
    pending.push([a.url, buf])
  }
  // A copy at another width that equals the base adds nothing: its images, fonts and page rules came in
  // with the base. Decide that before writing, so this case touches no file except, when needed, the
  // screen file (to drop an old width copy).
  const same = !!old && !sameWidth && canonicalHtml(old.html).trim() === canonicalHtml(html).trim()
  const kept = old && !sameWidth ? withoutWidth(old.variants ?? [], width) : []
  if (same && kept.length === (old.variants ?? []).length && kept.every((v, i) => v.widths.length === old.variants[i].widths.length)) {
    return { status: 201, kind: 'same-as-base', saved: file, images, warnings }
  }
  if (!same) writeSideFiles()
  function writeSideFiles() {
    for (const [url, buf] of pending) saveAsset(d, url, buf)
    const saveFaces = (faces, base) => {
      for (const face of faces) {
        const out = rewriteUrls(face, base, files, warnings, 'font', (u, buf) => `data:${MIME[pathExt(u)] ?? 'font/woff2'};base64,${buf.toString('base64')}`)
        appendUnique(join(d, 'fonts.css'), out)
      }
    }
    // Classes on the copied <html>/<body>: their rules travel even when the sheet holding them is dropped.
    const rootClasses = new Set(`${clean.htmlClass ?? ''} ${clean.bodyClass ?? ''}`.split(/\s+/).filter(Boolean))
    for (const s of sheetTexts) {
      const base = s.href ?? cfg.url ?? 'http://localhost/'
      const { faces, rest } = splitFontFaces(s.text)
      if (adapterFor(cfg).ownSheet(s.text, cfg)) {
        // Frameworks bundle font CSS into the Tailwind file (Next.js next/font): keep the fonts and the
        // rules for the html/body classes, drop the rest (the design build makes it again).
        saveFaces(faces, base)
        const keep = [...rest.matchAll(/(?<=^|\})\s*(\.([\w-]+)\s*\{[^{}]*\})/g)].filter((m) => rootClasses.has(m[2])).map((m) => m[1])
        if (keep.length) appendUnique(join(d, 'page.css'), keep.join('\n'))
        continue
      }
      saveFaces(faces, base)
      const css = rewriteUrls(rest.trim(), base, files, warnings, 'css file', (u, buf) => `./assets/${saveAsset(d, u, buf)}`)
      if (css) appendUnique(join(d, 'page.css'), css)
    }
  }
  const attrs = { ...(old?.attrs ?? {}), 'data-html-class': clean.htmlClass, 'data-body-class': clean.bodyClass, 'data-width': String(width), ...(label ? { 'data-label': label } : {}) }
  let states, kind
  if (!old || sameWidth) {
    ({ states } = mergeStates(existing.states, [{ id: state, attrs, html, variants: old?.variants ?? [] }], { replace: new Set([state]) })); kind = 'base'
  } else {
    kind = same ? 'same-as-base' : 'width-copy'
    const variants = same ? kept : [...kept, { widths: [width], html }]
    states = existing.states.map((s) => (s.id === state ? { ...s, variants } : s))
  }
  const text = serializeScreen({ screen: existing.screen || screen, states, links: existing.links ?? [] })
  writeFileSync(file, text)
  if (Buffer.byteLength(text) > SIZE_LIMIT) warnings.push(`${slugScreen(screen)}.html is over 25 MB`)
  return { status: 201, kind, saved: file, images, warnings }
}
