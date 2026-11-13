import { Link } from 'react-router-dom'

import { competitionRanks } from '../lib/rank'
import CombiLink from './CombiLink'
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

/** 同点込みランキングリスト(記録・統計の各タブ共用) */
export function RankTable({ items, unit }: { items: RankRow[]; unit: string }) {
  // 同値は順位を共有する(標準競技順位: 1,1,3,…)
  const rank = competitionRanks(items, (it) => it.value)
  const hasSub = items.some((it) => it.detail || (it.years && it.years.length > 0))
  return (
    <ol className={`rank-list${hasSub ? ' vote-list' : ''}`}>
      {items.map((item, i) => {
        const sub = item.detail ?? (item.years && item.years.length > 0 ? item.years.join('・') : null)
        return (
          // 年齢記録では同じコンビの2人が同一リストに並ぶため、id 単独ではキーが重複する
          <li key={`${item.id ?? ''}:${item.name}`}>
            <div className="rank-main">
              <span className="rank-pos">{rank[i]}</span>
              <CombiLink id={item.id} className="rank-name">
                {item.name}
              </CombiLink>
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
          <CombiLink id={w.combiId}>{w.name}</CombiLink>(<Link to={`/finals/${w.year}`}>{w.year}</Link>)
        </span>
      ))}
    </>
  )
}
