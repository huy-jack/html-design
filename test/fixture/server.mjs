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
  const a = createServer((req, res) => {
    const authed = /(?:^|;\s*)sid=1/.test(req.headers.cookie ?? '')
    const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body) }
    if (req.url === '/login') { res.writeHead(302, { 'set-cookie': 'sid=1; Path=/', location: '/page' }); return res.end() }
    if (req.url === '/lib.css') return send('text/css', '.lib{--tw-x:1;color:rgb(1,2,3)}')
    if (!authed) { res.writeHead(401); return res.end('login first') }
    if (req.url === '/page') return send('text/html', page)
    if (req.url === '/app.css') return send('text/css', appCss)
    if (req.url === '/img.png') return send('image/png', PNG)
    if (req.url === '/font.woff2') return send('font/woff2', FONT)
    res.writeHead(404); res.end()
  })
  const aUrl = await listen(a)
  return { a: aUrl, b: bUrl, close: () => { a.close(); b.close() } }
}
