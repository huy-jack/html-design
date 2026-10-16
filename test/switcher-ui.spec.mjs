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

  it('shows the note count of this screen as a button: 1 note, 2 notes', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#b@1440', (u) => (String(u).startsWith('/__notes') ? reply({ topic: 't', open: 5, byState: { a: 1, b: 1 } }) : reply({})))
    expect(q(w, 'notes').textContent).toBe('2 notes')
    expect(q(w, 'notes').tagName).toBe('BUTTON')
    const one = await boot('http://127.0.0.1:8900/screens/x.html#b@1440', (u) => (String(u).startsWith('/__notes') ? reply({ open: 1, byState: { b: 1 } }) : reply({})))
    expect(q(one, 'notes').textContent).toBe('1 note')
    expect(q(w, 'live')).toBeNull()
  })

  it('shows a broken notes file instead of a count', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#a@1440', (u) =>
      String(u).startsWith('/__notes') ? reply({ topic: 't', open: 0, error: 'The notes file is not valid JSON' }) : reply({ live: false, reason: 'x' }),
    )
    expect(q(w, 'notes').textContent).toBe('The notes file is not valid JSON')
  })
})

// A stand-in for the reload stream, so a test can send its events by hand.
function fakeEvents(w) {
  const all = []
  w.EventSource = class {
    constructor() { this.l = {}; all.push(this) }
    addEventListener(t, f) { (this.l[t] ||= []).push(f) }
    emit(t, data = '') { const e = { data }; if (t === 'message' && this.onmessage) this.onmessage(e); for (const f of this.l[t] || []) f(e); if (t === 'error' && this.onerror) this.onerror(e) }
  }
  return all
}
async function bootWith(url, fetchImpl, before) {
  const dom = new JSDOM(PAGE, { url, runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  w.fetch = fetchImpl ?? (() => Promise.reject(new Error('down')))
  const out = before ? before(w) : null
  w.eval(SRC)
  if (w.document.readyState !== 'complete') await new Promise((r) => w.addEventListener('load', r))
  await tick(w)
  await tick(w)
  return { w, out }
}

describe('guided viewer bar', () => {
  it('the design theme is a 2-option group next to the widths: Design: Light | Dark', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#a@1440')
    const group = q(w, 'design-theme')
    expect(group.getAttribute('role')).toBe('group')
    expect(group.getAttribute('aria-label')).toBe('Design theme')
    expect(group.textContent).toBe('Design:LightDark')
    expect(group.previousElementSibling.classList.contains('sd-seg')).toBe(true)
    const [light, dark] = group.querySelectorAll('button')
    expect([light.getAttribute('aria-pressed'), dark.getAttribute('aria-pressed')]).toEqual(['true', 'false'])
    dark.click()
    expect(w.document.querySelector('[data-theme="dark"]').getAttribute('aria-pressed')).toBe('true')
    expect(w.document.querySelector('.sd-keys').textContent).toContain('design light/dark')
  })
  it('the screen head says the state count in words', async () => {
    const w = await boot('file:///r/design/screens/x.html#a')
    expect(q(w, 'states').textContent).toBe('3 states')
  })
  it('a state with notes shows the count as text next to its dot', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#a@1440', (u) => (String(u).startsWith('/__notes') ? reply({ open: 2, byState: { b: 2 } }) : reply({})))
    expect(w.document.querySelector('[data-sd-state="b"] .sd-ncount').textContent).toBe('2')
  })
  it('the filter shows how many states match, and Enter opens the first one', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#a@1440')
    const s = w.document.querySelector('input[type="search"]')
    expect(q(w, 'filter-count').textContent).toBe('')
    s.value = 'c'
    s.dispatchEvent(new w.Event('input'))
    expect(q(w, 'filter-count').textContent).toBe('1 of 3')
    s.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await tick(w)
    expect(w.location.hash).toBe('#c@1440')
  })
  it('L hides and shows the state list', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#a@1440')
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'l', bubbles: true }))
    expect(w.document.querySelector('.sd-app').classList.contains('sd-nolist')).toBe(true)
    expect(q(w, 'hide-list').getAttribute('aria-pressed')).toBe('true')
    q(w, 'hide-list').click()
    expect(w.document.querySelector('.sd-app').classList.contains('sd-nolist')).toBe(false)
  })
  it('a tool theme switch in the side panel footer, apart from the design theme, remembered for every plugin page', async () => {
    const w = await boot('http://127.0.0.1:8900/screens/x.html#a@1440')
    const app = w.document.querySelector('.sd-app')
    expect(app.getAttribute('data-ui')).toBeNull()
    expect(q(w, 'ui-theme').closest('.sd-side')).not.toBeNull()
    expect(q(w, 'ui-theme').closest('.sd-bar')).toBeNull()
    expect(q(w, 'ui-theme').textContent).toBe('Tool colors: Light')
    q(w, 'ui-theme').click()
    expect(q(w, 'ui-theme').textContent).toBe('Tool colors: Dark')
    expect(app.getAttribute('data-ui')).toBe('dark')
    expect(w.localStorage.getItem('hd-ui')).toBe('dark')
    expect(JSON.parse(w.sessionStorage.getItem('sd-view') || '{}').theme ?? 'light').toBe('light')
  })
  it('a change on its way shows Updating in the bar', async () => {
    const { w, out } = await bootWith('http://127.0.0.1:8900/screens/x.html#a@1440', undefined, fakeEvents)
    out[0].emit('change')
    expect(q(w, 'status').textContent).toBe('Updating…')
  })
  it('a failed build: a titled card says the last good version shows and what to say; the raw output is behind Show details', async () => {
    const { w, out } = await bootWith('http://127.0.0.1:8900/screens/x.html#a@1440', undefined, fakeEvents)
    out[0].emit('change')
    out[0].emit('buildError', JSON.stringify('CSS build failed: boom'))
    const card = q(w, 'build-error')
    expect(card.querySelector('b').textContent).toBe('The design styles did not build. The last good version is shown. In Claude Code, say: fix the build.')
    expect(card.querySelector('details summary').textContent).toBe('Show details')
    expect(card.querySelector('details').textContent).toContain('CSS build failed: boom')
    expect(q(w, 'status').textContent).toBe('')
  })
  it('a lost stream with no server: the stopped bar, and Pick is off with the reason', async () => {
    const { w, out } = await bootWith('http://127.0.0.1:8900/screens/x.html#a@1440', (u) => (String(u).startsWith('/__notes?') ? reply({ open: 0 }) : Promise.reject(new Error('down'))), fakeEvents)
    out[0].emit('error')
    await tick(w); await tick(w)
    expect(q(w, 'stopped').hidden).toBe(false)
    expect(q(w, 'pick').disabled).toBe(true)
    out[0].emit('open')
    if (out[0].onopen) out[0].onopen()
    expect(q(w, 'stopped').hidden).toBe(true)
    expect(q(w, 'pick').disabled).toBe(false)
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
    const dark = w.document.querySelector('.sd-bar [data-theme="dark"]')
    expect(dark.getAttribute('aria-pressed')).toBe('true')
    expect(q(w, 'pick').getAttribute('aria-pressed')).toBe('true')
    w.document.querySelector('.sd-bar [data-theme="light"]').click()
    q(w, 'pick').click()
    expect(JSON.parse(w.sessionStorage.getItem('sd-view'))).toEqual({ theme: 'light', picking: false })
  })
})

describe('redesigned viewer', () => {
  const GROUPED =
    '<!doctype html><html data-screen="x"><head></head><body>' +
    '<template id="a" data-label="Alpha" data-group="One" data-url="/a"><p>a</p></template>' +
    '<template id="b" data-label="Beta" data-group="One"><p>b</p></template>' +
    '<template id="c" data-label="Gamma" data-group="Two"><p>c</p></template>' +
    '</body></html>'
  async function bootGrouped(url, fetchImpl) {
    const dom = new JSDOM(GROUPED, { url, runScripts: 'outside-only', pretendToBeVisual: true })
    const w = dom.window
    w.fetch = fetchImpl ?? (() => Promise.reject(new Error('down')))
    w.eval(SRC)
    if (w.document.readyState !== 'complete') await new Promise((r) => w.addEventListener('load', r))
    await tick(w)
    await tick(w)
    return w
  }

  it('lists the states by group in a side list; a click opens one at the same width', async () => {
    const w = await bootGrouped('http://127.0.0.1:8900/screens/x.html#a@375')
    const list = q(w, 'list')
    expect([...list.querySelectorAll('[data-sd-group]')].map((g) => g.textContent)).toEqual(['One', 'Two'])
    expect([...list.querySelectorAll('[data-sd-state]')].map((r) => r.getAttribute('data-sd-state'))).toEqual(['a', 'b', 'c'])
    expect(list.querySelector('[data-sd-state="a"]').getAttribute('aria-current')).toBe('true')
    list.querySelector('[data-sd-state="c"]').click()
    await tick(w)
    expect(w.location.hash).toBe('#c@375')
  })
  it('filters the list by the search box', async () => {
    const w = await bootGrouped('file:///r/design/screens/x.html#a')
    const s = w.document.querySelector('input[type="search"]')
    s.value = 'gam'
    s.dispatchEvent(new w.Event('input'))
    expect([...q(w, 'list').querySelectorAll('[data-sd-state]')].map((r) => r.getAttribute('data-sd-state'))).toEqual(['c'])
  })
  it('keys: 1 2 3 pick a width, up and down step through states', async () => {
    const w = await bootGrouped('http://127.0.0.1:8900/screens/x.html#a@1440')
    const key = (k) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }))
    key('3'); await tick(w)
    expect(w.location.hash).toBe('#a@375')
    key('ArrowDown'); await tick(w)
    expect(w.location.hash).toBe('#b@375')
    key('ArrowUp'); await tick(w)
    expect(w.location.hash).toBe('#a@375')
  })
  it('keeps the frame at the true width and names it, with the page the state was copied from', async () => {
    const w = await bootGrouped('http://127.0.0.1:8900/screens/x.html#a@1024')
    expect(w.document.querySelector('iframe.sd-frame').style.width).toBe('1024px')
    expect(q(w, 'size').textContent).toMatch(/^1024 px/)
    expect(q(w, 'source').textContent).toContain('/a')
  })
  it('marks states that have open notes', async () => {
    const w = await bootGrouped('http://127.0.0.1:8900/screens/x.html#a@1440', (u) => (String(u).startsWith('/__notes') ? reply({ open: 2, byState: { b: 2 } }) : reply({})))
    await tick(w)
    expect(q(w, 'list').querySelector('[data-sd-state="b"] [data-sd-notedot]')).not.toBeNull()
    expect(q(w, 'list').querySelector('[data-sd-state="a"] [data-sd-notedot]')).toBeNull()
  })
})
