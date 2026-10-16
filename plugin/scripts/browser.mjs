// Browser part of a copy: opens the app in a real browser, reads one page, hands the result to processCapture.
// Downloads go through the browser context, so the user's login cookies apply.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { processCapture } from './capture-core.mjs'
import { darkMarker } from './config.mjs'
import { cssUrls, splitFontFaces } from './css-sort.mjs'
import { dataPaths, loadDep } from './deps.mjs'
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
  // The automation port lets a project's own scripts drive this browser and ask the session to copy a tab.
  const context = await chromium.launchPersistentContext(profileDir, { headless, channel: cfg.browser === 'chrome' ? 'chrome' : undefined, viewport: null, args: ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'] })
  // Chromium writes the port it chose as the first line of DevToolsActivePort in the profile.
  const portFile = join(profileDir, 'DevToolsActivePort')
  for (let i = 0; i < 50 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100))
  const cdpPort = existsSync(portFile) ? Number(readFileSync(portFile, 'utf8').split('\n')[0]) : null
  const targetIdOf = async (page) => {
    const s = await context.newCDPSession(page)
    try { return (await s.send('Target.getTargetInfo')).targetInfo.targetId } finally { await s.detach().catch(() => {}) }
  }
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

  // Copies at the page's current size. A resize here would close the app's open menus (many close on window
  // resize) and leave the page drawn wider than its window. keepPointer false: a scripted copy (see freezePage).
  async function copyFrom(page, { screen, state, label, replace = false, keepPointer = true }) {
    let clean_warn = null
    await settlePage(page)
    await freezePage(page, { keepPointer })
    const [w] = await viewWidth(page)
    const width = nearest(cfg.widths, w)
    if (width !== w) clean_warn = `window is ${w}px wide; stored as ${width}px`
    const clean = await page.evaluate(([src, opts]) => new Function('return (' + src + ')')()(document, opts), [CLEAN_SRC, { dark: darkMarker(cfg.dark) }])
    const pageUrl = page.url()
    if (clean_warn) clean.warnings.push(clean_warn)
    const sheetTexts = []
    for (const s of clean.sheets) {
      let raw = null
      // A <link> sheet: also the served file. The rule list the page parsed drops comments, and the banner
      // that marks the app's own Tailwind 3 output is a comment, so the served file decides which sheet is
      // the app's own. The rule list is still what gets stored; the served file only when it is missing.
      if (s.href) {
        const buf = await fetchBuf(page, s.href)
        if (buf) raw = buf.toString('utf8')
        else if (s.text === null) { clean.warnings.push(`css file not downloaded: ${s.href}`); continue }
      }
      const text = s.text ?? raw
      if (text !== null) sheetTexts.push({ href: s.href, text, raw })
    }
    const urls = new Set(clean.assets.map((a) => a.url))
    for (const s of sheetTexts) {
      // The project's own sheet is rebuilt, but the fonts bundled in it are kept: fetch only those.
      const source = adapterFor(cfg).ownSheet(s.raw ?? s.text, cfg) ? splitFontFaces(s.text).faces.join('\n') : s.text
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

  // One CDP session per app page, kept open: an emulated size lasts only while the session that set it is
  // attached, and only that session can clear it.
  const sessions = new WeakMap()
  const cdpOf = async (p) => {
    if (!sessions.has(p)) sessions.set(p, await context.newCDPSession(p))
    return sessions.get(p)
  }
  // Resizes the real window (all app tabs share it), so the page follows the window as before. A width the
  // window cannot reach (its minimum is about 500 px on macOS) falls back to an emulated page size.
  async function resize(width) {
    const windows = new Set()
    for (const p of appPages()) {
      const s = await cdpOf(p)
      await s.send('Emulation.clearDeviceMetricsOverride')
      try {
        const { windowId } = await s.send('Browser.getWindowForTarget')
        if (windows.has(windowId)) continue
        windows.add(windowId)
        const [inner, outer] = await p.evaluate(() => [window.innerWidth, window.outerWidth])
        await s.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
        await s.send('Browser.setWindowBounds', { windowId, bounds: { width: width + outer - inner } })
      } catch (e) { console.error(`Window resize failed: ${e.message}`) }
    }
    for (const p of appPages()) {
      let w = 0
      for (let i = 0; i < 20 && (w = (await viewWidth(p))[0]) !== width; i++) await new Promise((r) => setTimeout(r, 50))
      if (w === width) continue
      const [, h] = await viewWidth(p)
      await (await cdpOf(p)).send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 0, mobile: false })
    }
  }

  return { context, appPages, copyFrom, resize, cdpPort, targetIdOf, close: () => context.close() }
}
