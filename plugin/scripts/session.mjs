// usage: node session.mjs start|stop|status --data <dir> [--headless]  (run in the project root)
// One background session per project: the viewer server and the app browser. State is <dir>/.local/session.json.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './browser.mjs'
import { projectRoot, readConfig } from './config.mjs'
import { dataPaths, isMain, parseDataArg } from './deps.mjs'
import { setDataDir } from './runtime.mjs'
import { adapterFor, styleName } from './styles/index.mjs'
import { readNotes } from './notes.mjs'
import { writeSwitcher } from './switcher-node.mjs'
import { createViewServer } from './view.mjs'

const PLAYWRIGHT_VERSION = '1.56.1'
const WAIT_MS = 45000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const localDir = (root, cfg) => join(root, cfg.dir, '.local')
const sessionFile = (root, cfg) => join(localDir(root, cfg), 'session.json')
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
// The command line of pid; '' when no such process; null when there is no ps (Windows).
export function psCommand(pid) {
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch (e) { return e.code === 'ENOENT' ? null : '' }
}
// True when port serves this plugin's viewer home page.
export async function viewerAnswers(port, fetchFn = fetch) {
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })
    return res.ok && (await res.text()).includes('<title>Designs</title>')
  } catch { return false }
}
// A reused pid must not be mistaken for the session: its command line has to name session.mjs. Without
// ps, the live pid must also own a port that answers with the viewer page.
export async function isOurSession(s, { ps = psCommand, fetchFn = fetch } = {}) {
  const cmd = ps(s.pid)
  if (cmd !== null) return cmd.includes('session.mjs')
  return Number.isInteger(s.port) && viewerAnswers(s.port, fetchFn)
}

// A session.json whose pid is dead is stale: it counts as not running.
async function readSession(root, cfg) {
  let s
  try { s = JSON.parse(readFileSync(sessionFile(root, cfg), 'utf8')) } catch { return null }
  return Number.isInteger(s.pid) && alive(s.pid) && (await isOurSession(s)) ? s : null
}
const urls = (port) => `Viewer http://127.0.0.1:${port}/  Copy window http://127.0.0.1:${port}/__copy`

async function start(root, cfg, data, headless) {
  const running = await readSession(root, cfg)
  if (running) { console.log(urls(running.port)); return 0 }
  mkdirSync(localDir(root, cfg), { recursive: true })
  rmSync(sessionFile(root, cfg), { force: true })
  const log = join(localDir(root, cfg), 'session.log')
  const fd = openSync(log, 'w')
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', '--data', data, ...(headless ? ['--headless'] : [])], { cwd: root, detached: true, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  let exited = null
  child.on('exit', (code) => { exited = code ?? 1 })
  child.unref()
  const until = Date.now() + WAIT_MS
  while (Date.now() < until) {
    const s = await readSession(root, cfg)
    if (s) { console.log(urls(s.port)); return 0 }
    if (exited !== null) break
    await sleep(100)
  }
  const tail = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').slice(-8).join('\n') : ''
  console.error(exited === null ? `The session did not start within ${WAIT_MS / 1000} s. See ${cfg.dir}/.local/session.log` : `The session stopped while starting.`)
  if (tail) console.error(tail)
  if (exited === null) child.kill('SIGTERM')
  return exited || 1
}

async function stop(root, cfg) {
  const s = await readSession(root, cfg)
  rmSync(sessionFile(root, cfg), { force: true })
  if (!s) { console.log('No session is running.'); return 0 }
  try { process.kill(s.pid, 'SIGTERM') } catch (e) { if (e.code !== 'ESRCH') throw e }
  for (let i = 0; i < 100 && alive(s.pid); i++) await sleep(100)
  console.log('Session stopped.')
  return 0
}

async function status(root, cfg) {
  const s = await readSession(root, cfg)
  if (!s) { rmSync(sessionFile(root, cfg), { force: true }); console.log(JSON.stringify({ running: false })); return 0 }
  const dir = join(root, cfg.dir, 'screens')
  const screens = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html')).length : 0
  let openNotes = 0
  try { openNotes = readNotes(root, cfg).filter((n) => !n.done).length } catch {}
  console.log(JSON.stringify({ running: true, port: s.port, screens, openNotes, style: styleName(cfg) }))
  return 0
}

// Starts the viewer and the browser. Throws { exitCode, message } when it cannot. Returns { view, browser, close }.
export async function startSession({ root, cfg, data, headless = false, openPages = true }) {
  setDataDir(data)
  const pluginRoot = join(import.meta.dirname, '..')
  if (writeSwitcher(pluginRoot, join(root, cfg.dir), cfg)) console.log('switcher.js refreshed')
  let version = null
  try { version = readFileSync(join(data, 'playwright-version.txt'), 'utf8').trim() } catch {}
  if (version !== PLAYWRIGHT_VERSION) throw Object.assign(new Error('Run /html-design setup again'), { exitCode: 6 })
  const notReady = adapterFor(cfg).ready(data, cfg, root)
  if (notReady) throw Object.assign(new Error(notReady), { exitCode: 6 })

  // The viewer starts first (the browser needs its origin); it reaches the browser through this late-bound handle.
  let browser = null
  const handle = {
    appPages: () => (browser ? browser.appPages() : []),
    copyFrom: (...a) => browser.copyFrom(...a),
    resize: (...a) => browser.resize(...a),
    targetIdOf: (...a) => browser.targetIdOf(...a),
    badge: (...a) => browser.badge(...a),
  }
  // Names from the Copy window; the chord reuses them.
  let preset = null
  const view = await createViewServer({ root, cfg, dataDir: data, browser: handle, onPreset: (p) => { preset = p } })
  const origin = `http://127.0.0.1:${view.port}`
  const profileDir = join(dataPaths(data).profiles, createHash('sha256').update(root).digest('hex').slice(0, 12))
  mkdirSync(profileDir, { recursive: true })
  // The user is in the app tab, so the result shows there too: a toast, added only after the copy is done.
  const onChord = async (page) => {
    const p = preset
    if (!p) {
      console.warn('Chord ignored: fill in a screen and state in the Copy window first.')
      return browser.toast(page, 'Fill in a screen and state in the Copy tab first')
    }
    try {
      const out = await browser.copyFrom(page, { screen: p.screen, state: p.state, label: p.label })
      console.log(out.status === 201 ? `Chord copy saved ${out.saved}` : `Chord copy skipped: state ${p.state} already exists`)
      await browser.toast(page, out.status === 201 ? `Saved ${p.state}` : `${p.state} already exists: change the state id in the Copy tab`)
    } catch (e) {
      console.error(`Chord copy failed: ${e.message}`)
      await browser.toast(page, `Copy failed: ${e.message}`)
    }
  }
  const close = async () => {
    rmSync(sessionFile(root, cfg), { force: true })
    if (browser) await browser.close().catch(() => {})
    await view.close().catch(() => {})
  }
  try {
    browser = await openBrowser({ root, cfg, dataDir: data, profileDir, onChord, headless, viewerOrigin: origin })
  } catch (e) {
    await close()
    throw Object.assign(new Error(`Could not open the browser: ${e.message}`), { exitCode: 1 })
  }
  if (openPages) {
    for (const path of ['/', '/__copy']) {
      const page = await browser.context.newPage()
      await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch((e) => console.error(`Could not open ${path}: ${e.message}`))
    }
  }
  // Written only now: start and status report the session once the browser can take a copy.
  mkdirSync(localDir(root, cfg), { recursive: true })
  const { version: pluginVersion } = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin/plugin.json'), 'utf8'))
  writeFileSync(sessionFile(root, cfg), JSON.stringify({ pid: process.pid, port: view.port, cdpPort: browser.cdpPort, version: pluginVersion, pluginRoot }) + '\n')
  return { view, browser, close }
}

async function run(root, cfg, data, headless) {
  let session
  try { session = await startSession({ root, cfg, data, headless }) } catch (e) { console.error(e.message); return e.exitCode ?? 1 }
  let done = false
  const shutdown = async () => {
    if (done) return
    done = true
    await session.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  session.browser.context.on('close', shutdown)
  console.log(`Session running: ${urls(session.view.port)}`)
  return null
}

async function main() {
  const [cmd] = process.argv.slice(2)
  const data = parseDataArg(process.argv)
  if (!['start', 'stop', 'status', 'run'].includes(cmd) || !data) { console.error('usage: session.mjs start|stop|status --data <dir> [--headless]'); process.exit(2) }
  setDataDir(data)
  const root = projectRoot(process.cwd())
  let cfg
  try { cfg = readConfig(root) } catch (e) { console.error(e.message); process.exit(6) }
  const headless = process.argv.includes('--headless')
  const code = cmd === 'start' ? await start(root, cfg, data, headless) : cmd === 'stop' ? await stop(root, cfg) : cmd === 'status' ? await status(root, cfg) : await run(root, cfg, data, headless)
  if (code !== null) process.exit(code)
}
if (isMain(import.meta.url)) await main()
