import { useLayoutEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'

import AbsentAdvancers from '../components/AbsentAdvancers'
import BestChip from '../components/BestChip'
import CombiPhoto from '../components/CombiPhoto'
import { VideoLinks } from '../components/OfficialVideo'
import { useMeta, useOfficialVideos, usePopularity, useYear } from '../lib/api'
import { NARROW_QUERY } from '../lib/breakpoints'
import { formationInfo } from '../lib/eligibility'
import { OFFICIAL_CHANNEL_URL, combiVideos, playlistUrl } from '../lib/officialVideos'
import { RESULT_DISPLAY, ROUND_LABEL, ROUND_ORDER, formatHits, isPassing } from '../lib/rounds'
import { loadRow, saveRow } from '../lib/scrollMemory'
import type { OfficialPlaylist, ResultKey, RoundKey, YearEntry } from '../lib/types'

type ResultFilter = 'all' | 'pass' | 'fail'
type SortKey = 'no' | 'kana' | 'hits'


/** 行高の見積もり。狭幅は1行に収まる名前の実測値(長い名前は measureElement で実寸に直る) */
const estimateRow = () => (window.matchMedia(NARROW_QUERY).matches ? 63 : 48)

function YearStrip({ years, current }: { years: number[]; current: number }) {
  const { search } = useLocation()
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
          <Link
            key={item}
            to={{ pathname: `/years/${item}`, search }}
            className={item === current ? 'active' : ''}
          >
            {item}
          </Link>
        ),
      )}
    </div>
  )
}

/** 選択中の回戦の M-1公式YouTube(プレイリスト)。無い回戦は公式チャンネルへ */
function RoundVideos({
  playlists,
  channel,
  round,
  videoCount,
  isPast,
}: {
  playlists: OfficialPlaylist[] | null
  channel: string
  round: RoundKey
  videoCount: number
  isPast: boolean
}) {
  const ext = { target: '_blank', rel: 'noopener noreferrer' } as const
  return (
    <div className="round-videos">
      <span className="round-videos-head">
        <span className="yt-icon" aria-hidden />
        M-1公式YouTube
      </span>
      {playlists && playlists.length > 0 ? (
        <>
          {playlists.map((p) => (
            <a key={p.id} className="round-videos-pl" href={playlistUrl(p.id)} {...ext}>
              {p.title}
              <small>{p.count}本</small>
            </a>
          ))}
          {videoCount > 0 && (
            <span className="round-videos-note">
              一覧の <span className="yt-icon" aria-hidden /> から各コンビの動画へ({videoCount.toLocaleString('ja-JP')}組)
            </span>
          )}
        </>
      ) : (
        <>
          <a className="round-videos-pl" href={channel} {...ext}>
            公式チャンネル
          </a>
          {/* データ自体が無い(null)ときは「公開されていない」と断定しない */}
          {playlists && (
            <span className="round-videos-note">
              {ROUND_LABEL[round]}の動画は公開されていません
              {isPast && '(ネタ動画はシーズン終了後に非公開になります)'}
            </span>
          )}
        </>
      )}
    </div>
  )
}

export default function YearPage() {
  const { year: yearParam } = useParams()
  const year = Number(yearParam)
  const [params, setParams] = useSearchParams()
  const location = useLocation()

  const roundParam = (params.get('round') as RoundKey) || 'first'
  const resultFilter = (params.get('result') as ResultFilter) || 'all'
  const sort = (params.get('sort') as SortKey) || 'hits'

  const { data: meta } = useMeta()
  const { data: yearFile, isLoading, isError } = useYear(Number.isFinite(year) ? year : null)
  const { data: popularity } = usePopularity()
  const { data: official } = useOfficialVideos()

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    // 同じページ内の絞り込みなので、ScrollRestoration に先頭へ戻させない
    setParams(next, { replace: true, preventScrollReset: true })
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

  // 年切替で引き継いだ回戦がその年に存在しない場合は1回戦へフォールバック
  const round = !yearFile || (roundCounts.get(roundParam) ?? 0) > 0 ? roundParam : 'first'

  const rows = useMemo(() => {
    if (!yearFile) return []
    let list = yearFile.entries.filter((e) => e.results[round])
    if (resultFilter === 'pass') list = list.filter((e) => isPassing(e.results[round]))
    if (resultFilter === 'fail')
      list = list.filter((e) => e.results[round] === 'fail' || e.results[round] === 'fail_inferred')
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
  }, [yearFile, round, resultFilter, sort, popularity])

  // 「資格がありながら未エントリー」の判定用。その年エントリーした全組のID
  const enteredIds = useMemo(() => {
    const ids = new Set<number>()
    for (const e of yearFile?.entries ?? []) if (e.id != null) ids.add(e.id)
    return ids
  }, [yearFile])

  // この回戦で公式動画のある組数(回戦の案内に出す)
  const videoCount = useMemo(() => {
    if (!yearFile || !official) return 0
    return yearFile.entries.filter((e) => combiVideos(official, year, e.id, round).length > 0).length
  }, [yearFile, official, year, round])

  const parentRef = useRef<HTMLDivElement>(null)
  // 狭幅(index.css の max-width: 640px)は2段組みで、長い名前は折り返して行が伸びるため
  // 実寸を measureElement で測る。見積もりは1行に収まる名前の行高
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateRow,
    overscan: 12,
    // 戻る/進むで来たときは、離れたときに先頭に見えていた行から始める(scrollMemory.ts)。
    // 作り直した直後は上の行がどれも未実測で見積もり高さで並ぶので、行番号×見積もりがちょうどその行の位置になる
    initialOffset: () => (loadRow(location.key) ?? 0) * estimateRow(),
  })

  // ページを開いたまま別の年へ移って戻った場合(2026→2025→戻る)は作り直されないので、
  // 履歴エントリーが変わったときに覚えている行へ移す。最初の表示は initialOffset が済ませている。
  // 覚えが無いまま別の年へ移ったときは先頭から(ウィンドウも先頭へ戻るので揃える)。
  // 同じ年の絞り込み・並び替え(パスが同じ)は従来どおり位置に触らない
  const restored = useRef({ key: location.key, path: location.pathname })
  useLayoutEffect(() => {
    if (restored.current.key === location.key || rows.length === 0) return
    const pathChanged = restored.current.path !== location.pathname
    restored.current = { key: location.key, path: location.pathname }
    const row = loadRow(location.key)
    if (row != null && row < rows.length) virtualizer.scrollToIndex(row, { align: 'start' })
    else if (pathChanged) virtualizer.scrollToOffset(0)
  }, [location.key, location.pathname, rows.length, virtualizer])

  const rememberRow = (top: number) => {
    const item = virtualizer.getVirtualItemForOffset(top)
    if (item) saveRow(location.key, item.index)
  }

  if (isError) return <div className="error-box">{year}年のデータを読み込めませんでした。</div>
  if (isLoading || !yearFile) return <div className="loading">読み込み中…</div>

  const isArchive = yearFile.source === 'official-archive'
  const activeRounds = ROUND_ORDER.filter((rk) => (roundCounts.get(rk) ?? 0) > 0)
  const passCount = rows.filter((e) => isPassing(e.results[round])).length
  const yearVideos = official?.years[String(year)]

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
              <span className="label">
                {ROUND_LABEL[rk]}
                {(yearVideos?.playlists[rk]?.length ?? 0) > 0 && (
                  <>
                    <span className="yt-icon" title="M-1公式YouTubeに動画あり" aria-hidden />
                    <span className="sr-only">(公式動画あり)</span>
                  </>
                )}
              </span>
              <span className="count">
                {count.toLocaleString('ja-JP')}
                <small>組</small>
              </span>
            </button>
          )
        })}
      </div>

      {official !== undefined && (
        <RoundVideos
          playlists={official ? (yearVideos?.playlists[round] ?? []) : null}
          channel={official?.channel ?? OFFICIAL_CHANNEL_URL}
          round={round}
          videoCount={videoCount}
          isPast={meta ? year < meta.latestYear : false}
        />
      )}

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
        <select value={sort} onChange={(e) => setParam('sort', e.target.value)} aria-label="並び順">
          <option value="no">エントリーNo順</option>
          <option value="kana">五十音順</option>
          <option value="hits">注目度順 (YouTube再生数)</option>
        </select>
        {sort === 'hits' && (
          <p className="hit-note">
            注目度はコンビ名とメンバー名でYouTube検索した上位動画のうちコンビ名またはメンバー名を単語として含むものの再生数合計です(3回戦以上の出場経験があるコンビが対象)。データがないコンビは五十音順で後ろに並びます。
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
          <div
            className="board-scroll"
            ref={parentRef}
            onScroll={(ev) => rememberRow(ev.currentTarget.scrollTop)}
          >
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((v) => {
                const e = rows[v.index]
                const res = e.results[round] as ResultKey
                const disp = RESULT_DISPLAY[res]
                const hits = e.id != null ? popularity?.hits[String(e.id)]?.n : undefined
                const fi = formationInfo(year, e.formed)
                const chip = fi && (
                  <span
                    className={`formed-chip${fi.isLastYear ? ' lastyear' : ''}`}
                    title={fi.isLastYear ? 'ラストイヤー(出場資格の最終年)' : undefined}
                  >
                    {fi.isLastYear && '⚡'}
                    {fi.years}年目
                  </span>
                )
                return (
                  <div
                    key={v.key}
                    data-index={v.index}
                    ref={virtualizer.measureElement}
                    className="board-row"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${v.start}px)`,
                    }}
                  >
                    <span className={e.no != null ? 'no' : 'no none'}>{e.no != null ? e.no : '—'}</span>
                    {e.id != null ? (
                      <Link className="name" to={`/combi/${e.id}`}>
                        <span className="board-avatar">
                          <CombiPhoto photo={e.photo} alt="" className="board-avatar-img" />
                        </span>
                        <span className="name-text">{e.name}</span>
                        {chip}
                        <BestChip level={e.best} until={year} />
                      </Link>
                    ) : (
                      <span className="name">
                        <span className="board-avatar" />
                        <span className="name-text">{e.name}</span>
                        {chip}
                        <BestChip level={e.best} until={year} />
                      </span>
                    )}
                    <span className={`result ${res}`}>
                      <span className="sym" aria-hidden>
                        {disp.sym}
                      </span>
                      {disp.label || e.raw?.[round] || '不明'}
                      <VideoLinks links={combiVideos(official, year, e.id, round)} name={e.name} />
                    </span>
                    <span className="hits">{hits != null ? formatHits(hits) : ''}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
      <p className="legend">
        コンビ名の横の「最高」は、{year}年まで({year}年を含む)の最高戦績。後の年の成績は含みません。
      </p>

      <AbsentAdvancers year={year} enteredIds={enteredIds} isArchive={isArchive} />
    </>
  )
}
