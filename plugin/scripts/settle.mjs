// waitForQuietDom runs INSIDE the page (sent as source text) and in jsdom for tests: self-contained.
// Resolves when the DOM has not changed for quietMs, or at maxMs (a live stream never goes quiet).
// Returns the ms waited. Capture and match call it so late data (a card that loads after the expected
// text appears) is in the copy every time, not only when the timing is lucky.
export function waitForQuietDom(win, quietMs, maxMs) {
  return new Promise((resolve) => {
    const start = Date.now()
    let timer = null
    const done = () => {
      obs.disconnect()
      clearTimeout(cap)
      clearTimeout(timer)
      resolve(Date.now() - start)
    }
    const obs = new win.MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(done, quietMs)
    })
    obs.observe(win.document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    timer = setTimeout(done, quietMs)
    const cap = setTimeout(done, maxMs)
  })
}

export const SETTLE_QUIET_MS = 500
export const SETTLE_MAX_MS = 5000

export const settlePage = (page) =>
  page.evaluate(([fn, q, m]) => new Function(`return (${fn})`)()(window, q, m), [waitForQuietDom.toString(), SETTLE_QUIET_MS, SETTLE_MAX_MS])

// Motion that a static copy cannot hold. SVG animation elements (a logo's <animate>) are not stopped
// by Playwright's animations option, and a moving shape cannot be read back at a repeatable moment. So
// capture and the app side of match both remove them: every shape shows its resting value. CSS transitions
// are turned off so values jump to where they are going. Self-contained (sent to the page as source text).
export function removeSvgAnimations(win) {
  const els = win.document.querySelectorAll('animate, animateTransform, animateMotion, set')
  els.forEach((n) => n.remove())
  return els.length
}

// A style the tools add to a page under capture. Marked, so cleaning never copies it into a design.
export const addToolStyle = (page, css) =>
  page.evaluate((c) => {
    const s = document.createElement('style')
    s.setAttribute('data-hd-tool', '')
    s.textContent = c
    document.head.appendChild(s)
  }, css)

export async function freezePage(page) {
  // The last scripted click leaves the mouse over the page, so some element shows its hover style.
  await page.mouse.move(-10, -10)
  await addToolStyle(page, '*, *::before, *::after { transition: none !important; }')
  await page.evaluate((fn) => new Function(`return (${fn})`)()(window), removeSvgAnimations.toString())
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

// Pages under capture, app pages in match and rendered design pages ask for reduced motion: components then
// show their still form. Without it the logo decides by load timing (performance.now() < its intro window)
// whether to add its opening glint, so two copies of one state could differ.
export const PAGE_OPTIONS = { reducedMotion: 'reduce' }

