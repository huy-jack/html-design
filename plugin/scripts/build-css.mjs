// usage: node build-css.mjs [--data <dir>]  (run in the project root)
// Builds <dir>/dist/design.css from <dir>/design.css with the project's own Tailwind.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig, projectRoot } from './config.mjs'
import { dataPaths, isMain, loadDep, parseDataArg } from './deps.mjs'
import { decodeEntities } from './styles/vars.mjs'


// Tailwind reads files as raw text, so in a screen file it would see "[&amp;_p]:text-3xl", not the class
// "[&_p]:text-3xl". The build scans a file of the decoded class lists (class, data-html-class,
// data-body-class) instead of the screens.
export function screenClasses(screensDir) {
  if (!existsSync(screensDir)) return ''
  return readdirSync(screensDir)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .flatMap((f) => [...readFileSync(join(screensDir, f), 'utf8').matchAll(/\s(?:class|data-html-class|data-body-class)="([^"]*)"/g)].map((m) => decodeEntities(m[1])))
    .join('\n')
}

export async function buildCss(root, cfg, dataDir) {
  if (!cfg.css) return null
  const d = join(root, cfg.dir)
  mkdirSync(join(d, '.local'), { recursive: true })
  writeFileSync(join(d, '.local', 'screens-classes.txt'), screenClasses(join(d, 'screens')))
  const from = join(d, 'design.css')
  const cssDir = dirname(join(root, cfg.css))
  const ver = loadDep(null, 'tailwindcss/package.json', cssDir).version
  const fallback = join(dataPaths(dataDir ?? '').tailwind, ver)
  const postcss = loadDep(fallback, 'postcss', cssDir)
  const tailwind = loadDep(fallback, '@tailwindcss/postcss', cssDir)
  const text = readFileSync(from, 'utf8')
  return (await postcss([tailwind({ optimize: false })]).process(text, { from })).css
}

export async function writeCss(root, cfg, dataDir) {
  const css = await buildCss(root, cfg, dataDir)
  if (css == null) return 0
  const out = join(root, cfg.dir, 'dist/design.css')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, css)
  return Buffer.byteLength(css)
}

// Tailwind keeps every class it has seen for the life of a process, so a long-running process (the view
// server) would keep styles for classes the designer removed. Each rebuild there runs in a fresh process.
export function buildCssInChild(root, dataDir) {
  const args = [fileURLToPath(import.meta.url), ...(dataDir ? ['--data', dataDir] : [])]
  return new Promise((res, rej) => execFile(process.execPath, args, { cwd: root }, (e, stdout, stderr) => (e ? rej(new Error(stderr || e.message)) : res(stdout))))
}

if (isMain(import.meta.url)) {
  const root = projectRoot(process.cwd())
  const cfg = readConfig(root)
  const n = await writeCss(root, cfg, parseDataArg(process.argv))
  console.log(cfg.css ? `${cfg.dir}/dist/design.css: ${n} bytes.` : 'view-only: nothing to build')
}
