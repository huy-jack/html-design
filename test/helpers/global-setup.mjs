// Runs once before all test files, so 2 parallel workers never run npm install in the same folder.
import { ensureTw3 } from './tw3.mjs'
export function setup() {
  ensureTw3()
}
