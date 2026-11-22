// 年度ファイル(public/data/years/{year}.json、最大 1.7MB)から、年度ページの「この年のまとめ」用の
// 小さな要約 public/data/years/{year}.summary.json(数KB)を作る。copy-data.mjs の後に実行する(predev / prebuild)。
//
// なぜ: 年度ページは事前描画して HTML に中身を入れるが、1.7MB の年度ファイルを HTML に埋め込むわけにはいかない。
// 要約なら埋め込めるので、JavaScript を実行しないクローラーにも「優勝・決勝・準決勝の顔ぶれと回戦ごとの組数」が読める。
// 画面(src/components/YearSummary.tsx)も同じ要約を読むので、HTML と画面の中身は一致する。
//
// 数え方は年度ページ(src/pages/YearPage.tsx の roundCounts / passCount)と同じ:
//   出場 = その回戦の結果(results[回戦])がある組、通過 = 結果が PASSING(src/lib/rounds.ts と一致させること)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROUND_ORDER = ['first', 'second', 'third', 'quarterfinal', 'semifinal', 'playoff', 'final']
const PASSING = new Set(['pass', 'seed_pass', 'champion'])
/** 名前を並べる回戦(上から)。それより下の回戦は組数だけ */
const NAMED_ROUNDS = ['final', 'semifinal', 'quarterfinal']

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = join(root, 'public', 'data', 'years')
if (!existsSync(dir)) {
  console.warn(`[year-summaries] ${dir} がありません(copy-data 未実行)。スキップします`)
  process.exit(0)
}

const byKana = (a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja')
let written = 0
for (const file of readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f))) {
  const yf = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const rounds = ROUND_ORDER.map((round) => {
    const rows = yf.entries.filter((e) => e.results[round])
    return { round, appeared: rows.length, passed: rows.filter((e) => PASSING.has(e.results[round])).length }
  }).filter((r) => r.appeared > 0)

  const champ = yf.entries.find((e) => e.results.final === 'champion')
  const reached = NAMED_ROUNDS.map((round) => {
    const seen = new Set()
    const combis = []
    for (const e of [...yf.entries].filter((x) => x.results[round]).sort(byKana)) {
      // アーカイブには同じ組が全半角違いで2行ある年がある。同じ ID は1回だけ
      if (e.id != null && seen.has(e.id)) continue
      if (e.id != null) seen.add(e.id)
      combis.push({ id: e.id ?? null, name: e.name })
    }
    return { round, combis }
  }).filter((g) => g.combis.length > 0)

  const summary = {
    year: yf.year,
    source: yf.source,
    entries: yf.entries.length,
    rounds,
    champion: champ ? { id: champ.id ?? null, name: champ.name } : null,
    reached,
  }
  writeFileSync(join(dir, file.replace('.json', '.summary.json')), JSON.stringify(summary))
  written++
}
console.log(`[year-summaries] ${written} 年分の要約を ${dir} に書きました`)
