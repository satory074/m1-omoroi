import { Link } from 'react-router-dom'

import { useRankings } from '../lib/api'
import type { RankingItem } from '../lib/types'

const SECTIONS: { key: keyof import('../lib/types').Rankings; title: string; unit: string; note?: string }[] = [
  { key: 'mostAppearances', title: '最多出場', unit: '回' },
  { key: 'mostSemifinalFails', title: '準決勝 最多敗退', unit: '回', note: 'あと一歩の悲運ランキング' },
  { key: 'mostQuarterfinals', title: '準々決勝 最多進出', unit: '回' },
  { key: 'mostFinals', title: '決勝 最多進出', unit: '回' },
  { key: 'mostFirstRoundFails', title: '1回戦 最多敗退', unit: '回', note: 'それでも挑み続けた記録' },
]

function RankTable({ items, unit }: { items: RankingItem[]; unit: string }) {
  return (
    <ol className="rank-list">
      {items.map((item, i) => (
        <li key={item.id}>
          <span className="rank-pos">{i + 1}</span>
          <Link className="rank-name" to={`/combi/${item.id}`}>
            {item.name}
          </Link>
          <span className="rank-value">
            {item.value}
            <small>{unit}</small>
          </span>
        </li>
      ))}
    </ol>
  )
}

export default function RankingsPage() {
  const { data, isLoading, isError } = useRankings()
  if (isError) return <div className="error-box">ランキングを読み込めませんでした。</div>
  if (isLoading || !data) return <div className="loading">読み込み中…</div>

  return (
    <>
      <h1 className="page-title">記録ランキング</h1>
      <p className="page-lede">公式コンビ情報(2015年以降)から集計した通算記録</p>
      <div className="rank-grid">
        {SECTIONS.map((s) => (
          <section key={s.key} className="rank-section">
            <h2 className="section-title">{s.title}</h2>
            {s.note && <p className="section-note">{s.note}</p>}
            <RankTable items={data[s.key].slice(0, 15)} unit={s.unit} />
          </section>
        ))}
      </div>
    </>
  )
}
