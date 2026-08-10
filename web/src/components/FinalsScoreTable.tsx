import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import type { FinalsFile } from '../lib/types'

interface Props {
  finals: FinalsFile
}

/** ソート対象: 審査員のindex、または合計列 */
type SortKey = number | 'total'
interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

// 本家テロップ準拠の閾値色分け(境界は90/80)。合計列には付けない。
function medalClass(score: number | null | undefined): string {
  if (typeof score !== 'number') return ''
  if (score >= 90) return 'gold'
  if (score >= 80) return 'silver'
  return 'bronze'
}

export default function FinalsScoreTable({ finals }: Props) {
  const judges = finals.judges
  const rows = finals.firstRound
  // 最終決戦(1本目上位2〜3組)へ進出した組。行をハイライトして進出ラインを可視化する。
  // combiId優先、null時はnameで判定(同一年内でコンビ名は一意・finalRound名⊆firstRound名)
  const finalistKeys = useMemo(() => {
    const ids = new Set<number>()
    const names = new Set<string>()
    for (const r of finals.finalRound ?? []) {
      if (r.combiId != null) ids.add(r.combiId)
      if (r.name) names.add(r.name)
    }
    return { ids, names }
  }, [finals.finalRound])
  const isFinalist = (row: (typeof rows)[number]) =>
    (row.combiId != null && finalistKeys.ids.has(row.combiId)) || finalistKeys.names.has(row.name)
  // 審査員ごとの集計ON/OFF(初期は全ON)。yearが変わると key で再マウントされ初期化される
  const [enabled, setEnabled] = useState<boolean[]>(() => judges.map(() => true))
  // null=既定(再計算順位の昇順)
  const [sort, setSort] = useState<SortState | null>(null)

  const selectedCount = enabled.filter(Boolean).length
  const isSubset = selectedCount !== judges.length

  // 選択審査員のみの合計と、その合計による標準順位(同点は同順位)
  const { totals, rankByIndex } = useMemo(() => {
    const totals = rows.map((row) => {
      const scores = row.scores ?? []
      let sum = 0
      for (let i = 0; i < judges.length; i++) {
        if (enabled[i] && typeof scores[i] === 'number') sum += scores[i] as number
      }
      return sum
    })
    const order = rows.map((_, i) => i).sort((a, b) => totals[b] - totals[a])
    const rankByIndex = new Array<number>(rows.length)
    let lastTotal: number | null = null
    let lastRank = 0
    order.forEach((idx, pos) => {
      if (lastTotal === null || totals[idx] !== lastTotal) {
        lastRank = pos + 1
        lastTotal = totals[idx]
      }
      rankByIndex[idx] = lastRank
    })
    return { totals, rankByIndex }
  }, [rows, judges.length, enabled])

  // 表示順(元配列は破壊せずindex配列を並べ替え)。タイブレークは公式順位→登場順
  const displayOrder = useMemo(() => {
    const officialRank = (i: number) => rows[i].rank ?? rows[i].order ?? 99
    const idxs = rows.map((_, i) => i)
    if (sort === null) {
      return idxs.sort((a, b) => {
        const d = rankByIndex[a] - rankByIndex[b]
        return d !== 0 ? d : officialRank(a) - officialRank(b)
      })
    }
    const valueOf = (i: number): number => {
      if (sort.key === 'total') return totals[i]
      const v = (rows[i].scores ?? [])[sort.key]
      return typeof v === 'number' ? v : -Infinity
    }
    const mul = sort.dir === 'desc' ? -1 : 1
    return idxs.sort((a, b) => {
      const d = (valueOf(a) - valueOf(b)) * mul
      if (d !== 0) return d
      const r = rankByIndex[a] - rankByIndex[b]
      return r !== 0 ? r : officialRank(a) - officialRank(b)
    })
  }, [rows, sort, totals, rankByIndex])

  function toggleJudge(i: number) {
    setEnabled((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
  }
  function setAll(value: boolean) {
    setEnabled(judges.map(() => value))
  }
  // 3状態: 別列→desc / 同列desc→asc / 同列asc→クリア(既定へ)
  function clickSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' }
      if (prev.dir === 'desc') return { key, dir: 'asc' }
      return null
    })
  }

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (!sort || sort.key !== key) return 'none'
    return sort.dir === 'asc' ? 'ascending' : 'descending'
  }
  const arrow = (key: SortKey): string => {
    if (!sort || sort.key !== key) return ''
    return sort.dir === 'asc' ? '▲' : '▼'
  }

  return (
    <>
      <div className="toolbar finals-controls">
        <span className="finals-controls-label">審査員</span>
        <div className="seg">
          <button type="button" className={selectedCount === judges.length ? 'active' : ''} onClick={() => setAll(true)}>
            全選択
          </button>
          <button type="button" className={selectedCount === 0 ? 'active' : ''} onClick={() => setAll(false)}>
            全解除
          </button>
        </div>
        <span className="finals-count">
          選択中 {selectedCount}/{judges.length}人
        </span>
      </div>
      <div className="history-wrap">
        <table className="history finals-table">
          <thead>
            <tr>
              <th className="sortable">
                <button type="button" className="th-sort" onClick={() => setSort(null)} title="既定の順位に戻す">
                  順
                </button>
              </th>
              <th>コンビ</th>
              {judges.map((j, i) => (
                <th key={i} className={`judge-th ${enabled[i] ? '' : 'excluded'}`} aria-sort={ariaSort(i)}>
                  <label className="judge-check">
                    <input
                      type="checkbox"
                      checked={enabled[i]}
                      onChange={() => toggleJudge(i)}
                      aria-label={`${j} を集計に含める`}
                    />
                  </label>
                  <button type="button" className="th-sort" onClick={() => clickSort(i)} aria-label={`${j} の点数でソート`}>
                    {j}
                    <span className="sort-arrow">{arrow(i)}</span>
                  </button>
                </th>
              ))}
              <th className="sortable" aria-sort={ariaSort('total')}>
                <button type="button" className="th-sort" onClick={() => clickSort('total')}>
                  {isSubset ? '合計*' : '合計'}
                  <span className="sort-arrow">{arrow('total')}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {displayOrder.map((i) => {
              const row = rows[i]
              const scores = row.scores ?? []
              return (
                <tr key={row.name} className={isFinalist(row) ? 'finalist' : undefined}>
                  <td className="no">{rankByIndex[i]}</td>
                  <td>
                    {row.combiId != null ? <Link to={`/combi/${row.combiId}`}>{row.name}</Link> : row.name}
                  </td>
                  {judges.map((_, j) => {
                    const s = scores[j]
                    const cls = enabled[j] ? medalClass(s) : 'excluded'
                    return (
                      <td key={j} className={`no ${cls}`}>
                        {s ?? ''}
                      </td>
                    )
                  })}
                  <td className="no total">{totals[i]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
