import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { MY_SCORE_DEFAULT, clampMyScore, loadMyScores, saveMyScores } from '../lib/myScores'
import type { MyScores } from '../lib/myScores'
import type { FinalsFile, FinalsScore } from '../lib/types'

interface Props {
  finals: FinalsFile
}

/** ソート対象: 審査員のindex、あなた列、合計列、または出番順列 */
type SortKey = number | 'total' | 'order' | 'you'
interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

// 本家テロップ準拠の2階調(境界は90)。90点以上=金属ゴールド / 89点以下=白。合計列には付けない。
function scoreClass(score: number | null | undefined): string {
  if (typeof score !== 'number') return ''
  return score >= 90 ? 'gold' : ''
}

/** 値配列の標準競技順位(同値は同順位、非数値は null)。合計・審査員列・あなた列で共用 */
function competitionRankOf(vals: readonly (number | null | undefined)[]): (number | null)[] {
  const sortedIdx = vals
    .map((_, i) => i)
    .filter((i) => typeof vals[i] === 'number')
    .sort((a, b) => (vals[b] as number) - (vals[a] as number))
  const ranks = new Array<number | null>(vals.length).fill(null)
  let lastVal: number | null = null
  let lastRank = 0
  sortedIdx.forEach((idx, pos) => {
    if (lastVal === null || vals[idx] !== lastVal) {
      lastRank = pos + 1
      lastVal = vals[idx] as number
    }
    ranks[idx] = lastRank
  })
  return ranks
}

/** localStorage 上での組の同定キー。combiId は全21年の firstRound 全行で non-null だが、
 *  将来 null が来た場合はコンビ名(同一年内で一意)へ退避する */
const rowKeyOf = (row: FinalsScore): string => (row.combiId != null ? `#${row.combiId}` : row.name)

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
  // 出番順列は判明している年のみ表示(全21年分入力済みだが将来の欠損に備える)
  const hasOrder = rows.some((r) => r.order != null)
  // 審査員ごとの集計ON/OFF(初期は全ON)。yearが変わると key で再マウントされ初期化される
  const [enabled, setEnabled] = useState<boolean[]>(() => judges.map(() => true))
  // 「あなた」列の集計ON/OFF。enabled 配列には混ぜない —
  // setAll が judges.length 長の配列を作り直すため、混ぜると全選択/全解除の瞬間に要素が落ちる
  const [youEnabled, setYouEnabled] = useState(true)
  // あなたがつけた点数。FinalsPage が key={finals.year} で再マウントするので初期化時に読める。
  // その年の出場組に無い古いキー(データ修正で消えた組)はここで捨てる
  const [myScores, setMyScores] = useState<MyScores>(() =>
    loadMyScores(finals.year, rows.map(rowKeyOf)),
  )
  // null=既定(再計算順位の昇順)
  const [sort, setSort] = useState<SortState | null>(null)

  // rows と同じ並びに直したあなたの点数。未入力は undefined
  const myList = useMemo(() => rows.map((r) => myScores[rowKeyOf(r)]), [rows, myScores])
  const myFilledCount = myList.filter((v) => typeof v === 'number').length

  const selectedCount = enabled.filter(Boolean).length
  // 「合計*」= 公式の合計とは異なる集計であることの印。審査員を外しているときに加え、
  // あなたの点を合計に入れているときもズレる
  const isSubset = selectedCount !== judges.length || (youEnabled && myFilledCount > 0)

  // 選択審査員(+あなた)のみの合計と、その合計による標準順位(同点は同順位)
  const { totals, rankByIndex } = useMemo(() => {
    const totals = rows.map((row, ri) => {
      const scores = row.scores ?? []
      let sum = 0
      for (let i = 0; i < judges.length; i++) {
        if (enabled[i] && typeof scores[i] === 'number') sum += scores[i] as number
      }
      const my = myList[ri]
      if (youEnabled && typeof my === 'number') sum += my
      return sum
    })
    // 合計は常に数値なので順位に null は入らない
    return { totals, rankByIndex: competitionRankOf(totals) as number[] }
  }, [rows, judges.length, enabled, myList, youEnabled])

  // 審査員ごと(列ごと)の順位(同点は同順位)。合計のON/OFFとは独立な情報なので enabled に依存しない
  const rankInJudge = useMemo(
    () => judges.map((_, j) => competitionRankOf(rows.map((r) => (r.scores ?? [])[j]))),
    [rows, judges],
  )
  // あなた列の列内順位。審査員列と同じく youEnabled には依存しない
  const rankInMy = useMemo(() => competitionRankOf(myList), [myList])

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
      if (sort.key === 'order') return rows[i].order ?? Infinity
      if (sort.key === 'you') {
        const v = myList[i]
        return typeof v === 'number' ? v : -Infinity
      }
      const v = (rows[i].scores ?? [])[sort.key]
      return typeof v === 'number' ? v : -Infinity
    }
    const mul = sort.dir === 'desc' ? -1 : 1
    return idxs.sort((a, b) => {
      const va = valueOf(a)
      const vb = valueOf(b)
      // 欠損同士は ±Infinity で同値。引き算すると NaN になり、比較関数の戻り値が +0 扱いされて
      // タイブレーク(再計算順位→公式順位)へ進まないため、先に同値判定してから差を取る
      const d = va === vb ? 0 : (va - vb) * mul
      if (d !== 0) return d
      const r = rankByIndex[a] - rankByIndex[b]
      return r !== 0 ? r : officialRank(a) - officialRank(b)
    })
  }, [rows, sort, totals, rankByIndex, myList])

  // 出番順(無ければ公式順位)。表示順は入力のたびに変わるので、Enterでの移動はこの安定順で行う
  const entryOrder = useMemo(
    () =>
      rows
        .map((_, i) => i)
        .sort(
          (a, b) =>
            (rows[a].order ?? rows[a].rank ?? 99) - (rows[b].order ?? rows[b].rank ?? 99),
        ),
    [rows],
  )
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])
  // 常に最新の採点を指すref。commitMyScores だけが myScores を書き換えるので state と同期する。
  // 同一tick内にキー操作が連続しても、再レンダー前の古いクロージャ値で上書きしないために使う
  const myScoresRef = useRef(myScores)

  function toggleJudge(i: number) {
    setEnabled((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
  }
  // 全選択/全解除は実在の審査員のみが対象。こうすると「全解除」1クリックで
  // 「あなたの採点だけの合計・順位」が見られる
  function setAll(value: boolean) {
    setEnabled(judges.map(() => value))
  }
  // 保存は state 更新と同時に行う。updater 関数の中で保存すると StrictMode で二重に走るため、
  // 現在の myScores から次の値を組み立ててからまとめて反映する
  function commitMyScores(next: MyScores) {
    myScoresRef.current = next
    setMyScores(next)
    saveMyScores(finals.year, next)
  }
  function changeMyScore(key: string, raw: string) {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 3)
    const next = { ...myScoresRef.current }
    // 空文字=未入力。0点をつけた状態とは区別する
    if (digits === '') delete next[key]
    else next[key] = clampMyScore(Number(digits))
    commitMyScores(next)
  }
  function clearMyScores() {
    if (!window.confirm('あなたがつけた点数をすべて消します。よろしいですか?')) return
    commitMyScores({})
  }
  function onMyScoreKeyDown(e: ReactKeyboardEvent<HTMLInputElement>, key: string, rowIndex: number) {
    // ↑↓で1点ずつ増減(type=text にしてスピナーを捨てた代わり)。未入力なら90点から始める
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const cur = myScoresRef.current[key]
      const nextVal =
        typeof cur === 'number'
          ? clampMyScore(cur + (e.key === 'ArrowUp' ? 1 : -1))
          : MY_SCORE_DEFAULT
      commitMyScores({ ...myScoresRef.current, [key]: nextVal })
      return
    }
    // Enterで次の組へ。合計順の表示は入力のたびに変わるので出番順で送る
    if (e.key === 'Enter') {
      e.preventDefault()
      const pos = entryOrder.indexOf(rowIndex)
      const nextIdx = pos >= 0 ? entryOrder[pos + 1] : undefined
      const nextInput = nextIdx != null ? inputsRef.current[nextIdx] : null
      if (nextInput) {
        nextInput.focus()
        nextInput.select()
      } else {
        e.currentTarget.blur()
      }
      return
    }
    // Escでそのセルを取り消す(controlled input ではブラウザ既定の「元に戻す」が効かないため)
    if (e.key === 'Escape') {
      e.preventDefault()
      const next = { ...myScoresRef.current }
      delete next[key]
      commitMyScores(next)
    }
  }
  // 3状態: 別列→desc / 同列desc→asc / 同列asc→クリア(既定へ)。出番順のみasc起点
  function clickSort(key: SortKey) {
    setSort((prev) => {
      const first: SortState['dir'] = key === 'order' ? 'asc' : 'desc'
      const second: SortState['dir'] = key === 'order' ? 'desc' : 'asc'
      if (!prev || prev.key !== key) return { key, dir: first }
      if (prev.dir === first) return { key, dir: second }
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
        <span className="finals-count finals-my-count">
          あなたの採点 {myFilledCount}/{rows.length}組
        </span>
        <button
          type="button"
          className="finals-clear"
          onClick={clearMyScores}
          disabled={myFilledCount === 0}
        >
          クリア
        </button>
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
              {hasOrder && (
                <th className="sortable" aria-sort={ariaSort('order')}>
                  <button type="button" className="th-sort" onClick={() => clickSort('order')} aria-label="出番順でソート">
                    出番
                    <span className="sort-arrow">{arrow('order')}</span>
                  </button>
                </th>
              )}
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
              <th className={`judge-th my-th ${youEnabled ? '' : 'excluded'}`} aria-sort={ariaSort('you')}>
                <label className="judge-check">
                  <input
                    type="checkbox"
                    checked={youEnabled}
                    onChange={() => setYouEnabled((v) => !v)}
                    aria-label="あなたの点数を集計に含める"
                  />
                </label>
                <button
                  type="button"
                  className="th-sort"
                  onClick={() => clickSort('you')}
                  aria-label="あなたの点数でソート"
                >
                  あなた
                  <span className="sort-arrow">{arrow('you')}</span>
                </button>
              </th>
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
              const key = rowKeyOf(row)
              const my = myList[i]
              return (
                <tr key={row.name} className={isFinalist(row) ? 'finalist' : undefined}>
                  <td className="no">{rankByIndex[i]}</td>
                  {hasOrder && <td className="no order">{row.order ?? ''}</td>}
                  <td>
                    {row.combiId != null ? <Link to={`/combi/${row.combiId}`}>{row.name}</Link> : row.name}
                    {row.finalAppearance != null && (
                      <span className="appearance-note">({row.finalAppearance}回目)</span>
                    )}
                    {row.revival && <span className="revival-chip">敗者復活</span>}
                  </td>
                  {judges.map((_, j) => {
                    const s = scores[j]
                    const cls = enabled[j] ? scoreClass(s) : 'excluded'
                    return (
                      <td key={j} className={`no score ${cls}`}>
                        {typeof s === 'number' ? (
                          <>
                            <span className="num">{s}</span>
                            {/* .num はbackground-clip:textで透明化するため順位は兄弟要素に置く */}
                            <span className="score-rank">({rankInJudge[j][i]})</span>
                          </>
                        ) : (
                          ''
                        )}
                      </td>
                    )
                  })}
                  <td
                    className={`no score my ${typeof my === 'number' ? '' : 'empty'} ${
                      youEnabled ? scoreClass(my) : 'excluded'
                    }`}
                  >
                    <input
                      ref={(el) => {
                        inputsRef.current[i] = el
                      }}
                      className="my-score-input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={3}
                      autoComplete="off"
                      placeholder="–"
                      value={typeof my === 'number' ? String(my) : ''}
                      onChange={(e) => changeMyScore(key, e.target.value)}
                      onKeyDown={(e) => onMyScoreKeyDown(e, key, i)}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label={`${row.name} にあなたがつける点数(0〜100)`}
                    />
                    {typeof my === 'number' && <span className="score-rank">({rankInMy[i]})</span>}
                  </td>
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
