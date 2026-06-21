import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '')
  // GitHub Pages serves project sites at /repo-name/ — set VITE_BASE_PATH in CI.
  const base = env.VITE_BASE_PATH?.trim() || '/'

  return {
    base,
  }
})
