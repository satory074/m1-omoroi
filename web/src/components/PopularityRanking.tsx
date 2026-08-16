import { Link } from 'react-router-dom'

import { useAdvancers, useCombiIndex, usePopularity } from '../lib/api'
import { ROUND_LABEL, formatHits } from '../lib/rounds'
import type { RoundKey } from '../lib/types'

const TOP = 30
const HIDDEN_TOP = 15

/**
 * 注目度(YouTube再生数)ランキング。popularity.json はCIが日次ローリング更新するため
 * build に焼き込まず、フロントで combi索引・advancers と動的に結合する。
 */
export default function PopularityRanking() {
  const { data: pop } = usePopularity()
  const { data: index } = useCombiIndex(!!pop)
  const { data: advancers } = useAdvancers()
  if (!pop || !index) return null

  const names = new Map(index.map((r) => [r[0], r[1]]))
  const rows = Object.entries(pop.hits)
    .map(([id, h]) => ({ id: Number(id), n: h.n, at: h.at }))
    .filter((r) => names.has(r.id) && r.n > 0)
    .sort((a, b) => b.n - a.n)
  if (rows.length === 0) return null

  // 最高到達ラウンド(advancers は準々決勝以上のみ。注目度の対象は3回戦以上経験組)
  const reach = new Map<number, RoundKey>()
  for (const tier of advancers?.tiers ?? []) {
    for (const c of tier.combis) reach.set(c.id, tier.round)
  }
  const finalIds = new Set(
    (advancers?.tiers ?? []).filter((t) => t.round === 'final').flatMap((t) => t.combis.map((c) => c.id)),
  )
  const hidden = rows.filter((r) => !finalIds.has(r.id)).slice(0, HIDDEN_TOP)

  const table = (list: typeof rows, showReach: boolean) => (
    <div className="history-wrap">
      <table className="history">
        <thead>
          <tr>
            <th>順位</th>
            <th>コンビ</th>
            <th>再生数</th>
            {showReach && <th>最高到達</th>}
          </tr>
        </thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={r.id}>
              <td className="no">{i + 1}</td>
              <td>
                <Link to={`/combi/${r.id}`}>{names.get(r.id)}</Link>
              </td>
              <td className="no">{formatHits(r.n)}</td>
              {showReach && <td>{ROUND_LABEL[reach.get(r.id) ?? 'third']}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      <h1 className="page-title">注目度</h1>
      <p className="page-lede">
        YouTube再生数からみた現在の注目度。年度別の結果ページのソートにも使われている指標。
      </p>
      <h2 className="section-title">注目度ランキング(YouTube再生数)</h2>
      <p className="section-note">
        「コンビ名 漫才」でのYouTube検索上位のうちコンビ名を含む動画の再生数合計。対象は3回戦以上の出場経験があるコンビで、
        取得日はコンビごとに異なる(約2週間周期の自動更新)。
      </p>
      {table(rows.slice(0, TOP), false)}

      <h2 className="section-title">決勝未経験の注目株</h2>
      <p className="section-note">決勝(2001〜2025)に進んだことがないのに再生数が多いコンビ。</p>
      {table(hidden, true)}
    </>
  )
}
