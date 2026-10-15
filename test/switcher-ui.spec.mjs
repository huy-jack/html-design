import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'

const SRC = readFileSync(join(import.meta.dirname, '..', 'plugin', 'templates', 'switcher.js'), 'utf8')
const PAGE =
  '<!doctype html><html data-screen="x"><head></head><body>' +
  '<template id="a" data-flow="f" data-label="A"><p>a</p></template>' +
  '<template id="b" data-flow="f" data-label="B"><p>b</p></template>' +
  '<template id="c" data-flow="f" data-label="C"><p>c</p></template>' +
  '</body></html>'

const tick = (w) => new Promise((r) => w.setTimeout(r, 0))
const q = (w, key) => w.document.querySelector(`[data-sd="${key}"]`)
const reply = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

async function boot(url, fetchImpl, saved) {
  const dom = new JSDOM(PAGE, { url, runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  if (saved) w.sessionStorage.setItem('sd-view', JSON.stringify(saved))
  w.fetch = fetchImpl ?? (() => Promise.reject(new Error('down')))
  w.eval(SRC)
  if (w.document.readyState !== 'complete') await new Promise((r) => w.addEventListener('load', r))
  await tick(w)
  await tick(w)
  return w
}

describe('switcher bar', () => {
  it('steps through states with Previous / Next and the arrow keys, not while typing', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#a@375')
    expect(q(w, 'prev').disabled).toBe(true)
    q(w, 'next').click()
    await tick(w)
    expect(w.location.hash).toBe('#b@375')
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await tick(w)
    expect(w.location.hash).toBe('#c@375')
    expect(q(w, 'next').disabled).toBe(true)
    w.document.querySelector('input[type="search"]').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await tick(w)
    expect(w.location.hash).toBe('#c@375')
  })

  it('hides the server tools when the file is opened by double-click (Review Focus 1)', async () => {
    const w = await boot('file:///r/design/screens/x.html#a')
    expect(q(w, 'pick')).toBeNull()
    expect(q(w, 'notes')).toBeNull()
    expect(q(w, 'next')).not.toBeNull()
  })

  it('shows the open note count', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#b@1440', (u) => (String(u).startsWith('/__notes') ? reply({ topic: 't', open: 2 }) : reply({})))
    expect(q(w, 'notes').textContent).toBe('2 open notes')
    expect(q(w, 'live')).toBeNull()
  })

  it('shows a broken notes file instead of a count', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#a@1440', (u) =>
      String(u).startsWith('/__notes') ? reply({ topic: 't', open: 0, error: 'The notes file is not valid JSON' }) : reply({ live: false, reason: 'x' }),
    )
    expect(q(w, 'notes').textContent).toBe('The notes file is not valid JSON')
  })
})

describe('links in the viewer', () => {
  it('warns about a broken link list and a link to a state that does not exist', async () => {
    const page = PAGE.replace('</body>', '<script type="application/json" id="sd-links">[oops</script></body>')
    const dom = new JSDOM(page, { url: 'file:///r/design/screens/x.html#a', runScripts: 'outside-only' })
    dom.window.eval(SRC)
    if (dom.window.document.readyState !== 'complete') await new Promise((r) => dom.window.addEventListener('load', r))
    await tick(dom.window)
    expect(dom.window.document.querySelector('[data-sd="link-warn"]').textContent).toBe('The link list is not valid JSON')
  })
})

describe('viewer settings across a reload', () => {
  it('keeps theme and Pick after the page reloads for a design change', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#a@1440', undefined, { theme: 'dark', picking: true })
    const dark = w.document.querySelector('.sd-bar button:not([data-sd]):not([data-width])')
    expect(dark.getAttribute('aria-pressed')).toBe('true')
    expect(q(w, 'pick').getAttribute('aria-pressed')).toBe('true')
    dark.click()
    q(w, 'pick').click()
    expect(JSON.parse(w.sessionStorage.getItem('sd-view'))).toEqual({ theme: 'light', picking: false })
  })
})
