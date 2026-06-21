import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool } from '../api/_lib/db'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(rootDir, 'db/migrations')

const files = (await readdir(migrationsDir))
  .filter((file) => file.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b))

for (const file of files) {
  const sql = await readFile(path.join(migrationsDir, file), 'utf8')
  await getPool().query(sql)
  console.log(`applied ${file}`)
}

await getPool().end()
