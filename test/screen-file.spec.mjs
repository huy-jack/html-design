import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { diffStates, groupVariants, lintAdded, mergeStates, parseScreen, serializeScreen, slugScreen, validateLinks, writeLinksBlock, listScreenIds } from '../plugin/scripts/screen-file.mjs'

const st = (id, html, attrs = {}) => ({ id, html, attrs: { 'data-flow': 'onboarding', 'data-label': id, ...attrs } })
const file = (states) => serializeScreen({ screen: 'onboarding', states })

describe('screen file', () => {
  it('slugs screen names', () => expect(slugScreen('Onboarding')).toBe('onboarding'))

  it('round-trips and is idempotent, with German text, quotes and escaped tags (Review Focus)', () => {
    const a = file([st('ready', '<p class="text-13">Fünf «Ideen» &amp; "Zitate" &lt;/template&gt;</p>', { 'data-note': 'He said "go"' })])
    const p = parseScreen(a)
    expect(p.screen).toBe('onboarding')
    expect(p.states[0].id).toBe('ready')
    expect(p.states[0].attrs['data-note']).toBe('He said "go"')
    expect(p.states[0].html).toContain('Fünf «Ideen»')
    expect(file(p.states)).toBe(a)
  })

  it('merge keeps the designer states unless --replace names them (Review Focus 3)', () => {
    const existing = [st('ready', '<p>designer</p>')]
    const captured = [st('ready', '<p>app</p>'), st('error', '<p>err</p>')]
    const m = mergeStates(existing, captured, { replace: new Set() })
    expect(m.states.map((s) => s.html)).toEqual(['<p>designer</p>', '<p>err</p>'])
    expect(m).toMatchObject({ added: ['error'], kept: ['ready'], replaced: [] })
    const r = mergeStates(existing, captured, { replace: new Set(['ready']) })
    expect(r.states[0].html).toBe('<p>app</p>')
    expect(r.replaced).toEqual(['ready'])
  })

  it('merge refuses an id owned by another flow', () => {
    expect(() => mergeStates([st('ready', 'x', { 'data-flow': 'review' })], [st('ready', 'y')], { replace: new Set() })).toThrow(/another flow/)
  })

  it('diff lists added, changed and removed states', () => {
    const a = file([st('ready', '<p>a</p>'), st('gone', '<p>g</p>')])
    const b = file([st('ready', '<p>a</p>'), st('new', '<p>n</p>')])
    expect(diffStates(a, b)).toEqual({ added: ['new'], changed: [], removed: ['gone'] })
    expect(diffStates(null, a).added).toEqual(['ready', 'gone'])
    expect(diffStates(a, file([st('ready', '<p class="gap-2">a</p>'), st('gone', '<p>g</p>')])).changed).toEqual(['ready'])
  })

  it('lint flags only what the designer added', () => {
    const old = st('s', '<div class="bg-[#123456] p-2" style="width:10px"></div>')
    const ok = st('s', '<div class="bg-[#123456] p-4 bg-primary" style="width:10px"></div>')
    expect(lintAdded(old, ok)).toEqual([])
    const bad = st('s', '<div class="text-[#754AA1] bg-[hsl(1,2%,3%)]" style="color:red"></div><style>a{}</style><script>x</script>')
    expect(lintAdded(old, bad).map((f) => f.rule).sort()).toEqual(['inline style', 'raw color', 'raw color', 'script', 'style tag'])
  })

  it('groups width copies: only widths whose page differs from 1440 get a variant, equal ones share it', () => {
    expect(groupVariants({ 1440: 'A', 1024: 'A', 375: 'A' })).toEqual({ html: 'A', variants: [] })
    expect(groupVariants({ 1440: 'A', 1024: 'B', 375: 'B' })).toEqual({ html: 'A', variants: [{ widths: [1024, 375], html: 'B' }] })
    expect(groupVariants({ 1440: 'A', 1024: 'A', 375: 'C' })).toEqual({ html: 'A', variants: [{ widths: [375], html: 'C' }] })
    expect(groupVariants({ 1440: 'A', 1024: 'B', 375: 'C' }).variants.map((v) => v.widths)).toEqual([[1024], [375]])
  })

  it('round-trips width variants next to their state', () => {
    const a = file([{ ...st('ready', '<p>wide</p>'), variants: [{ widths: [1024, 375], html: '<p>narrow</p>' }] }, st('error', '<p>e</p>')])
    const p = parseScreen(a)
    expect(p.states.map((s) => s.id)).toEqual(['ready', 'error'])
    expect(p.states[0].variants).toEqual([{ widths: [1024, 375], html: '<p>narrow</p>' }])
    expect(p.states[1].variants).toEqual([])
    expect(file(p.states)).toBe(a)
  })

  it('a change in a width variant is a change, and its classes are linted', () => {
    const base = { ...st('ready', '<p>w</p>'), variants: [{ widths: [375], html: '<p class="p-2">n</p>' }] }
    const a = file([base])
    const b = file([{ ...base, variants: [{ widths: [375], html: '<p class="p-2 text-[#123456]">n</p>' }] }])
    expect(diffStates(a, b).changed).toEqual(['ready'])
    expect(lintAdded(parseScreen(a).states[0], parseScreen(b).states[0])).toEqual([{ rule: 'raw color', value: 'text-[#123456]' }])
  })

  it('formatting adds no visible whitespace (a whitespace-pre-wrap paragraph shows every space)', () => {
    const text = 'Announce the new autumn menu and bring regulars back to the cafes'
    const html = `<div class="max-w-5xl font-display font-medium tracking-tight"><p class="mb-2 whitespace-pre-wrap break-words text-base leading-6 text-foreground last:mb-0">${text}</p><span>a</span><span>b</span></div>`
    const out = parseScreen(file([st('s', html)])).states[0].html
    const { document } = new JSDOM(out).window
    expect(document.querySelector('p').textContent).toBe(text)
    expect(document.querySelector('div').textContent).toBe(`${text}ab`)
  })

  it('writes markup in one canonical form, so a second write changes nothing (Chrome writes > in attributes as &gt;)', () => {
    const a = file([st('s', '<p title="a &gt; b" class="[&amp;&gt;svg]:size-4">x</p>', {}), { ...st('t', '<i data-x="1&gt;0"></i>'), variants: [{ widths: [375], html: '<b title="&gt;"></b>' }] }])
    expect(file(parseScreen(a).states)).toBe(a)
  })
})

describe('link list', () => {
  const states = [
    { id: 'cart-items', attrs: { 'data-flow': 'f' }, html: '<button>more</button>' },
    { id: 'cart-long-open', attrs: { 'data-flow': 'f' }, html: '<p>open</p>' },
  ]
  const links = [{ from: 'cart-items', button: 'more', to: 'cart-long-open', motion: 'fade', ms: 300 }]

  it('round-trips through serialize and parse, and writes no block without links', () => {
    const text = serializeScreen({ screen: 'x', states, links })
    expect(parseScreen(text).links).toEqual(links)
    expect(serializeScreen({ screen: 'x', states })).not.toContain('sd-links')
    expect(parseScreen(serializeScreen({ screen: 'x', states })).links).toEqual([])
  })
  it('refuses a broken link list instead of dropping it on the next rewrite', () => {
    const text = serializeScreen({ screen: 'x', states, links }).replace('"button"', '"button" oops')
    expect(() => parseScreen(text)).toThrow(/link list \(sd-links\) is not valid JSON/)
  })
  it('replaces, inserts and removes only the block', () => {
    const bare = serializeScreen({ screen: 'x', states })
    const withLinks = writeLinksBlock(bare, links)
    expect(parseScreen(withLinks).links).toEqual(links)
    expect(withLinks.replace(/<script type="application\/json" id="sd-links">[\s\S]*?<\/script>\n/, '')).toBe(bare)
    expect(writeLinksBlock(withLinks, [])).toBe(bare)
    // The block goes on its own lines before </body>, so a link diff never touches the </body> line.
    expect(withLinks).toContain('</script>\n  </body>')
  })
  it('validates every link field', () => {
    const ids = ['cart-items', 'cart-long-open']
    expect(validateLinks(links, ids)).toEqual([])
    expect(validateLinks([{ ...links[0], to: 'other-screen#a' }], ids)).toEqual([])
    const errs = validateLinks(
      [
        { from: 'nope', button: '', to: 'gone', motion: 'spin', ms: 9000, nth: 0 },
        { from: 'cart-items', button: 'more', to: 'cart-long-open', motion: 'morph' },
      ],
      ids,
    ).join('\n')
    for (const word of ['from "nope"', 'button', 'to "gone"', 'motion "spin"', 'ms', 'nth', 'morph needs']) expect(errs).toContain(word)
  })
})

describe('link list edge cases', () => {
  const states = [
    { id: 'a', attrs: { 'data-flow': 'f' }, html: '<button>go</button>', variants: [{ widths: [375], html: '<button>go</button>' }] },
    { id: 'b', attrs: { 'data-flow': 'f' }, html: '<p>b</p>' },
  ]
  const link = { from: 'a', button: 'go', to: 'b' }

  it('refuses a link to its own state (the viewer would wait for an address change that never comes)', () => {
    expect(validateLinks([{ ...link, to: 'a' }], ['a', 'b']).join()).toMatch(/to is the same state as from/)
  })
  it('checks a link to another screen file when the other files are known', () => {
    const opts = { screen: 'this', targets: { other: ['s1'] } }
    expect(validateLinks([{ ...link, to: 'other#s1' }], ['a', 'b'], opts)).toEqual([])
    expect(validateLinks([{ ...link, to: 'this#b' }], ['a', 'b'], opts)).toEqual([])
    expect(validateLinks([{ ...link, to: 'other#nope' }], ['a', 'b'], opts).join()).toMatch(/state "nope" is not in other/)
    expect(validateLinks([{ ...link, to: 'missing#s' }], ['a', 'b'], opts).join()).toMatch(/screen file "missing" does not exist/)
    expect(validateLinks([{ ...link, to: 'this#nope' }], ['a', 'b'], opts).join()).toMatch(/to "this#nope" is not a state of this file/)
  })
  it('lists the state ids of a screen file without its width copies', () => {
    expect(listScreenIds(serializeScreen({ screen: 'x', states }))).toEqual(['a', 'b'])
  })
  it('appends the block to a file with no </body>, and removes a block written with single quotes', () => {
    expect(writeLinksBlock('<p>x</p>\n', [link]).startsWith('<p>x</p>\n<script type="application/json" id="sd-links">')).toBe(true)
    expect(writeLinksBlock("<body>\n<script type=\"application/json\" id='sd-links'>[]</script>\n</body>\n", [])).toBe('<body>\n</body>\n')
  })
  it('keeps the links when capture merges a fresh copy of a state and rewrites the file', () => {
    const text = serializeScreen({ screen: 'x', states, links: [link] })
    const parsed = parseScreen(text)
    const m = mergeStates(parsed.states, [{ id: 'b', attrs: { 'data-flow': 'f' }, html: '<p>b again</p>' }], { replace: new Set(['b']) })
    const rewritten = serializeScreen({ screen: 'x', states: m.states, links: parsed.links })
    expect(parseScreen(rewritten).links).toEqual([link])
    expect(parseScreen(rewritten).states[1].html).toBe('<p>b again</p>')
  })
})

describe('project attributes', () => {
  it('keeps project data-* attributes through serialize and parse', () => {
    const text = serializeScreen({ screen: 's', states: [{ id: 'a', html: '<p>x</p>', attrs: { 'data-zeta': 'z', 'data-label': 'A', 'data-proposed': 'T-1' } }] })
    expect(text).toMatch(/data-label="A" data-proposed="T-1" data-zeta="z"/)
    expect(parseScreen(text).states[0].attrs).toEqual({ 'data-label': 'A', 'data-proposed': 'T-1', 'data-zeta': 'z' })
  })
})
