import { Link } from 'react-router-dom'

import { competitionRanks } from '../lib/rank'
import type { FinalsStatsWinner } from '../lib/types'

export interface RankRow {
  id: number | null
  name: string
  value: number
  /** 該当年のリスト(あれば2行目に表示) */
  years?: number[]
  /** 2行目に表示する補足テキスト(years より優先) */
  detail?: string
}

/** 同点込みランキングリスト(記録ランキング/統計ページ共用) */
export function RankTable({ items, unit }: { items: RankRow[]; unit: string }) {
  // 同値は順位を共有する(標準競技順位: 1,1,3,…)
  const rank = competitionRanks(items, (it) => it.value)
  const hasSub = items.some((it) => it.detail || (it.years && it.years.length > 0))
  return (
    <ol className={`rank-list${hasSub ? ' vote-list' : ''}`}>
      {items.map((item, i) => {
        const sub = item.detail ?? (item.years && item.years.length > 0 ? item.years.join('・') : null)
        return (
          <li key={item.id ?? item.name}>
            <div className="rank-main">
              <span className={`rank-pos${rank[i] === 1 ? ' champion' : ''}`}>{rank[i]}</span>
              {item.id != null ? (
                <Link className="rank-name" to={`/combi/${item.id}`} title={item.name}>
                  {item.name}
                </Link>
              ) : (
                <span className="rank-name" title={item.name}>
                  {item.name}
                </span>
              )}
              <span className="rank-value">
                {item.value}
                <small>{unit}</small>
              </span>
            </div>
            {sub && <div className="rank-voters">{sub}</div>}
          </li>
        )
      })}
    </ol>
  )
}

/** 優勝コンビセル: 「コンビ名(年)」をリンクつきで列挙 */
export function WinnersCell({ winners }: { winners: FinalsStatsWinner[] }) {
  if (winners.length === 0) return <>—</>
  return (
    <>
      {winners.map((w, i) => (
        <span key={`${w.year}-${w.name}`} className="winner-item">
          {i > 0 && '・'}
          {w.combiId != null ? <Link to={`/combi/${w.combiId}`}>{w.name}</Link> : w.name}({w.year})
        </span>
      ))}
    </>
  )
}
