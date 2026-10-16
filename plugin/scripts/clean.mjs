// cleanDocument runs INSIDE the captured page (Playwright sends its source text), and in jsdom for tests.
// Keep it self-contained: no imports, no references to anything outside the function body.
export function cleanDocument(doc, { dark }) {
  const assets = []
  const assetIndex = new Map()
  const remote = []
  const warnings = []
  const body = doc.body
  // 0. Fixed layers (menus, popovers): the frame in the viewer can differ from the window in height, and in
  // width (a 1470 window is stored at 1440). Store each one at its measured place: top-based, and anchored to the
  // nearer side, so a menu near the right edge keeps its distance to that edge. offsetTop/Left ignore transforms.
  // A layer placed by a translate transform already uses the corner and is kept as it is. Normal flow is untouched.
  const view = doc.defaultView
  if (view && view.getComputedStyle) {
    const vw = view.innerWidth
    for (const el of body.querySelectorAll('*')) {
      const cs = view.getComputedStyle(el)
      if (cs.position !== 'fixed' || cs.display === 'none' || !(el.offsetWidth || el.offsetHeight)) continue
      const m = /^matrix(?:3d)?\((.*)\)$/.exec(cs.transform)
      const nums = m ? m[1].split(',').map(Number) : []
      const tx = nums.length === 16 ? nums[12] : nums[4]
      const ty = nums.length === 16 ? nums[13] : nums[5]
      if (tx || ty) continue
      const set = (k, v) => el.style.setProperty(k, v, el.style.getPropertyPriority(k))
      const px = (v) => parseFloat(v) || 0
      // Stretched between top and bottom: the height came from the window, so keep it.
      if (cs.top !== 'auto' && cs.bottom !== 'auto') { set('box-sizing', 'border-box'); set('height', `${el.offsetHeight}px`) }
      set('top', `${el.offsetTop - px(cs.marginTop)}px`)
      set('bottom', 'auto')
      const right = el.offsetLeft + el.offsetWidth / 2 > vw / 2
      if (cs.left !== 'auto' && cs.right !== 'auto' || right) { set('box-sizing', 'border-box'); set('width', `${el.offsetWidth}px`) }
      if (right) {
        set('right', `${vw - el.offsetLeft - el.offsetWidth - px(cs.marginRight)}px`)
        set('left', 'auto')
      } else {
        set('left', `${el.offsetLeft - px(cs.marginLeft)}px`)
        set('right', 'auto')
      }
    }
  }
  // 1. What the user typed lives in DOM properties, not attributes: copy it over.
  for (const el of body.querySelectorAll('input')) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) el.setAttribute('checked', '')
      else el.removeAttribute('checked')
    } else if (el.type !== 'file' && el.type !== 'password') el.setAttribute('value', el.value)
  }
  for (const el of body.querySelectorAll('textarea')) el.textContent = el.value
  for (const el of body.querySelectorAll('select option')) {
    if (el.selected) el.setAttribute('selected', '')
    else el.removeAttribute('selected')
  }
  // 2. Scrolled containers.
  for (const el of body.querySelectorAll('*')) if (el.scrollTop > 0) el.setAttribute('data-scroll-top', String(Math.round(el.scrollTop)))
  // 2b. SVG animation elements go: each shape shows its resting value.
  body.querySelectorAll('animate, animateTransform, animateMotion, set').forEach((n) => n.remove())
  // 3. Every stylesheet is listed; later steps fetch or inline it. text is null when the rules are unreadable.
  const sheets = [...doc.querySelectorAll('style, link[rel="stylesheet"]')]
    .filter((el) => !el.hasAttribute('data-hd-tool'))
    // A link with an empty href resolves to the page itself: it is no stylesheet.
    .filter((el) => el.tagName === 'STYLE' || (el.getAttribute('href') || '').trim() !== '')
    .map((el) =>
      el.tagName === 'STYLE'
        ? {
            href: null,
            text: (() => {
              if (el.textContent.trim()) return el.textContent
              // CSS-in-JS in insertRule mode leaves the element empty: read the rules instead.
              try {
                return [...el.sheet.cssRules].map((r) => r.cssText).join('\n')
              } catch {
                return null
              }
            })(),
          }
        : {
            href: el.href,
            text: (() => {
              try {
                return [...el.sheet.cssRules].map((r) => r.cssText).join('\n')
              } catch {
                return null
              }
            })(),
          },
    )
    .filter((s) => (s.href !== null && s.href !== undefined) || (s.text !== null && s.text.trim() !== ''))
  // Constructable sheets (document.adoptedStyleSheets: Lit, some CSS-in-JS) have no element. They apply after
  // the element sheets, so they go last. Sheets adopted inside a shadow root stay out (shadow DOM is not copied).
  for (const sh of doc.adoptedStyleSheets || []) {
    try {
      const text = [...sh.cssRules].map((r) => r.cssText).join('\n')
      if (text.trim()) sheets.push({ href: null, text })
    } catch {}
  }
  // 4. A video cannot play in a design file. With a poster, the video becomes an img of its poster, so the
  // copy shows what the user sees before play. Without a poster it stays as is (an empty frame) and is
  // counted in the warning below.
  for (const v of body.querySelectorAll('video[poster]')) {
    if (!v.getAttribute('poster').trim()) continue
    const img = doc.createElement('img')
    img.setAttribute('src', v.getAttribute('poster'))
    for (const a of ['class', 'style', 'width', 'height', 'id']) if (v.hasAttribute(a)) img.setAttribute(a, v.getAttribute(a))
    img.setAttribute('alt', v.getAttribute('aria-label') || '')
    v.replaceWith(img)
  }
  // Warn about what cannot be copied, then remove app JS, dev overlays, tool elements and comments.
  for (const tag of ['iframe', 'canvas', 'video']) {
    const n = body.querySelectorAll(tag).length
    if (n) warnings.push(`${n} ${tag} not copied`)
  }
  let shadow = 0
  for (const el of body.querySelectorAll('*')) if (el.shadowRoot) shadow += 1
  if (shadow) warnings.push(`${shadow} shadow DOM part(s) not copied`)
  body
    .querySelectorAll('script, noscript, link, template, style, nextjs-portal, next-route-announcer, vite-error-overlay, [data-nextjs-toast], [data-nextjs-dev-tools-button], [data-hd-tool]')
    .forEach((n) => n.remove())
  const walker = doc.createTreeWalker(body, 128)
  const comments = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  comments.forEach((c) => c.remove())
  // 5. Generated ids (React «r3», :r3:, _r_3_ and server _R_1cq_) change between loads: renumber id-1, id-2 in page order.
  const GEN = /«r[0-9a-z]+»|:r[0-9a-z]+:|_[rR]_[0-9a-zA-Z]+_/g
  const ID_ATTRS = ['id', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-owns', 'aria-activedescendant', 'aria-errormessage', 'aria-details', 'headers', 'list', 'form', 'fill', 'stroke', 'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end', 'href', 'xlink:href', 'style']
  const ids = new Map()
  const renumber = (v) =>
    v.replace(GEN, (g) => {
      if (!ids.has(g)) ids.set(g, `id-${ids.size + 1}`)
      return ids.get(g)
    })
  for (const el of body.querySelectorAll('*')) {
    for (const a of ID_ATTRS) {
      const v = el.getAttribute(a)
      if (v && GEN.test(v)) el.setAttribute(a, renumber(v))
      GEN.lastIndex = 0
    }
  }
  // 5b. One normal form per style: the server writes "--x:8px", React after hydration "--x: 8px;".
  for (const el of body.querySelectorAll('[style]')) {
    const decls = []
    for (let i = 0; i < el.style.length; i += 1) {
      const name = el.style[i]
      decls.push(`${name}: ${el.style.getPropertyValue(name).trim()}${el.style.getPropertyPriority(name) ? ' !important' : ''}`)
    }
    if (decls.length) el.setAttribute('style', `${decls.join('; ')};`)
  }
  // 6. Images: every http(s) and blob: URL becomes a placeholder ref; later steps download and replace it.
  const toAsset = (raw) => {
    if (!raw || raw.startsWith('data:') || raw.startsWith('#')) return raw
    let u
    try {
      u = new URL(raw, doc.baseURI)
    } catch {
      remote.push(raw)
      return raw
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'blob:') {
      remote.push(raw)
      return raw
    }
    if (!assetIndex.has(u.href)) {
      assetIndex.set(u.href, `__asset__${assets.length}`)
      assets.push({ url: u.href, ref: assetIndex.get(u.href) })
    }
    return assetIndex.get(u.href)
  }
  for (const el of body.querySelectorAll('img, source, video, image')) {
    // An img with only srcset: use the chosen file, else the first candidate, before srcset is removed.
    if (el.tagName === 'IMG' && !el.hasAttribute('src') && el.hasAttribute('srcset')) {
      // srcset grammar: a URL is a run of non-space characters and may hold commas (a data: URL, a CDN
      // transform like w_200,h_100). Only trailing commas end it. Splitting on every comma breaks such URLs.
      const first = (/^[\s,]*(\S+)/.exec(el.getAttribute('srcset')) || [])[1]?.replace(/,+$/, '') || ''
      const pick = el.currentSrc || first
      if (pick) el.setAttribute('src', pick)
    }
    for (const a of ['src', 'poster', 'href']) {
      if (!el.hasAttribute(a)) continue
      const raw = a === 'src' && el.tagName === 'IMG' ? el.currentSrc || el.getAttribute('src') : el.getAttribute(a)
      el.setAttribute(a, toAsset(raw))
    }
    el.removeAttribute('srcset')
    el.removeAttribute('sizes')
    el.removeAttribute('loading')
  }
  // Not [style*="url("]: jsdom's selector engine does not match it (Chrome does).
  for (const el of body.querySelectorAll('[style]')) {
    if (!el.getAttribute('style').includes('url(')) continue
    el.setAttribute('style', el.getAttribute('style').replace(/url\((["']?)(.*?)\1\)/g, (_, q, u) => `url(${q}${toAsset(u)}${q})`))
  }
  // 7. Classes: keep all except the dark class. The html style attribute and dark attribute are never carried.
  const strip = (cls) => cls.split(/\s+/).filter((c) => c && !(dark && dark.kind === 'class' && c === dark.name))
  // 7b. Custom properties a script set on <html> or <body> (style="--brand: ..."): kept per state. The rest of
  // those style attributes (for example color-scheme) is never carried.
  const vars = (el) => [...(el.getAttribute('style') || '').matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map((m) => `${m[1]}:${m[2].trim()}`).join(';')
  return {
    html: body.innerHTML.trim(),
    htmlClass: strip(doc.documentElement.className).join(' '),
    bodyClass: strip(body.className).join(' '),
    htmlVars: vars(doc.documentElement),
    bodyVars: vars(body),
    lang: doc.documentElement.lang || 'en',
    assets,
    remote,
    sheets,
    warnings,
  }
}
