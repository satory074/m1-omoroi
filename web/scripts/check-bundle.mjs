// 配信サイズ(gzip)の上限を確かめる。`npm run build` の後に実行する。
// 最初に読み込まれる JS(index.html が直接読むもの)と CSS の合計が上限を超えたら失敗させる。
// 改修前は 236KB(gzip)。第2段階で決勝・統計ページを遅延読み込みに分けて 119KB になったので、
// 少しの余裕を足した 130KB を上限にする(年度一覧・コンビ詳細・トップを開く人が待つ量)。
import { readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BUDGET_KB = { js: 130, css: 12 }

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const indexHtml = join(dist, 'index.html')
if (!existsSync(indexHtml)) {
  console.error('[check-bundle] dist/index.html がありません。先に npm run build を実行してください')
  process.exit(1)
}

const html = readFileSync(indexHtml, 'utf8')
// index.html が直接参照する assets だけを数える(遅延読み込みの chunk は含めない)
const refs = [...html.matchAll(/(?:src|href)="[^"]*?\/(assets\/[^"]+\.(js|css))"/g)]
const totals = { js: 0, css: 0 }
for (const [, path, kind] of refs) {
  const gz = gzipSync(readFileSync(join(dist, path))).length
  totals[kind] += gz
  console.log(`[check-bundle] ${path}  ${(gz / 1024).toFixed(1)}KB (gzip)`)
}

let failed = false
for (const kind of ['js', 'css']) {
  const kb = totals[kind] / 1024
  const ok = kb <= BUDGET_KB[kind]
  if (!ok) failed = true
  console.log(`[check-bundle] 最初に読む ${kind}: ${kb.toFixed(1)}KB / 上限 ${BUDGET_KB[kind]}KB ${ok ? 'OK' : '超過'}`)
}
process.exit(failed ? 1 : 0)
