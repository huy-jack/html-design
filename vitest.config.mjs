import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.spec.mjs'], pool: 'forks', poolOptions: { forks: { maxForks: 2 } }, testTimeout: 30000 } })
