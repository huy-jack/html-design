import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { cleanDocument } from '../plugin/scripts/clean.mjs'

const D = { dark: { kind: 'class', name: 'dark' } }
const page = (body, head = '', htmlClass = 'font-x') =>
  new JSDOM(`<!doctype html><html lang="en" class="${htmlClass}"><head>${head}</head><body class="bg-background">${body}</body></html>`, { url: 'http://localhost:3000/p' }).window.document

describe('cleanDocument', () => {
  it('removes the theme marker and color-scheme from html (Review Focus 1)', () => {
    const { document } = new JSDOM('<html class="dark font-x" style="color-scheme: dark" data-theme="dark"><body><p>a</p></body></html>').window
    const c1 = cleanDocument(document, { dark: { kind: 'class', name: 'dark' } })
    expect(c1.htmlClass).toBe('font-x')
    const { document: d2 } = new JSDOM('<html data-theme="dark"><body></body></html>').window
    const c2 = cleanDocument(d2, { dark: { kind: 'attr', name: 'data-theme', value: 'dark' } })
    expect(c2.htmlClass).toBe('')
  })
  it('collects every http image from any domain as an asset', () => {
    const { document } = new JSDOM('<body><img src="https://cdn.example.com/a.png" srcset="x 2x"><div style="background-image: url(/b.png)"></div></body>', { url: 'http://localhost:3000/p' }).window
    const c = cleanDocument(document, D)
    expect(c.assets.map((a) => a.url)).toEqual(['https://cdn.example.com/a.png', 'http://localhost:3000/b.png'])
    expect(c.html).toContain('__asset__0')
    expect(c.html).not.toContain('srcset')
  })
  it('lists sheets and removes dev overlays, warns on iframe and canvas', () => {
    const { document } = new JSDOM('<head><style>.x{}</style><link rel="stylesheet" href="/l.css"></head><body><nextjs-portal></nextjs-portal><vite-error-overlay></vite-error-overlay><iframe></iframe><canvas></canvas></body>', { url: 'http://localhost:3000/' }).window
    const c = cleanDocument(document, D)
    expect(c.sheets).toEqual([{ href: null, text: '.x{}' }, { href: 'http://localhost:3000/l.css', text: null }])
    expect(c.html).not.toContain('portal')
    expect(c.warnings).toEqual(['1 iframe not copied', '1 canvas not copied'])
  })
  it('skips tool styles, dedupes assets, keeps data: and blob: handling', () => {
    const r = cleanDocument(page('<img src="/a.png"><img src="/a.png"><img src="data:image/png;base64,AA==">', '<style data-hd-tool="">*{x:y}</style>'), D)
    expect(r.sheets).toEqual([])
    expect(r.assets).toEqual([{ url: 'http://localhost:3000/a.png', ref: '__asset__0' }])
    expect(r.html).toContain('data:image/png;base64,AA==')
  })
  it('removes tool elements and comments, keeps markup', () => {
    const r = cleanDocument(page('<main class="p-4">Hi</main><script>x()</script><div data-hd-tool>p</div><!-- c -->'), D)
    expect(r.html).toBe('<main class="p-4">Hi</main>')
    expect(r.bodyClass).toBe('bg-background')
    expect(r.lang).toBe('en')
  })
  it('numbers generated ids in page order, and keeps references in step', () => {
    const r = cleanDocument(page('<label for="«r3»">A</label><input id="«r3»"><div aria-labelledby="«r3» radix-:r9:" id="radix-:r9:"></div><svg><clipPath id="clip0"></clipPath></svg>'), D)
    expect(r.html).toContain('for="id-1"')
    expect(r.html).toContain('aria-labelledby="id-1 radix-id-2"')
    expect(r.html).toContain('id="clip0"')
  })
  it('renumbers generated ids inside longer ids and url(#...) references', () => {
    const r = cleanDocument(page('<svg><defs><radialGradient id="_r_7_-body"></radialGradient></defs><circle fill="url(#_r_7_-body)" style="mask: url(#_R_1cq_-m)"></circle><mask id="_R_1cq_-m"></mask></svg>'), D)
    expect(r.html).toContain('id="id-1-body"')
    expect(r.html).toContain('fill="url(#id-1-body)"')
    expect(r.html).toContain('mask: url(#id-2-m)')
  })
  it('writes every style in one normal form', () => {
    const a = cleanDocument(page('<svg style="--mark-glow-size:8px"></svg><div style="color:red;margin: 0 auto"></div>'), D)
    const b = cleanDocument(page('<svg style="--mark-glow-size: 8px;"></svg><div style="color: red; margin: 0 auto;"></div>'), D)
    expect(a.html).toBe(b.html)
  })
  it('copies typed values, checks and selections into attributes', () => {
    const doc = page('<input id="t"><textarea id="ta"></textarea><input type="checkbox" id="c"><select id="s"><option>a</option><option>b</option></select>')
    doc.getElementById('t').value = 'Summer sale'
    doc.getElementById('ta').value = 'Long text'
    doc.getElementById('c').checked = true
    doc.getElementById('s').value = 'b'
    const r = cleanDocument(doc, D)
    expect(r.html).toContain('value="Summer sale"')
    expect(r.html).toContain('>Long text</textarea>')
    expect(r.html).toMatch(/type="checkbox" id="[^"]+" checked=""/)
    expect(r.html).toContain('<option selected="">b</option>')
  })
  it('keeps scroll positions', () => {
    const doc = page('<div id="chat"><p>m</p></div>')
    Object.defineProperty(doc.getElementById('chat'), 'scrollTop', { get: () => 412.6 })
    expect(cleanDocument(doc, D).html).toContain('data-scroll-top="413"')
  })
  it('drops SVG animation elements', () => {
    const r = cleanDocument(page('<svg><path id="p" d="M0 0"><animate attributeName="d" values="M0 0;M9 9"></animate></path><circle><set attributeName="r" to="3"></set></circle></svg>'), D)
    expect(r.html).toContain('<path id="p" d="M0 0"></path>')
    expect(r.html).not.toMatch(/<animate|<set/)
  })
  it('reads rules of an empty style filled by insertRule', () => {
    const doc = page('<main></main>', '<style id="s"></style>')
    doc.getElementById('s').sheet.insertRule('.ins{color:red}')
    const r = cleanDocument(doc, D)
    expect(r.sheets).toHaveLength(1)
    expect(r.sheets[0].text).toContain('.ins')
  })
  it('uses the first srcset candidate when an img has no src', () => {
    const r = cleanDocument(page('<img srcset="/a.png 1x, /b.png 2x">'), D)
    expect(r.assets.map((a) => a.url)).toEqual(['http://localhost:3000/a.png'])
    expect(r.html).toContain('src="__asset__0"')
    expect(r.html).not.toContain('srcset')
  })
  it('drops an inline style that has no text and no readable sheet', () => {
    const doc = page('<main></main>', '<style id="s"></style><style>.k{}</style>')
    Object.defineProperty(doc.getElementById('s'), 'sheet', { get() { throw new Error('x') } })
    const r = cleanDocument(doc, D)
    expect(r.sheets).toEqual([{ href: null, text: '.k{}' }])
  })
  it('keeps commas inside a srcset URL', () => {
    const r = cleanDocument(page('<img srcset="/img/w_200,h_100/a.png 1x, /img/w_400,h_200/a.png 2x">'), D)
    expect(r.assets.map((a) => a.url)).toEqual(['http://localhost:3000/img/w_200,h_100/a.png'])
    const r2 = cleanDocument(page('<img srcset="/only.png,">'), D)
    expect(r2.assets.map((a) => a.url)).toEqual(['http://localhost:3000/only.png'])
  })
  it('turns a video with a poster into its poster img; warns once for a video without one', () => {
    const r = cleanDocument(page('<video class="w-full" poster="/p.jpg" aria-label="Demo"><source src="/v.mp4"></video><video src="/a.mp4"></video><video src="/b.mp4"></video>'), D)
    expect(r.html).toContain('<img src="__asset__0" class="w-full" alt="Demo">')
    expect(r.assets[0].url).toBe('http://localhost:3000/p.jpg')
    expect(r.html.match(/<video/g)).toHaveLength(2)
    expect(r.warnings).toEqual(['2 video not copied'])
  })
  it('skips a stylesheet link with an empty href', () => {
    const r = cleanDocument(page('<main></main>', '<link rel="stylesheet" href=""><link rel="stylesheet" href="  "><link rel="stylesheet" href="/s.css">'), D)
    expect(r.sheets).toEqual([{ href: 'http://localhost:3000/s.css', text: null }])
  })
})
