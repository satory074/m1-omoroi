// ../data (スクレイパーの生成物) を public/data へコピーする。dev/build 前に実行される。
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, '..', 'data')
const dest = join(root, 'public', 'data')

if (!existsSync(src)) {
  console.warn(`[copy-data] ${src} がありません(スクレイパー未実行)。スキップします`)
  process.exit(0)
}
rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log(`[copy-data] ${src} -> ${dest}`)
