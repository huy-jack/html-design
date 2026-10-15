import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSwitcher, writeSwitcher } from '../plugin/scripts/switcher-node.mjs'

const SD = loadSwitcher()

describe('switcher helpers', () => {
  it('parses state links', () => {
    expect(SD.parseHash('#ai-failed@375')).toEqual({ id: 'ai-failed', width: 375 })
    expect(SD.parseHash('#ready')).toEqual({ id: 'ready', width: 1440 })
    expect(SD.parseHash('#ready@999')).toEqual({ id: 'ready', width: 1440 })
    expect(SD.parseHash('')).toEqual({ id: null, width: 1440 })
  })
  it('builds a state document with app classes, theme and base', () => {
    const doc = SD.buildStateDoc({ html: '<main>Hi</main>', attrs: { 'data-html-class': 'app-fonts', 'data-body-class': 'bg-background', 'data-html-lang': 'de' } }, { theme: 'dark', base: 'file:///r/design/screens/x.html' })
    expect(doc).toContain('<html lang="de" class="app-fonts dark">')
    expect(doc).toContain('<base href="file:///r/design/screens/x.html">')
    expect(doc).toContain('<link rel="stylesheet" href="../dist/design.css"><link rel="stylesheet" href="../fonts.css"><link rel="stylesheet" href="../page.css">')
    expect(doc).toContain('<body class="bg-background"><main>Hi</main></body>')
  })
  it('puts the copied --vars back on html and body', () => {
    const doc = SD.buildStateDoc({ html: '<p>x</p>', attrs: { 'data-html-vars': '--accent:rgb(9, 9, 9)', 'data-body-vars': '--gap:4px' } }, { theme: 'light', base: 'x' })
    expect(doc).toContain('<html lang="en" class="" style="--accent:rgb(9, 9, 9)">')
    expect(doc).toContain('<body class="" style="--gap:4px"><p>x</p></body>')
  })
  it('uses the width copy when the state has one for that width', () => {
    const state = { html: '<p>wide</p>', attrs: {}, variants: [{ widths: [1024, 375], html: '<p>narrow</p>' }] }
    expect(SD.buildStateDoc(state, { theme: 'light', base: 'x', width: 375 })).toContain('<p>narrow</p>')
    expect(SD.buildStateDoc(state, { theme: 'light', base: 'x', width: 1440 })).toContain('<p>wide</p>')
    expect(SD.buildStateDoc(state, { theme: 'light', base: 'x' })).toContain('<p>wide</p>')
  })
  it('restores saved scroll positions (Review Focus 2)', () => {
    const { document } = new JSDOM('<div id="a" data-scroll-top="240"></div>').window
    const el = document.getElementById('a')
    let set = 0
    Object.defineProperty(el, 'scrollTop', { set: (v) => (set = v), get: () => set })
    SD.restoreScroll(document)
    expect(set).toBe(240)
  })
  it('steps to the neighbour state in file order, without wrapping', () => {
    expect(SD.stepState(['a', 'b', 'c'], 'b', 1)).toBe('c')
    expect(SD.stepState(['a', 'b', 'c'], 'b', -1)).toBe('a')
    expect(SD.stepState(['a', 'b', 'c'], 'c', 1)).toBeNull()
    expect(SD.stepState(['a', 'b', 'c'], 'a', -1)).toBeNull()
    expect(SD.stepState(['a', 'b'], 'zzz', 1)).toBe('a')
  })
  it('names the block on screen, a width copy included', () => {
    const state = { id: 'cart-long', variants: [{ widths: [1024, 375], html: '' }] }
    expect(SD.shownBlockId(state, 375)).toBe('cart-long@1024')
    expect(SD.shownBlockId(state, 1440)).toBe('cart-long')
  })
  it('records and resolves an element path, also inside a template (Review Focus 3)', () => {
    const { document } = new JSDOM('<body><div><p>x</p><section><b>caption</b></section></div></body>').window
    const b = document.querySelector('b')
    expect(SD.elementPath(b, document.body)).toEqual([1, 2, 1])
    expect(SD.resolvePath(document.body, [1, 2, 1])).toBe(b)
    expect(SD.elementPath(document.body, document.body)).toEqual([])
    expect(SD.resolvePath(document.body, [1, 9])).toBeNull()
    const t = document.createElement('template')
    t.innerHTML = '<div><p>a</p><p>b</p></div>'
    const p2 = t.content.querySelectorAll('p')[1]
    expect(SD.elementPath(p2, t.content)).toEqual([1, 2])
    expect(SD.resolvePath(t.content, [1, 2])).toBe(p2)
  })
  it('keeps the first 60 characters of an element text, whitespace collapsed', () => {
    const { document } = new JSDOM('<p>  Here   is\n the long   caption </p><i></i>').window
    expect(SD.noteText(document.querySelector('p'))).toBe('Here is the long caption')
    document.querySelector('i').textContent = 'x'.repeat(80)
    expect(SD.noteText(document.querySelector('i'))).toHaveLength(60)
  })
  it('knows when the user is typing', () => {
    const { document } = new JSDOM('<input><textarea></textarea><select></select><div contenteditable="true"></div><p></p>').window
    expect(['input', 'textarea', 'select'].map((t) => SD.isTypingTarget(document.querySelector(t)))).toEqual([true, true, true])
    expect(SD.isTypingTarget(document.querySelector('p'))).toBe(false)
    expect(SD.isTypingTarget(null)).toBe(false)
  })
})

describe('link helpers', () => {
  it('reads the link list and reports a broken one', () => {
    const ok = new JSDOM('<body><script type="application/json" id="sd-links">[{"from":"a","button":"more","to":"b"}]</script></body>').window.document
    expect(SD.readLinks(ok)).toEqual({ links: [{ from: 'a', button: 'more', to: 'b' }], error: null })
    const bad = new JSDOM('<body><script type="application/json" id="sd-links">[oops</script></body>').window.document
    expect(SD.readLinks(bad)).toEqual({ links: [], error: 'The link list is not valid JSON' })
    expect(SD.readLinks(new JSDOM('<body></body>').window.document)).toEqual({ links: [], error: null })
  })
  it('splits a target into screen and state', () => {
    expect(SD.parseTarget('b')).toEqual({ screen: null, state: 'b' })
    expect(SD.parseTarget('review-steps#visuals')).toEqual({ screen: 'review-steps', state: 'visuals' })
  })
  it('keeps each link index for its state', () => {
    const links = [{ from: 'a' }, { from: 'b' }, { from: 'a' }]
    expect(SD.linksForState(links, 'a')).toEqual([{ link: links[0], index: 0 }, { link: links[2], index: 2 }])
  })
  it('finds the one button inside a wrapper with the same text (Review Focus 4)', () => {
    const { document } = new JSDOM('<body><div><button><span>more</span></button></div><a aria-label="Close"><svg></svg></a><p>more</p></body>').window
    expect(SD.findLinkElement(document, { button: 'more' }).tagName).toBe('BUTTON')
    expect(SD.findLinkElement(document, { button: 'more', nth: 2 }).tagName).toBe('P')
    expect(SD.findLinkElement(document, { button: 'Close' }).tagName).toBe('A')
    expect(SD.findLinkElement(document, { button: 'Missing' })).toBeNull()
  })
  it('skips a hidden copy of the button when the page has layout (desktop and mobile copies)', () => {
    const { document } = new JSDOM('<body><a id="desk" class="hidden md:flex">Home</a><a id="mob" class="md:hidden">Home</a></body>').window
    const shown = () => [{}]
    const none = () => []
    document.body.getClientRects = shown
    document.getElementById('desk').getClientRects = none
    document.getElementById('mob').getClientRects = shown
    expect(SD.findLinkElement(document, { button: 'Home' }).id).toBe('mob')
    expect(SD.findLinkElement(document, { button: 'Home', nth: 2 })).toBeNull()
    document.getElementById('mob').getClientRects = none
    expect(SD.findLinkElement(document, { button: 'Home' })).toBeNull()
  })
  it('ignores text inside style elements', () => {
    const { document } = new JSDOM('<body><style>more</style><button>more</button></body>').window
    expect(SD.findLinkElement(document, { button: 'more' }).tagName).toBe('BUTTON')
  })
})

describe('swap and motion', () => {
  const state = { id: 'b', html: '<p data-morph="caption">wide</p>', attrs: { 'data-html-class': 'app-fonts', 'data-body-class': 'bg-background', 'data-html-lang': 'de' }, variants: [{ widths: [375], html: '<p data-morph="caption">narrow</p>' }] }
  it('swaps a state into the same page, width copy and theme included', () => {
    const { document } = new JSDOM('<html class="x"><head><style id="keep"></style></head><body class="old"><p>a</p></body></html>').window
    SD.swapState(document, state, { theme: 'dark', width: 375 })
    expect(document.documentElement.className).toBe('app-fonts dark')
    expect(document.documentElement.lang).toBe('de')
    expect(document.body.className).toBe('bg-background')
    expect(document.body.innerHTML).toBe('<p data-morph="caption">narrow</p>')
    expect(document.getElementById('keep')).not.toBeNull()
  })
  it('swapState sets the state --vars and clears old ones', () => {
    const { document } = new JSDOM('<html style="--old:1"><body style="--b:1"><p>a</p></body></html>').window
    SD.swapState(document, { html: '<p>b</p>', attrs: { 'data-html-vars': '--accent:red' } }, { theme: 'light' })
    expect(document.documentElement.getAttribute('style')).toBe('--accent:red')
    expect(document.body.hasAttribute('style')).toBe(false)
  })
  it('builds the same width choice as the full page builder', () => {
    expect(SD.pickHtml(state, 375)).toBe('<p data-morph="caption">narrow</p>')
    expect(SD.pickHtml(state, 1440)).toBe('<p data-morph="caption">wide</p>')
  })
  it('writes motion CSS with the duration, and slides for slide motions', () => {
    expect(SD.motionCss('fade', 300)).toBe('::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation-duration:300ms}')
    expect(SD.motionCss('slide-left', 250)).toContain('animation-duration:250ms')
    expect(SD.motionCss('slide-left', 250)).toContain('translateX(-100%)')
    expect(SD.motionCss('slide-up', 250)).toContain('translateY(100%)')
  })
  it('swaps at once without View Transitions or with motion none', () => {
    const { document } = new JSDOM('<html><head></head><body></body></html>').window
    let ran = 0
    expect(SD.runSwap(document, 'fade', 300, [], () => (ran += 1))).toBeNull()
    expect(ran).toBe(1)
    document.startViewTransition = () => { throw new Error('must not be called for none') }
    expect(SD.runSwap(document, 'none', 300, [], () => (ran += 1))).toBeNull()
    expect(ran).toBe(2)
  })
  it('runs inside a View Transition, names morph elements on both sides', () => {
    const { document } = new JSDOM('<html><head></head><body><p data-morph="caption">old</p></body></html>').window
    const seen = []
    document.startViewTransition = (fn) => {
      seen.push(document.querySelector('[data-morph="caption"]').style.viewTransitionName)
      fn()
      seen.push(document.querySelector('[data-morph="caption"]').style.viewTransitionName)
      return { finished: Promise.resolve() }
    }
    SD.runSwap(document, 'morph', 400, ['caption'], () => { document.body.innerHTML = '<p data-morph="caption">new</p>' })
    expect(seen).toEqual(['sd-caption', 'sd-caption'])
    expect(document.getElementById('sd-motion').textContent).toContain('400ms')
  })
  it('clears morph names when the motion ends, so a later slide moves the page as one', async () => {
    const { document } = new JSDOM('<html><head></head><body><p data-morph="caption">old</p></body></html>').window
    let finish
    document.startViewTransition = (fn) => {
      fn()
      return { finished: new Promise((r) => (finish = r)) }
    }
    SD.runSwap(document, 'morph', 300, ['caption'], () => { document.body.innerHTML = '<p data-morph="caption">new</p>' })
    expect(document.querySelector('[data-morph]').style.viewTransitionName).toBe('sd-caption')
    finish()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-morph]').style.viewTransitionName).toBe('')
  })
})

describe('writeSwitcher', () => {
  it('writeSwitcher bakes widths and an attribute dark marker, and reports no change on rerun', () => {
    const d = mkdtempSync(join(tmpdir(), 'w-'))
    const plugin = join(import.meta.dirname, '..', 'plugin')
    expect(writeSwitcher(plugin, d, { widths: [1280, 390], dark: '[data-theme=dark]' })).toBe(true)
    const t = readFileSync(join(d, 'switcher.js'), 'utf8')
    expect(t).toContain('[1280,390]'); expect(t).toContain('"data-theme"')
    expect(writeSwitcher(plugin, d, { widths: [1280, 390], dark: '[data-theme=dark]' })).toBe(false)
    rmSync(d, { recursive: true, force: true })
  })
  it('throws when a placeholder is missing from the template', () => {
    const d = mkdtempSync(join(tmpdir(), 'w-'))
    mkdirSync(join(d, 'templates'))
    writeFileSync(join(d, 'templates', 'switcher.js'), 'var WIDTHS = [1440]')
    expect(() => writeSwitcher(d, d, { widths: [1280], dark: '.dark' })).toThrow(/WIDTHS/)
    rmSync(d, { recursive: true, force: true })
  })
  it('throws when the DARK placeholder is missing, even with WIDTHS present', () => {
    const d = mkdtempSync(join(tmpdir(), 'w-'))
    mkdirSync(join(d, 'templates'))
    writeFileSync(join(d, 'templates', 'switcher.js'), 'var WIDTHS = /*WIDTHS*/[1440, 1024, 375]; var DARK = null')
    expect(() => writeSwitcher(d, d, { widths: [1280], dark: '.dark' })).toThrow(/DARK/)
    rmSync(d, { recursive: true, force: true })
  })
  it('the template keeps no dead badge element or style', () => {
    const t = readFileSync(join(import.meta.dirname, '..', 'plugin', 'templates', 'switcher.js'), 'utf8')
    expect(t).not.toMatch(/sd-badge|var badge\b|proposed/i)
  })
  it('parseHash defaults to the first configured width', () => {
    const d = mkdtempSync(join(tmpdir(), 'w-'))
    writeSwitcher(join(import.meta.dirname, '..', 'plugin'), d, { widths: [1280, 390], dark: '.dark' })
    const SD2 = loadSwitcher(join(d, 'switcher.js'))
    expect(SD2.parseHash('#a')).toEqual({ id: 'a', width: 1280 })
    expect(SD2.parseHash('#a@999').width).toBe(1280)
    expect(SD2.parseHash('#a@390').width).toBe(390)
    rmSync(d, { recursive: true, force: true })
  })
})
