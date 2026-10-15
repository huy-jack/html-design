// The runtime packages (jsdom, prettier) shared by every script. Each entry point calls
// setDataDir with its --data folder before it uses screen files or notes.
import { loadDepDataFirst } from './deps.mjs'

let dataDir = null
const cache = new Map()

export function setDataDir(dir) {
  dataDir = dir ?? null
  cache.clear()
}
export const getDataDir = () => dataDir

function dep(name, accept) {
  if (!cache.has(name)) cache.set(name, loadDepDataFirst(dataDir, name, process.cwd(), accept))
  return cache.get(name)
}
export const jsdom = () => dep('jsdom')
// The screen writer uses the synchronous prettier 2 API.
export const prettier = () => dep('prettier', (m) => typeof m.version === 'string' && m.version.startsWith('2.'))
// Loads both now, so a missing setup fails at start with one clear message.
export function loadRuntime() {
  jsdom()
  prettier()
}
