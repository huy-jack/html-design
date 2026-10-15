// Runtime packages come from the project (walking up from fromDir) or from the plugin data folder.
import { createRequire } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const dataPaths = (data) => ({ modules: join(data, 'node_modules'), browsers: join(data, 'browsers'), profiles: join(data, 'profiles'), tailwind: join(data, 'tailwind'), tw3: join(data, 'tw3') })

export function parseDataArg(argv) {
  const i = argv.indexOf('--data')
  return i >= 0 ? argv[i + 1] ?? null : null
}

export function loadDep(dataDir, name, fromDir = process.cwd()) {
  let dir = fromDir
  for (;;) {
    if (existsSync(join(dir, 'node_modules', name))) return createRequire(join(dir, 'noop.js'))(name)
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  if (dataDir && existsSync(join(dataDir, 'node_modules', name))) return createRequire(join(dataDir, 'noop.js'))(name)
  throw new Error(`Missing ${name}: run /html-design setup`)
}

// jsdom and prettier: the data folder first (setup pins the versions there), then the project.
export function loadDepDataFirst(dataDir, name, fromDir = process.cwd(), accept = () => true) {
  if (dataDir && existsSync(join(dataDir, 'node_modules', name))) return createRequire(join(dataDir, 'noop.js'))(name)
  let mod = null
  try { mod = loadDep(null, name, fromDir) } catch {}
  if (mod && accept(mod)) return mod
  throw new Error(`Missing ${name}: run /html-design setup`)
}

// True when the file at moduleUrl is the script node was started with. Compares real paths, so a
// symlinked folder (for example /var and /private/var on macOS) still counts.
export function isMain(moduleUrl) {
  if (!process.argv[1]) return false
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl)) } catch { return false }
}

// A package's package.json, searched from startDir up to the project root and never above it, so a
// node_modules folder outside the project (or a global one) does not count as the project's.
export function findPackage(name, startDir, rootDir) {
  let dir = startDir
  for (;;) {
    const f = join(dir, 'node_modules', name, 'package.json')
    if (existsSync(f)) return f
    if (dir === rootDir) return null
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}
