// The viewer in a real browser: Pick mode, the note box that never loses text, the notes list, session stop.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readConfig, writeConfig } from '../plugin/scripts/config.mjs'
import { readNotes } from '../plugin/scripts/notes.mjs'
import { serializeScreen } from '../plugin/scripts/screen-file.mjs'
import { makeSkeleton } from '../plugin/scripts/setup.mjs'
import { createViewServer } from '../plugin/scripts/view.mjs'

function project() {
  const r = mkdtempSync(join(tmpdir(), 'gv-'))
  execFileSync('git', ['init', '-q'], { cwd: r })
  writeFileSync(join(r, 'app.css'), '@import "tailwindcss";\n')
  writeConfig(r, { css: 'app.css', themeVars: [] })
  makeSkeleton(r, readConfig(r))
  const cfg = readConfig(r)
  const states = [['a', 'Alpha', '<main><section><h2>Billing</h2><p id="one">Update details</p></section><p id="two">Second</p></main>'], ['b', 'Beta', '<p>b</p>'], ['c', 'Gamma', '<p>c</p>']]
  writeFileSync(join(r, 'design/screens/x.html'), serializeScreen({ screen: 'x', states: states.map(([id, label, html]) => ({ id, attrs: { 'data-label': label }, html })) }))
  return { r, cfg }
}

let br
let cleanup = []
beforeAll(async () => { const { chromium } = await import('playwright'); br = await chromium.launch({ headless: true }) })
afterAll(async () => { await br?.close() })
afterEach(async () => { for (const f of cleanup.reverse()) await f(); cleanup = [] })
async function open(opts = {}, viewport = { width: 1440, height: 900 }) {
  const { r, cfg } = project()
  const v = await createViewServer({ root: r, cfg, build: false, watch: false, dataDir: null, port: 0, ...opts })
  cleanup.push(() => v.close())
  const ctx = await br.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] })
  cleanup.push(() => ctx.close())
  const pg = await ctx.newPage()
  await pg.goto(`${v.url}/screens/x.html#a@1440`)
  await pg.waitForFunction(() => document.querySelector('iframe.sd-frame')?.contentDocument?.getElementById('one'))
  const frame = pg.frameLocator('iframe.sd-frame')
  return { r, cfg, v, pg, frame }
}
const q = (key) => `[data-sd="${key}"]`
const text = (pg, sel) => pg.locator(sel).innerText()

describe('screen key', () => {
  it('a screen named "Settings" (file settings.html): a Pick note saves under the file name and shows in the list', async () => {
    const { r, cfg } = project()
    writeFileSync(join(r, 'design/screens/settings.html'), serializeScreen({ screen: 'Settings', states: [{ id: 'a', attrs: { 'data-label': 'Alpha' }, html: '<main><p id="one">Update details</p></main>' }] }))
    const v = await createViewServer({ root: r, cfg, build: false, watch: false, dataDir: null, port: 0 })
    cleanup.push(() => v.close())
    const pg = await br.newPage()
    cleanup.push(() => pg.close())
    await pg.goto(`${v.url}/screens/settings.html#a@1440`)
    await pg.waitForFunction(() => document.querySelector('iframe.sd-frame')?.contentDocument?.getElementById('one'))
    expect(await pg.locator('.sd-scr b').innerText()).toBe('Settings')
    await pg.keyboard.press('p')
    await pg.frameLocator('iframe.sd-frame').locator('#one').click()
    await pg.fill(q('note-input'), 'bigger')
    await pg.press(q('note-input'), 'Enter')
    await pg.locator(q('toast')).waitFor({ state: 'visible' })
    expect(readNotes(r, cfg).map((n) => [n.screen, n.state, n.note])).toEqual([['settings', 'a', 'bigger']])
    await pg.click(q('notes'))
    await pg.locator('[data-sd-note]').first().waitFor()
    expect(await pg.locator('[data-sd-note]').first().innerText()).toContain('bigger')
  }, 30000)
})

describe('Pick mode', () => {
  it('Pick on: the button turns the Pick color, a bar says what to do, a tag follows the pointer; Esc stops it', async () => {
    const { pg, frame } = await open()
    await pg.keyboard.press('p')
    expect(await pg.locator(q('pick')).getAttribute('aria-pressed')).toBe('true')
    expect(await pg.locator(q('pick')).evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(225, 29, 116)')
    expect(await text(pg, q('pickbar'))).toBe('Pick is on. Click any part of the design to write a note. Press Esc or P to stop.')
    // The hint names the element in the pink bar, so nothing covers the element's neighbours.
    await frame.locator('#one').hover()
    await pg.waitForFunction(() => /Update details/.test(document.querySelector('[data-sd="pickbar"]').innerText))
    expect(await text(pg, q('pickbar'))).toBe('Click to add a note on: "Update details". Press Esc or P to stop.')
    expect(await pg.locator(q('picktag')).count()).toBe(0)
    expect(await frame.locator('#one').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed')
    await pg.keyboard.press('Escape')
    expect(await pg.locator(q('pick')).getAttribute('aria-pressed')).toBe('false')
    expect(await pg.locator(q('pickbar')).isHidden()).toBe(true)
  }, 30000)
})

describe('note box', () => {
  it('names the element and its nearest heading, marks it with a solid outline and a pin, asks before it drops typed text', async () => {
    const { pg, frame } = await open()
    await pg.keyboard.press('p')
    await frame.locator('#one').click()
    expect(await text(pg, q('note-label'))).toBe('Note on: "Update details" in Billing')
    expect(await frame.locator('#one').evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineColor, getComputedStyle(el).outlineWidth])).toEqual(['solid', 'rgb(225, 29, 116)', '2px'])
    await frame.locator('#two').hover()
    expect(await frame.locator('#one').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
    expect(await text(pg, q('pin'))).toBe('1')
    await pg.fill(q('note-input'), 'bigger please')
    // The box takes its own row under the design, so it never covers the frame.
    const stageBottom = await pg.locator('.sd-stage').evaluate((el) => el.getBoundingClientRect().bottom)
    expect(await pg.locator('.sd-notebox').evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(stageBottom)
    await frame.locator('#two').click()
    expect(await text(pg, q('discard'))).toContain('Discard this note?')
    await pg.click(q('keep'))
    expect(await pg.inputValue(q('note-input'))).toBe('bigger please')
    expect(await text(pg, q('note-label'))).toBe('Note on: "Update details" in Billing')
    await pg.focus(q('note-input'))
    await pg.keyboard.press('Escape')
    expect(await pg.locator(q('discard')).isVisible()).toBe(true)
    await pg.click(q('discard-yes'))
    expect(await pg.locator('.sd-notebox').count()).toBe(0)
    expect(await pg.locator(q('pin')).isHidden()).toBe(true)
    expect(await frame.locator('#one').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')
    // An empty box closes at once. No heading before it in its own block: the label has none.
    await frame.locator('#two').click()
    expect(await text(pg, q('note-label'))).toBe('Note on: "Second"')
    await pg.keyboard.press('Escape')
    expect(await pg.locator('.sd-notebox').count()).toBe(0)
  }, 30000)

  it('stays open until the save returns; on failure keeps the text and says how to recover', async () => {
    const { pg, frame } = await open()
    let mode = 'down'
    await pg.route('**/__notes', (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      if (mode === 'down') return route.abort()
      return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"note must be 1 to 2000 characters"}' })
    })
    await pg.keyboard.press('p')
    await frame.locator('#one').click()
    await pg.fill(q('note-input'), 'bigger please')
    await pg.click('.sd-notebox [type=submit]')
    await pg.locator(q('note-error')).waitFor({ state: 'visible' })
    expect(await text(pg, q('note-error'))).toBe('Not saved: the session is stopped. In Claude Code, type /html-design start, then press Save again.')
    expect(await pg.inputValue(q('note-input'))).toBe('bigger please')
    mode = 'bad'
    await pg.click('.sd-notebox [type=submit]')
    await pg.waitForFunction(() => /note must be/.test(document.querySelector('[data-sd="note-error"]').innerText))
    expect(await text(pg, q('note-error'))).toBe('Not saved: note must be 1 to 2000 characters')
    expect(await pg.inputValue(q('note-input'))).toBe('bigger please')
  }, 30000)

  it('a saved note: a toast says what to do next with a Copy button, the count is a button, the state row shows the count', async () => {
    const { r, cfg, pg, frame } = await open()
    await pg.keyboard.press('p')
    await frame.locator('#one').click()
    await pg.fill(q('note-input'), 'bigger please')
    await pg.press(q('note-input'), 'Enter')
    await pg.locator(q('toast')).waitFor({ state: 'visible' })
    expect(await text(pg, q('toast'))).toContain('Note saved. When you are done, say do my notes in Claude Code.')
    // Never over the design: the toast sits below the stage that holds the frame.
    const stageBottom = await pg.locator('.sd-stage').evaluate((el) => el.getBoundingClientRect().bottom)
    expect(await pg.locator(q('toast')).evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(stageBottom)
    expect(await pg.locator('.sd-notebox').count()).toBe(0)
    expect(readNotes(r, cfg).map((n) => [n.state, n.text, n.note])).toEqual([['a', 'Update details', 'bigger please']])
    expect(await text(pg, q('toast-copy'))).toBe('Copy "do my notes"')
    // It stays until the user acts.
    await pg.waitForTimeout(6500)
    expect(await pg.locator(q('toast')).isVisible()).toBe(true)
    await pg.click(q('toast-copy'))
    expect(await pg.evaluate(() => navigator.clipboard.readText())).toBe('do my notes')
    await pg.waitForFunction(() => document.querySelector('[data-sd="notes"]').innerText === '1 note')
    expect(await pg.locator(q('notes')).evaluate((b) => b.tagName)).toBe('BUTTON')
    expect(await text(pg, '[data-sd-state="a"] .sd-ncount')).toBe('1')
  }, 30000)

  it('the toast also goes when Pick is turned on again', async () => {
    const { pg, frame } = await open()
    await pg.keyboard.press('p')
    await frame.locator('#one').click()
    await pg.fill(q('note-input'), 'x')
    await pg.press(q('note-input'), 'Enter')
    await pg.locator(q('toast')).waitFor({ state: 'visible' })
    await pg.keyboard.press('p')
    expect(await pg.locator(q('toast')).count()).toBe(1)
    await pg.keyboard.press('p')
    expect(await pg.locator(q('toast')).count()).toBe(0)
  }, 30000)
})

describe('notes list', () => {
  it('lists the open notes of this screen with Edit and Delete; changes go to the notes file', async () => {
    const { r, cfg, v, pg } = await open()
    const post = (body) => fetch(`${v.url}/__notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ screen: 'x', width: 1440, theme: 'light', path: [1, 1], tag: 'p', ...body }) })
    await post({ state: 'a', text: 'Update details', note: 'bigger' })
    await post({ state: 'b', text: 'b', note: 'red' })
    await pg.reload()
    await pg.waitForFunction(() => document.querySelector('[data-sd="notes"]').innerText === '2 notes')
    await pg.click(q('notes'))
    const rows = pg.locator('[data-sd-note]')
    await rows.first().waitFor()
    expect(await rows.count()).toBe(2)
    const stageBottom = await pg.locator('.sd-stage').evaluate((el) => el.getBoundingClientRect().bottom)
    expect(await pg.locator(q('notes-list')).evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(stageBottom)
    expect(await rows.first().innerText()).toContain('"Update details"')
    expect(await rows.first().innerText()).toContain('Alpha')
    expect(await rows.first().innerText()).toContain('bigger')
    // Pointing at a row marks its element on the design (it is on the state shown).
    await rows.first().hover()
    expect(await pg.frameLocator('iframe.sd-frame').locator('section').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
    expect(await text(pg, q('pin'))).toBe('1')
    await rows.first().locator(q('note-edit')).click()
    await rows.first().locator('input').fill('much bigger')
    await rows.first().locator(q('note-save')).click()
    await pg.waitForFunction(() => /much bigger/.test(document.querySelector('[data-sd-note]').innerText))
    await rows.nth(1).locator(q('note-delete')).click()
    await rows.nth(1).locator(q('note-delete')).click()
    await pg.waitForFunction(() => document.querySelectorAll('[data-sd-note]').length === 1)
    expect(readNotes(r, cfg).map((n) => [n.state, n.note])).toEqual([['a', 'much bigger']])
    expect(await text(pg, q('notes'))).toBe('1 note')
  }, 30000)
})

describe('viewer states', () => {
  it('session stopped: a bar names the start command and Pick is off with that reason', async () => {
    const { v, pg } = await open()
    await v.close()
    await pg.locator(q('stopped')).waitFor({ state: 'visible', timeout: 10000 })
    expect(await text(pg, q('stopped'))).toBe('Session stopped. Notes cannot be saved. In Claude Code, type /html-design start.')
    expect(await pg.locator(q('pick')).isDisabled()).toBe(true)
    expect(await pg.locator(q('pick')).getAttribute('title')).toBe('Session stopped. Notes cannot be saved. In Claude Code, type /html-design start.')
  }, 30000)

  // Updating (before the reload) is checked in switcher-ui.spec.mjs, where the event can be sent by hand.
  it('a design change reloads the viewer, which then says Updated in the bar', async () => {
    const { r } = project()
    const cfg = readConfig(r)
    const v = await createViewServer({ root: r, cfg, build: false, watch: true, dataDir: null, port: 0 })
    cleanup.push(() => v.close())
    const pg = await br.newPage()
    cleanup.push(() => pg.close())
    await pg.goto(`${v.url}/screens/x.html#a@1440`)
    await pg.waitForFunction(() => document.querySelector('iframe.sd-frame')?.contentDocument?.getElementById('one'))
    writeFileSync(join(r, 'design/screens/x.html'), serializeScreen({ screen: 'x', states: [{ id: 'a', attrs: { 'data-label': 'Alpha' }, html: '<p id="one">changed</p>' }] }))
    await pg.waitForFunction(() => document.querySelector('iframe.sd-frame')?.contentDocument?.getElementById('one')?.textContent === 'changed', null, { timeout: 5000 })
    await pg.waitForFunction(() => document.querySelector('[data-sd="status"]').innerText === 'Updated', null, { timeout: 3000 })
  }, 30000)

  it('below 1280 px: the title has 160 px, no arrows in the bar, the second line and 1/3 move to the caption', async () => {
    const { pg } = await open({}, { width: 1024, height: 768 })
    expect(await pg.locator('.sd-title').evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(160)
    expect(await pg.locator(q('prev')).isVisible()).toBe(false)
    expect(await pg.locator(q('next')).isVisible()).toBe(false)
    expect(await pg.locator('.sd-title span').isVisible()).toBe(false)
    expect(await pg.getAttribute('.sd-title', 'title')).toBe('a')
    expect(await text(pg, q('cap-note'))).toBe('a')
    expect(await text(pg, q('cap-count'))).toBe('1/3')
    await pg.setViewportSize({ width: 1440, height: 900 })
    expect(await pg.locator(q('prev')).isVisible()).toBe(true)
    expect(await pg.locator(q('cap-count')).isVisible()).toBe(false)
  }, 30000)

  it('pressed options are raised chips, not blue; the disabled main button is grey, not faded', async () => {
    const { pg, frame } = await open()
    const look = (sel) => pg.locator(sel).evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.fontWeight] })
    expect(await look('[data-width="1440"]')).toEqual(['rgb(255, 255, 255)', 'rgb(24, 24, 27)', '600'])
    expect(await look('[data-zoom="fit"]')).toEqual(['rgb(255, 255, 255)', 'rgb(24, 24, 27)', '600'])
    expect(await look('[data-theme="light"]')).toEqual(['rgb(255, 255, 255)', 'rgb(24, 24, 27)', '600'])
    await pg.route('**/__notes', (route) => (route.request().method() === 'POST' ? new Promise(() => {}) : route.continue()))
    await pg.keyboard.press('p')
    await frame.locator('#one').click()
    await pg.fill(q('note-input'), 'x')
    await pg.press(q('note-input'), 'Enter')
    const save = '.sd-notebox [type=submit]'
    await pg.waitForFunction((s) => document.querySelector(s).disabled, save)
    expect(await pg.locator(save).evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.opacity] })).toEqual(['rgb(228, 228, 231)', 'rgb(99, 99, 107)', '1'])
  }, 30000)

  it('Hide list (L) and zoom 100% give the design the room; below 900 px the states are a drop-down in the bar', async () => {
    const { pg } = await open({}, { width: 1024, height: 768 })
    const frameW = () => pg.locator('.sd-fit').evaluate((el) => el.getBoundingClientRect().width)
    const before = await frameW()
    await pg.keyboard.press('l')
    expect(await pg.locator('.sd-side').isHidden()).toBe(true)
    expect(await frameW()).toBeGreaterThan(before + 200)
    await pg.click('[data-zoom="100"]')
    expect(await pg.locator('iframe.sd-frame').evaluate((f) => f.style.transform)).toBe('')
    expect(await text(pg, q('size'))).toBe('1440 px')
    await pg.setViewportSize({ width: 800, height: 700 })
    // The side list is gone, so the bar has the way back to all screens.
    expect(await pg.locator(q('home-bar')).isVisible()).toBe(true)
    expect(await pg.getAttribute(q('home-bar'), 'href')).toBe('/')
    await pg.selectOption(q('state-pick'), 'c')
    await pg.waitForFunction(() => location.hash === '#c@1440')
  }, 30000)
})
