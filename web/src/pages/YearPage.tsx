import { useMemo, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'

import { useMeta, usePopularity, useYear } from '../lib/api'
import { RESULT_DISPLAY, ROUND_LABEL, ROUND_ORDER, formatHits, isPassing } from '../lib/rounds'
import type { ResultKey, RoundKey, YearEntry } from '../lib/types'

type ResultFilter = 'all' | 'pass' | 'fail'
type SortKey = 'no' | 'kana' | 'hits'

function YearStrip({ years, current }: { years: number[]; current: number }) {
  const items: (number | 'gap')[] = []
  const sorted = [...years].sort((a, b) => b - a)
  sorted.forEach((y, i) => {
    if (i > 0 && sorted[i - 1] - y > 1) items.push('gap')
    items.push(y)
  })
  return (
    <div className="year-strip">
      {items.map((item, i) =>
        item === 'gap' ? (
          <span key={`gap-${i}`} className="gap">
            休止
          </span>
        ) : (
          <Link key={item} to={`/years/${item}`} className={item === current ? 'active' : ''}>
            {item}
          </Link>
        ),
      )}
    </div>
  )
}

export default function YearPage() {
  const { year: yearParam } = useParams()
  const year = Number(yearParam)
  const [params, setParams] = useSearchParams()

  const round = (params.get('round') as RoundKey) || 'first'
  const resultFilter = (params.get('result') as ResultFilter) || 'all'
  const sort = (params.get('sort') as SortKey) || 'no'
  const q = params.get('q') || ''

  const { data: meta } = useMeta()
  const { data: yearFile, isLoading, isError } = useYear(Number.isFinite(year) ? year : null)
  const { data: popularity } = usePopularity()

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const roundCounts = useMemo(() => {
    const counts = new Map<RoundKey, number>()
    if (!yearFile) return counts
    for (const e of yearFile.entries) {
      for (const rk of ROUND_ORDER) {
        if (e.results[rk]) counts.set(rk, (counts.get(rk) ?? 0) + 1)
      }
    }
    return counts
  }, [yearFile])

  const rows = useMemo(() => {
    if (!yearFile) return []
    let list = yearFile.entries.filter((e) => e.results[round])
    if (resultFilter === 'pass') list = list.filter((e) => isPassing(e.results[round]))
    if (resultFilter === 'fail')
      list = list.filter((e) => e.results[round] === 'fail' || e.results[round] === 'fail_inferred')
    if (q.trim()) {
      const needle = q.trim()
      list = list.filter((e) => e.name.includes(needle) || (e.kana ?? '').includes(needle))
    }
    const kanaCmp = (a: YearEntry, b: YearEntry) =>
      (a.kana || a.name).localeCompare(b.kana || b.name, 'ja')
    const sorted = [...list]
    if (sort === 'kana') {
      sorted.sort(kanaCmp)
    } else if (sort === 'hits') {
      const hitOf = (e: YearEntry) => (e.id != null ? popularity?.hits[String(e.id)]?.n : undefined)
      sorted.sort((a, b) => {
        const ha = hitOf(a)
        const hb = hitOf(b)
        if (ha != null && hb != null) return hb - ha
        if (ha != null) return -1
        if (hb != null) return 1
        return kanaCmp(a, b)
      })
    } else {
      sorted.sort(
        (a, b) => (a.no ?? Number.MAX_SAFE_INTEGER) - (b.no ?? Number.MAX_SAFE_INTEGER),
      )
    }
    return sorted
  }, [yearFile, round, resultFilter, q, sort, popularity])

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  })

  if (isError) return <div className="error-box">{year}年のデータを読み込めませんでした。</div>
  if (isLoading || !yearFile) return <div className="loading">読み込み中…</div>

  const isArchive = yearFile.source === 'official-archive'
  const activeRounds = ROUND_ORDER.filter((rk) => (roundCounts.get(rk) ?? 0) > 0)
  const passCount = rows.filter((e) => isPassing(e.results[round])).length

  return (
    <>
      {meta && <YearStrip years={meta.years} current={year} />}
      <h1 className="page-title">M-1グランプリ {year}</h1>
      <p className="page-lede">
        エントリー {yearFile.entries.length.toLocaleString('ja-JP')}組
        {isArchive && ' — 公式アーカイブ由来のため、1回戦で敗退したコンビは掲載がありません'}
      </p>

      <div className="funnel" role="tablist" aria-label="回戦">
        {activeRounds.map((rk) => {
          const count = roundCounts.get(rk) ?? 0
          return (
            <button
              key={rk}
              role="tab"
              aria-selected={round === rk}
              className={`funnel-step ${round === rk ? 'active' : ''}`}
              style={{ flex: `${Math.log10(Math.max(count, 1)) + 1} 1 0` }}
              onClick={() => setParam('round', rk)}
            >
              <span className="label">{ROUND_LABEL[rk]}</span>
              <span className="count">
                {count.toLocaleString('ja-JP')}
                <small>組</small>
              </span>
            </button>
          )
        })}
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="通過・敗退の絞り込み">
          {(
            [
              ['all', 'すべて'],
              ['pass', '通過'],
              ['fail', '敗退'],
            ] as [ResultFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={resultFilter === key ? 'active' : ''}
              onClick={() => setParam('result', key === 'all' ? '' : key)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="コンビ名で探す"
          value={q}
          onChange={(e) => setParam('q', e.target.value)}
          aria-label="コンビ名で探す"
        />
        <select value={sort} onChange={(e) => setParam('sort', e.target.value)} aria-label="並び順">
          <option value="no">エントリーNo順</option>
          <option value="kana">五十音順</option>
          <option value="hits">注目度順 (YouTube再生数)</option>
        </select>
        {sort === 'hits' && (
          <p className="hit-note">
            注目度はコンビ名でYouTube検索した上位動画の再生数合計です(準々決勝以上の進出経験があるコンビが対象)。データがないコンビは五十音順で後ろに並びます。
          </p>
        )}
      </div>

      <div className="board">
        <div className="board-head">
          <span>NO.</span>
          <span>コンビ名</span>
          <span>
            {ROUND_LABEL[round]}
            {resultFilter === 'all' && ` (通過 ${passCount.toLocaleString('ja-JP')})`}
          </span>
          <span className="hits">注目度</span>
        </div>
        {rows.length === 0 ? (
          <div className="board-empty">該当するコンビがいません</div>
        ) : (
          <div className="board-scroll" ref={parentRef}>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((v) => {
                const e = rows[v.index]
                const res = e.results[round] as ResultKey
                const disp = RESULT_DISPLAY[res]
                const hits = e.id != null ? popularity?.hits[String(e.id)]?.n : undefined
                return (
                  <div
                    key={v.key}
                    className="board-row"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${v.start}px)`,
                    }}
                  >
                    <span className="no">{e.no != null ? e.no : '—'}</span>
                    {e.id != null ? (
                      <Link className="name" to={`/combi/${e.id}`}>
                        {e.name}
                      </Link>
                    ) : (
                      <span className="name">{e.name}</span>
                    )}
                    <span className={`result ${res}`}>
                      <span className="sym" aria-hidden>
                        {disp.sym}
                      </span>
                      {disp.label || e.raw?.[round] || '不明'}
                    </span>
                    <span className="hits">{hits != null ? formatHits(hits) : ''}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
