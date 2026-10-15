// The css test app: no Tailwind. CSS variables with a .dark block, a hashed class, a Bootstrap-style p-3,
// a constructable sheet, a var set on <html> by a script, an app !important rule and an inline !important style.
import { createServer } from 'node:http'

export const APP_CSS = `:root { --brand: rgb(1, 2, 3); --ink: rgb(4, 5, 6); }
.dark { --brand: rgb(7, 8, 9); }
.card_x7f2 { padding: 16px; background-color: var(--brand); }
.p-3 { padding: 16px; }
.acc { color: var(--accent); }
.locked { padding: 5px !important; }
`
const PAGE = `<!doctype html><html lang="en"><head><link rel="stylesheet" href="/app.css">
<script>
document.documentElement.style.setProperty('--accent', 'rgb(9, 9, 9)')
const sheet = new CSSStyleSheet()
sheet.replaceSync('.adopted { color: rgb(11, 12, 13); }')
document.adoptedStyleSheets = [sheet]
</script></head><body><main>
<div id="card" class="card_x7f2">Card</div>
<p id="boot" class="p-3">Boot</p>
<p id="ad" class="adopted">Adopted</p>
<p id="acc" class="acc">Accent</p>
<p id="locked" class="locked">Locked</p>
<p id="inline" style="padding: 5px !important">Inline</p>
</main></body></html>`

export async function startCssFixture() {
  const srv = createServer((req, res) => {
    if (req.url === '/app.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(APP_CSS) }
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE) }
    res.writeHead(404); res.end()
  })
  const url = await new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${srv.address().port}`)))
  return { url, close: () => srv.close() }
}
