import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
// The app's own Tailwind output: its exact version banner, or any one recorded theme var defined (exact name).
export const isProjectSheet = (text, { themeVars = [], tailwindVersion = null } = {}) =>
  (tailwindVersion != null && new RegExp(`tailwindcss v${esc(tailwindVersion)}(?![\\w.-])`).test(text)) ||
  themeVars.some((v) => new RegExp(`(?<![\\w-])${esc(v)}\\s*:`).test(text))
export function splitFontFaces(text) {
  const faces = []
  const rest = text.replace(/@font-face\s*\{[^}]*\}/g, (m) => { faces.push(m); return '' })
  return { faces, rest }
}
// Every url() target as an absolute http(s) URL. CSS allows spaces inside the parentheses and any case
// for the url keyword; data:, blob:, fragments and other schemes are not downloadable files, so they go.
export function cssUrls(text, base) {
  const out = []
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]*))\s*\)/gi)) {
    const u = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (!u || u.startsWith('#')) continue
    let abs
    try { abs = new URL(u, base) } catch { continue }
    if (abs.protocol === 'http:' || abs.protocol === 'https:') out.push(abs.href)
  }
  return [...new Set(out)]
}
export const fontUrls = (face, base) => cssUrls(face, base)
export function appendUnique(file, chunk) {
  const h = createHash('sha256').update(chunk).digest('hex').slice(0, 12)
  if (existsSync(file) && readFileSync(file, 'utf8').includes(`/* hd:${h} */`)) return false
  appendFileSync(file, `/* hd:${h} */\n${chunk}\n`)
  return true
}
