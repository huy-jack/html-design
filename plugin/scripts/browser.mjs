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

// Ctrl+Shift+S on any app page asks the session to copy that page. __hdLastInput: when the user last used
// this tab. A headful Playwright browser reports every tab visible and focused, so this names the tab in use.
const CHORD_SCRIPT = `window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); window.__hdCopy && window.__hdCopy() }
}, true)
for (const t of ['pointerdown', 'keydown', 'pointerover']) window.addEventListener(t, () => { window.__hdLastInput = Date.now() }, true)`

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
    await layOut(page)
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
  // The width each page is emulated at, while it is.
  const emulated = new WeakMap()
  const emulate = async (p, width) => {
    const [, h] = await viewWidth(p)
    await (await cdpOf(p)).send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 0, mobile: false })
    emulated.set(p, width)
  }
  // Polls until the page is width wide; false after ms.
  const reaches = async (p, width, ms) => {
    for (const until = Date.now() + ms; Date.now() < until; await new Promise((r) => setTimeout(r, 50))) if ((await viewWidth(p).catch(() => [0]))[0] === width) return true
    return false
  }
  // A tab behind keeps its old size after the window changed: it is not laid out. Bring it to the front and
  // wait (at most 2 s), so a copy is never stored at a stale width. A page at our emulated width is laid out.
  async function layOut(page) {
    if (emulated.has(page)) return
    let want
    try {
      const s = await cdpOf(page)
      const { windowId } = await s.send('Browser.getWindowForTarget')
      const { bounds } = await s.send('Browser.getWindowBounds', { windowId })
      const [inner, outer] = await page.evaluate(() => [window.innerWidth, window.outerWidth])
      if (outer === bounds.width) return
      want = bounds.width - (outer - inner)
    } catch { return }
    await page.bringToFront()
    await reaches(page, want, 2000)
  }

  // Resizes the real window (all app tabs share it), so the page follows the window as before. The window
  // bounds decide: Chrome lays out only the tab in front, so a tab behind reports its old size for seconds.
  // A width the window cannot reach (its minimum is about 500 px on macOS) falls back to an emulated size.
  // front: that app tab comes to the front first and is laid out at the new width before this returns.
  async function resize(width, { front = null } = {}) {
    if (front) await front.bringToFront()
    const pages = appPages().sort((a, b) => (b === front) - (a === front))
    // The pages of each window, and the windows that reached the width (only their pages skip emulation).
    const windows = new Map()
    const reached = new Set()
    const noWindow = []
    for (const p of pages) {
      const s = await cdpOf(p)
      await s.send('Emulation.clearDeviceMetricsOverride')
      emulated.delete(p)
      let windowId = null
      try {
        ;({ windowId } = await s.send('Browser.getWindowForTarget'))
        if (windows.has(windowId)) { windows.get(windowId).push(p); continue }
        windows.set(windowId, [p])
        const [inner, outer] = await p.evaluate(() => [window.innerWidth, window.outerWidth])
        await s.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
        await s.send('Browser.setWindowBounds', { windowId, bounds: { width: width + outer - inner } })
        const { bounds } = await s.send('Browser.getWindowBounds', { windowId })
        if (bounds.width === width + outer - inner) reached.add(windowId)
      } catch (e) {
        console.error(`Window resize failed: ${e.message}`)
        if (windowId === null) noWindow.push(p)
      }
    }
    // A window that did not reach the width (or failed) gets the emulated size; a page with no window is judged by itself.
    for (const [id, ps] of windows) if (!reached.has(id)) for (const p of ps) await emulate(p, width)
    for (const p of noWindow) if (!(await reaches(p, width, 1000))) await emulate(p, width)
    if (front && !(await reaches(front, width, 3000))) console.error(`The app tab is not ${width}px wide after the resize.`)
    // The other tabs only get a moment: a tab behind may keep its old size until it is shown.
    await Promise.all(appPages().map((p) => reaches(p, width, 1000)))
  }

  // What the tools show in an app tab: the countdown badge and the chord's toast. Marked data-hd-tool, so a
  // copy never holds one; pointer-events none, so it never takes a click or a hover from the app.
  const LABEL_CSS = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;padding:8px 12px;border-radius:8px;background:#121214;color:#ececee;font:500 13px/1.3 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)'
  const addLabel = (kind, text, css) => {
    const el = document.createElement('div')
    el.setAttribute('data-hd-tool', '')
    el.setAttribute(kind, '')
    el.style.cssText = css
    el.textContent = text
    ;(document.body ?? document.documentElement).appendChild(el)
    return el
  }
  // text null removes the badge.
  const badge = (page, text) =>
    page.evaluate(([add, t, css]) => {
      const el = document.querySelector('[data-hd-tool][data-hd-badge]')
      if (t === null) el?.remove()
      else if (el) el.textContent = t
      else new Function(`return (${add})`)()('data-hd-badge', t, css)
    }, [addLabel.toString(), text, LABEL_CSS]).catch(() => {})
  const toast = (page, text, ms = 2500) =>
    page.evaluate(([add, t, css, wait]) => {
      const el = new Function(`return (${add})`)()('data-hd-toast', t, css)
      setTimeout(() => el.remove(), wait)
    }, [addLabel.toString(), text, LABEL_CSS, ms]).catch(() => {})

  // The plugin's own tabs (home, a screen, the Copy tab): a link between them switches to the open tab
  // instead of opening one more. A screen goes into the open viewer tab; a new tab only when none is open.
  async function focus(path) {
    if (!viewerOrigin) return false
    const want = new URL(path, viewerOrigin)
    const pathOf = (p) => { try { const u = new URL(p.url()); return u.origin === want.origin ? u.pathname : null } catch { return null } }
    const own = context.pages().filter((p) => pathOf(p) !== null)
    const page = own.find((p) => pathOf(p) === want.pathname) ?? (want.pathname === '/__copy' ? null : own.find((p) => pathOf(p) !== '/__copy')) ?? (await context.newPage())
    if (page.url() !== want.href) await page.goto(want.href, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.bringToFront()
    return true
  }

  return { context, appPages, copyFrom, resize, badge, toast, focus, cdpPort, targetIdOf, close: () => context.close() }
}
