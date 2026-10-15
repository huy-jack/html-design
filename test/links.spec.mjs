import { describe, expect, it } from 'vitest'
import { parseScreen, serializeScreen } from '../plugin/scripts/screen-file.mjs'
import { addLink, removeLink } from '../plugin/scripts/links.mjs'

const states = [
  { id: 'cart-items', attrs: { 'data-flow': 'f' }, html: '<button>more</button>' },
  { id: 'cart-long-open', attrs: { 'data-flow': 'f' }, html: '<p>open</p>' },
]
const bare = serializeScreen({ screen: 'x', states })

describe('links tool', () => {
  it('adds a link without touching the states (Review Focus 5)', () => {
    const text = addLink(bare, { from: 'cart-items', button: 'more', to: 'cart-long-open', motion: 'fade', ms: 300 })
    expect(parseScreen(text).links).toEqual([{ from: 'cart-items', button: 'more', to: 'cart-long-open', motion: 'fade', ms: 300 }])
    expect(text.slice(0, text.indexOf('<script type="application/json"'))).toBe(bare.slice(0, bare.lastIndexOf('\n', bare.lastIndexOf('</body>')) + 1))
  })
  it('refuses an invalid link and writes nothing', () => {
    expect(() => addLink(bare, { from: 'cart-items', button: 'more', to: 'cart-long-open', motion: 'spin' })).toThrow(/motion "spin"/)
  })
  it('removes a link by the number list prints', () => {
    const two = addLink(addLink(bare, { from: 'cart-items', button: 'more', to: 'cart-long-open' }), { from: 'cart-long-open', button: 'open', to: 'cart-items' })
    expect(parseScreen(removeLink(two, 1)).links.map((l) => l.from)).toEqual(['cart-long-open'])
    expect(removeLink(removeLink(two, 1), 1)).toBe(bare)
    expect(() => removeLink(two, 3)).toThrow(/no link 3/)
  })
})

describe('links tool, targets', () => {
  it('checks a link to another screen file against the files that exist', () => {
    const opts = { screen: 'x', targets: { 'onboarding': ['default'] } }
    expect(() => addLink(bare, { from: 'cart-items', button: 'more', to: 'onboarding#nope' }, opts)).toThrow(/state "nope" is not in onboarding/)
    expect(parseScreen(addLink(bare, { from: 'cart-items', button: 'more', to: 'onboarding#default' }, opts)).links).toHaveLength(1)
  })
})
