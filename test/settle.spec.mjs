import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { removeSvgAnimations, waitForQuietDom } from '../plugin/scripts/settle.mjs'

describe('waitForQuietDom', () => {
  it('waits until the page stops changing', async () => {
    const { window } = new JSDOM('<div id="a"></div>')
    const el = window.document.getElementById('a')
    let n = 0
    const t = window.setInterval(() => {
      el.textContent = String(n++)
      if (n === 4) window.clearInterval(t)
    }, 60)
    const waited = await waitForQuietDom(window, 150, 3000)
    expect(n).toBe(4)
    expect(waited).toBeGreaterThanOrEqual(240 + 150 - 30)
  })
  it('gives up at the cap on a page that never stops (a live stream)', async () => {
    const { window } = new JSDOM('<div id="a"></div>')
    const t = window.setInterval(() => (window.document.getElementById('a').textContent = String(Math.random())), 20)
    const waited = await waitForQuietDom(window, 150, 400)
    window.clearInterval(t)
    expect(waited).toBeGreaterThanOrEqual(390)
    expect(waited).toBeLessThan(700)
  })
})

describe('removeSvgAnimations', () => {
  it('removes every SVG animation element so the app page shows the same resting shapes as the copy', () => {
    const { window } = new JSDOM('<svg><path d="M0 0"><animate attributeName="d"></animate><animateTransform></animateTransform></path><g><set attributeName="x"></set><animateMotion></animateMotion></g></svg>')
    expect(removeSvgAnimations(window)).toBe(4)
    expect(window.document.querySelectorAll('animate, animateTransform, animateMotion, set').length).toBe(0)
  })
})
