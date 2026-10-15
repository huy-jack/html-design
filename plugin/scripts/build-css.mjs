// usage: node build-css.mjs [--data <dir>]  (run in the project root)
// Builds <dir>/dist/design.css with the style adapter (the app's Tailwind, or the plugin's own for css projects).
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig, projectRoot } from './config.mjs'
import { isMain, parseDataArg } from './deps.mjs'
import { adapterFor } from './styles/index.mjs'
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
  const d = join(root, cfg.dir)
  mkdirSync(join(d, '.local'), { recursive: true })
  writeFileSync(join(d, '.local', 'screens-classes.txt'), screenClasses(join(d, 'screens')))
  return adapterFor(cfg).build(root, cfg, dataDir)
}

export async function writeCss(root, cfg, dataDir) {
  const css = await buildCss(root, cfg, dataDir)
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

// Only the message goes to stderr, so the viewer's red bar and the check show the cause, not a stack line.
if (isMain(import.meta.url)) {
  const root = projectRoot(process.cwd())
  const cfg = readConfig(root)
  try {
    const n = await writeCss(root, cfg, parseDataArg(process.argv))
    console.log(`${cfg.dir}/dist/design.css: ${n} bytes.`)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
