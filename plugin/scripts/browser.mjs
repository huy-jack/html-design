// Browser part of a copy: opens the app in a real browser, reads one page, hands the result to processCapture.
// Downloads go through the browser context, so the user's login cookies apply.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { processCapture } from './capture-core.mjs'
import { darkMarker } from './config.mjs'
import { cssUrls, splitFontFaces } from './css-sort.mjs'
import { dataPaths, loadDep } from './deps.mjs'
import { parseScreen, slugScreen } from './screen-file.mjs'
import { freezePage, settlePage } from './settle.mjs'
import { adapterFor } from './styles/index.mjs'

const CLEAN_SRC = readFileSync(join(import.meta.dirname, 'clean.mjs'), 'utf8').replace(/^export\s+/m, '')

// Ctrl+Shift+S on any app page asks the session to copy that page.
const CHORD_SCRIPT = `window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); window.__hdCopy && window.__hdCopy() }
}, true)`

const nearest = (widths, w) => widths.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), widths[0])

export async function openBrowser({ root, cfg, dataDir = null, profileDir, onChord, headless = false, viewerOrigin = null }) {
  if (dataDir && existsSync(dataPaths(dataDir).browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = dataPaths(dataDir).browsers
  const { chromium } = loadDep(dataDir, 'playwright', root)
  const context = await chromium.launchPersistentContext(profileDir, { headless, channel: cfg.browser === 'chrome' ? 'chrome' : undefined, viewport: null })
  await context.exposeBinding('__hdCopy', ({ page }) => (onChord ? onChord(page) : undefined))
  await context.addInitScript({ content: CHORD_SCRIPT })

  const appPages = () =>
    context.pages().filter((p) => {
      const u = p.url()
      if (u === 'about:blank') return false
      try { return !(viewerOrigin && new URL(u).origin === new URL(viewerOrigin).origin) } catch { return true }
    })

  if (cfg.url) {
    const first = context.pages()[0] ?? (await context.newPage())
    await first.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch((e) => console.error(`Could not open ${cfg.url}: ${e.message}`))
  }

  const fetchBuf = async (page, url) => {
    if (url.startsWith('blob:')) {
      const b64 = await page.evaluate(async (u) => {
        const buf = new Uint8Array(await (await fetch(u)).arrayBuffer())
        let s = ''
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        return btoa(s)
      }, url).catch(() => null)
      return b64 === null ? null : Buffer.from(b64, 'base64')
    }
    try {
      const res = await context.request.get(url)
      return res.ok() ? await res.body() : null
    } catch { return null }
  }

  const viewWidth = (page) => page.evaluate(() => [window.innerWidth, window.innerHeight])

  async function copyFrom(page, { screen, state, label, replace = false }) {
    const file = join(root, cfg.dir, 'screens', `${slugScreen(screen)}.html`)
    const known = existsSync(file) && parseScreen(readFileSync(file, 'utf8')).states.some((s) => s.id === state)
    let clean_warn = null
    if (!known) {
      const [, h] = await viewWidth(page)
      await page.setViewportSize({ width: cfg.widths[0], height: h })
    }
    await settlePage(page)
    await freezePage(page)
    const [w] = await viewWidth(page)
    const width = nearest(cfg.widths, w)
    if (width !== w) clean_warn = `window is ${w}px wide; stored as ${width}px`
    const clean = await page.evaluate(([src, opts]) => new Function('return (' + src + ')')()(document, opts), [CLEAN_SRC, { dark: darkMarker(cfg.dark) }])
    const pageUrl = page.url()
    if (clean_warn) clean.warnings.push(clean_warn)
    const sheetTexts = []
    for (const s of clean.sheets) {
      let text = s.text
      // A <link> sheet: the served file, not the rule list the page parsed. The rule list drops comments,
      // and the banner that marks the app's own Tailwind 3 output is a comment. The rule list stays as
      // the fallback when the file cannot be downloaded.
      if (s.href) {
        const buf = await fetchBuf(page, s.href)
        if (buf) text = buf.toString('utf8')
        else if (text === null) { clean.warnings.push(`css file not downloaded: ${s.href}`); continue }
      }
      if (text !== null) sheetTexts.push({ href: s.href, text })
    }
    const urls = new Set(clean.assets.map((a) => a.url))
    for (const s of sheetTexts) {
      // The project's own sheet is rebuilt, but the fonts bundled in it are kept: fetch only those.
      const source = adapterFor(cfg).ownSheet(s.text, cfg) ? splitFontFaces(s.text).faces.join('\n') : s.text
      for (const u of cssUrls(source, s.href ?? pageUrl)) urls.add(u)
    }
    const files = new Map()
    for (const u of urls) {
      const buf = await fetchBuf(page, u)
      if (buf) files.set(u, buf)
    }
    // processCapture resolves inline-sheet urls against cfg.url: use the page URL so they match the downloads.
    return processCapture({ root, cfg: { ...cfg, url: pageUrl }, screen, state, label, width, replace, clean, sheetTexts, files })
  }

  async function resize(width) {
    for (const p of appPages()) {
      const [, h] = await viewWidth(p)
      await p.setViewportSize({ width, height: h })
    }
  }

  return { context, appPages, copyFrom, resize, close: () => context.close() }
}
