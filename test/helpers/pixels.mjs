// Pixel compare. countDiff is pure (tested in node); compareInPage decodes PNGs on a canvas in the
// browser and runs the same countDiff source there, so no image library is needed.
export const MATCH_PIXEL_RATIO = 0.001
export const CHANNEL_DELTA = 16

export function countDiff(a, b, delta = 16) {
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > delta || Math.abs(a[i + 1] - b[i + 1]) > delta || Math.abs(a[i + 2] - b[i + 2]) > delta || Math.abs(a[i + 3] - b[i + 3]) > delta) n += 1
  }
  return n
}

export async function compareInPage(page, pngA, pngB) {
  const r = await page.evaluate(
    async ([a64, b64, fn, delta]) => {
      const countDiffIn = new Function(`return (${fn})`)()
      const load = async (x) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${x}`)).blob())
        const c = new OffscreenCanvas(bmp.width, bmp.height)
        const ctx = c.getContext('2d')
        ctx.drawImage(bmp, 0, 0)
        return { w: bmp.width, h: bmp.height, px: ctx.getImageData(0, 0, bmp.width, bmp.height).data }
      }
      const A = await load(a64)
      const B = await load(b64)
      if (A.w !== B.w || A.h !== B.h) return { width: A.w, height: A.h, otherHeight: B.h, sameSize: false, diff: -1, ratio: 1, highlight: null }
      const diff = countDiffIn(A.px, B.px, delta)
      let highlight = null
      if (diff > 0) {
        // Changed pixels red, the rest a faded copy of the design.
        const c = new OffscreenCanvas(A.w, A.h)
        const ctx = c.getContext('2d')
        const out = ctx.createImageData(A.w, A.h)
        for (let i = 0; i < A.px.length; i += 4) {
          const changed = Math.abs(A.px[i] - B.px[i]) > delta || Math.abs(A.px[i + 1] - B.px[i + 1]) > delta || Math.abs(A.px[i + 2] - B.px[i + 2]) > delta || Math.abs(A.px[i + 3] - B.px[i + 3]) > delta
          out.data[i] = changed ? 255 : A.px[i] * 0.3 + 178
          out.data[i + 1] = changed ? 0 : A.px[i + 1] * 0.3 + 178
          out.data[i + 2] = changed ? 0 : A.px[i + 2] * 0.3 + 178
          out.data[i + 3] = 255
        }
        ctx.putImageData(out, 0, 0)
        const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
        let s = ''
        for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768))
        highlight = btoa(s)
      }
      return { width: A.w, height: A.h, sameSize: true, diff, ratio: diff / (A.w * A.h), highlight }
    },
    [pngA.toString('base64'), pngB.toString('base64'), countDiff.toString(), CHANNEL_DELTA],
  )
  return { ...r, highlight: r.highlight ? Buffer.from(r.highlight, 'base64') : null }
}
