// Two local servers for the browser tests. A = the app behind a cookie login. B = another origin with a plain sheet.
import { createServer } from 'node:http'
import { join } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const PAGE_CLASSES = 'p-4 text-brand bg-white hidden block'
// Smallest valid PNG (1x1).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const FONT = Buffer.from('wOF2-fixture-font')

async function buildAppCss() {
  const src = `@import "tailwindcss" source(none);\n@source inline("${PAGE_CLASSES}");\n@theme { --color-brand: #123456; }\n`
  const out = await postcss([tailwind()]).process(src, { from: join(import.meta.dirname, 'app.css') })
  return out.css
}

const listen = (srv) => new Promise((res) => srv.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${srv.address().port}`)))

export async function startFixture() {
  const appCss = await buildAppCss()
  const b = createServer((req, res) => {
    if (req.url === '/cross.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end('.cross{color:rgb(4,5,6)}') }
    res.writeHead(404); res.end()
  })
  const bUrl = await listen(b)
  const page = `<!doctype html><html lang="en"><head>
<link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/lib.css"><link rel="stylesheet" href="${bUrl}/cross.css">
<style>@font-face{font-family:Fx;src:url(/font.woff2) format("woff2")} body{font-family:Fx}</style>
</head><body class="bg-white"><main class="p-4 text-brand lib cross"><img src="/img.png" alt="">
<button onclick="document.getElementById('menu').classList.toggle('hidden')">Open menu</button>
<ul id="menu" class="hidden"><li>One</li></ul></main></body></html>`
  // Menus the way app libraries build them: in the DOM only while open. The click menu closes on window
  // resize and blur; the hover menu lives while the pointer is over its target.
  const menus = `<!doctype html><html lang="en"><head><link rel="stylesheet" href="/app.css"></head>
<body class="bg-white"><main class="p-4"><button id="open-click">Open click menu</button>
<div id="hover-target" style="display:inline-block;padding:20px">Hover me</div></main>
<script>
var main = document.querySelector('main')
function show(id) { if (!document.getElementById(id)) main.insertAdjacentHTML('beforeend', '<ul id="' + id + '"><li>' + id + ' item</li></ul>') }
function drop(id) { var m = document.getElementById(id); if (m) m.remove() }
document.getElementById('open-click').onclick = function () { show('click-menu') }
addEventListener('resize', function () { drop('click-menu') })
addEventListener('blur', function () { drop('click-menu') })
document.getElementById('hover-target').onmouseenter = function () { show('hover-menu') }
document.getElementById('hover-target').onmouseleave = function () { drop('hover-menu') }
</script></body></html>`
  // Floating layers the way libraries place them: a menu stuck to the bottom-right of the window, and a
  // popper placed at the top-left corner by a translate transform.
  const floating = `<!doctype html><html lang="en"><head></head><body style="margin:0">
<main style="height:400px">Page</main>
<div id="fixed-menu" style="position:fixed;right:40px;bottom:0;height:200px;width:180px;margin:10px 0;background:rgb(10,20,30)">menu</div>
<div id="popper" style="position:fixed;top:0;left:0;width:120px;height:60px;transform:translate(300px,120px);background:rgb(30,20,10)">pop</div>
</body></html>`
  const a = createServer((req, res) => {
    const authed = /(?:^|;\s*)sid=1/.test(req.headers.cookie ?? '')
    const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body) }
    if (req.url === '/login') { res.writeHead(302, { 'set-cookie': 'sid=1; Path=/', location: '/page' }); return res.end() }
    if (req.url === '/lib.css') return send('text/css', '.lib{--tw-x:1;color:rgb(1,2,3)}')
    if (!authed) { res.writeHead(401); return res.end('login first') }
    if (req.url === '/page') return send('text/html', page)
    if (req.url === '/menus') return send('text/html', menus)
    if (req.url === '/floating') return send('text/html', floating)
    if (req.url === '/app.css') return send('text/css', appCss)
    if (req.url === '/img.png') return send('image/png', PNG)
    if (req.url === '/font.woff2') return send('font/woff2', FONT)
    res.writeHead(404); res.end()
  })
  const aUrl = await listen(a)
  return { a: aUrl, b: bUrl, close: () => { a.close(); b.close() } }
}
