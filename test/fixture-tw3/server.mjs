// The Tailwind 3 test app: builds its CSS with its own Tailwind 3 from src/styles.css and the .ts config,
// with src/index.html as the content.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const DIR = import.meta.dirname
const BODY = readFileSync(join(DIR, 'src/index.html'), 'utf8')

async function buildCss() {
  const req = createRequire(join(DIR, 'noop.js'))
  const raw = req('tailwindcss/loadConfig')(join(DIR, 'tailwind.config.ts'))
  const config = { ...(raw.default ?? raw), content: [{ raw: BODY, extension: 'html' }] }
  const from = join(DIR, 'src/styles.css')
  return (await req('postcss')([req('tailwindcss')(config)]).process(readFileSync(from, 'utf8'), { from })).css
}

export async function startTw3Fixture() {
  const css = await buildCss()
  const page = `<!doctype html><html lang="en"><head><link rel="stylesheet" href="/styles.css"></head><body>${BODY}</body></html>`
  const srv = createServer((req, res) => {
    if (req.url === '/styles.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(css) }
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page) }
    res.writeHead(404); res.end()
  })
  const url = await new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${srv.address().port}`)))
  return { url, close: () => srv.close() }
}
