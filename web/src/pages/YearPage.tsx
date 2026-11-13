import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

import AbsentAdvancers from '../components/AbsentAdvancers'
import BestChip from '../components/BestChip'
import CombiLink from '../components/CombiLink'
import CombiPhoto from '../components/CombiPhoto'
import FormedChip from '../components/FormedChip'
import { VideoLinks } from '../components/OfficialVideo'
import { ErrorState, Loading, NotFound } from '../components/PageState'
import ScrollNav, { type ScrollNavItem } from '../components/ScrollNav'
import Segmented from '../components/Segmented'
import { useAbsentRows } from '../lib/absentRows'
import { useMeta, useOfficialVideos, usePopularity, useYear } from '../lib/api'
import { NARROW_QUERY } from '../lib/breakpoints'
import { m1LimitYears } from '../lib/eligibility'
import { OFFICIAL_CHANNEL_URL, combiVideos, playlistUrl } from '../lib/officialVideos'
import { parseYear } from '../lib/params'
import { RESULT_DISPLAY, ROUND_LABEL, ROUND_ORDER, formatHits, isPassing } from '../lib/rounds'
import { clearRow, loadRow, saveRow } from '../lib/scrollMemory'
import type { OfficialPlaylist, OfficialVideos, Popularity, ResultKey, RoundKey, YearEntry } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useUrlParam } from '../lib/useUrlParam'

const RESULT_FILTERS = ['all', 'pass', 'fail'] as const
const SORTS = ['hits', 'no', 'kana'] as const
type ResultFilter = (typeof RESULT_FILTERS)[number]
type SortKey = (typeof SORTS)[number]
/** 回戦の代わりに「資格がありながら未エントリー」の表を出す表示(?round=absent) */
const ABSENT = 'absent'

const SORT_LABEL: Record<SortKey, string> = {
  hits: '注目度順',
  no: 'エントリーNo.順',
  kana: '五十音順',
}

/** 行の高さ。広い画面は CSS で 56px に固定、狭い画面は名前の折り返しで変わるので実測する(見積もりは1行の名前) */
const estimateRow = () => (window.matchMedia(NARROW_QUERY).matches ? 64 : 56)
/** 一覧の上に貼り付く帯(回戦・件数・列見出し)の高さの初期値。実際の高さは描画後に測って使う
 *  (広い画面は列見出しがあるので 64px 前後、狭い画面は 48px 前後。決め打ちだと戻した行が帯の下にもぐる) */
const STATUS_BAR = 48

/** その年の一覧で使う URL のクエリを作る。検索パネル(q/tab/qsort)と focus は持ち越さない */
function searchFor(params: URLSearchParams, changes: Record<string, string | null>) {
  const p = new URLSearchParams(params)
  for (const k of ['q', 'tab', 'qsort', 'focus']) p.delete(k)
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) p.delete(k)
    else p.set(k, v)
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** 選択中の回戦の M-1公式YouTube(プレイリスト)。無い回戦は公式チャンネルへ。1行に収めて横にスクロール */
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
  const has = playlists !== null && playlists.length > 0
  let note = ''
  if (has && videoCount > 0) note = `一覧の ▶ から各コンビの動画へ(${videoCount.toLocaleString('ja-JP')}組)`
  // データ自体が無い(null)ときは「公開されていない」と断定しない
  if (!has && playlists) {
    note = `${ROUND_LABEL[round]}の動画は公開されていません${isPast ? '(ネタ動画はシーズン後に非公開になります)' : ''}`
  }
  return (
    <div className="round-videos">
      <span className="round-videos-head">
        <span className="yt-icon" aria-hidden />
        公式YouTube
      </span>
      <ul className="round-videos-list">
        {has ? (
          playlists.map((p) => (
            <li key={p.id}>
              <a className="round-videos-pl" href={playlistUrl(p.id)} {...ext}>
                {p.title}
                <small>{p.count}本</small>
              </a>
            </li>
          ))
        ) : (
          <li>
            <a className="round-videos-pl" href={channel} {...ext}>
              公式チャンネル
            </a>
          </li>
        )}
        {note && <li className="round-videos-note">{note}</li>}
      </ul>
    </div>
  )
}

/** 一覧の1行の中身。広い画面は 番号・写真・名前・結果・注目度 の1段、狭い画面は 名前 / 番号・注目度 の2段 */
function Row({
  e,
  year,
  round,
  hits,
  official,
  focused,
}: {
  e: YearEntry
  year: number
  round: RoundKey
  hits: number | undefined
  official: OfficialVideos | null | undefined
  focused: boolean
}) {
  const res = e.results[round] as ResultKey
  const disp = RESULT_DISPLAY[res]
  return (
    <>
      <span className="yr-photo" aria-hidden="true">
        <CombiPhoto photo={e.photo} alt="" className="yr-photo-img" />
      </span>
      <span className="yr-name">
        <CombiLink id={e.id} className="yr-link">
          {e.name}
        </CombiLink>
        <FormedChip year={year} formed={e.formed} />
        <BestChip level={e.best} until={year} />
        {focused && <span className="chip chip-focus">コンビ詳細から</span>}
      </span>
      <span className="yr-meta">
        <span className="yr-no">{e.no != null ? `No.${e.no}` : ''}</span>
        <span className="yr-hits">{hits != null ? formatHits(hits) : ''}</span>
      </span>
      <span className={`yr-result result-${res}`}>
        <span aria-hidden="true">{disp.sym}</span> {disp.label || e.raw?.[round] || '不明'}
        <VideoLinks links={combiVideos(official, year, e.id, round)} name={e.name} />
      </span>
    </>
  )
}

/**
 * 年度一覧の本体。ページ全体のスクロールに合わせて、見えている行だけを描く(1万件超でも軽い)。
 * 以前は高さ 62dvh の箱の中でスクロールさせていたが、スマホで指が箱に閉じ込められるのでやめた(Baymard)。
 *
 * 戻ったときの位置: ウィンドウのピクセル位置は ScrollRestoration が先に戻す。見えていない行は見積もりの高さで
 * 並ぶのでピクセルだとずれるため、ここで「離れたときに先頭に見えていた行」へ合わせ直す(lib/scrollMemory.ts)。
 * App.tsx で ScrollRestoration を <main> より前に置いているので、この副作用の方が後に走って勝つ。
 */
function YearBoard({
  rows,
  year,
  round,
  popularity,
  official,
  focusId,
  ready,
  signature,
  headRef,
  status,
}: {
  rows: YearEntry[]
  year: number
  round: RoundKey
  popularity: Popularity | null | undefined
  official: OfficialVideos | null | undefined
  focusId: number | null
  /** 並び順が確定したか(注目度順は注目度データが届くまで並びが変わる) */
  ready: boolean
  /** 回戦・絞り込み・並び順。変わったら一覧の先頭を見せる */
  signature: string
  /** 一覧より上の部分。高さが変わったら一覧の開始位置(scrollMargin)を測り直す */
  headRef: RefObject<HTMLDivElement | null>
  status: ReactNode
}) {
  const location = useLocation()
  const listRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  // 一覧の上端の、文書の先頭からの位置。仮想リストはこれを基準に行を並べる
  const [margin, setMargin] = useState(0)
  // 貼り付く帯の実際の高さ。行で位置を戻すとき、行がこの帯のすぐ下に来るようにする
  const [statusH, setStatusH] = useState(STATUS_BAR)
  // 0件 → 1件以上になると一覧の要素ができるので、その時に測り直す
  const empty = rows.length === 0

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = () => {
      setMargin(Math.round(el.getBoundingClientRect().top + window.scrollY))
      if (statusRef.current) setStatusH(statusRef.current.offsetHeight)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (headRef.current) ro.observe(headRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [headRef, empty])

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: estimateRow,
    overscan: 12,
    scrollMargin: margin,
    scrollPaddingStart: statusH,
    getItemKey: (i) => rows[i].id ?? `${rows[i].name}-${rows[i].no}`,
  })

  // 先頭に見えている行を覚える(帯の下に来ている行)。一覧より上に居るときは覚えない
  const key = location.key
  useLayoutEffect(() => {
    if (margin === 0) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // 別のページへ移った後のスクロール(先頭へ戻す等)を、このページの位置として覚えないため
        if (window.history.state?.key !== key) return
        const below = statusRef.current?.getBoundingClientRect().bottom ?? statusH
        const offset = window.scrollY + Math.max(below, 0)
        if (offset <= margin) {
          clearRow(key)
          return
        }
        const item = virtualizer.getVirtualItemForOffset(offset)
        if (item) saveRow(key, item.index)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [key, margin, statusH, virtualizer])

  // 戻ってきたとき(または ?focus= でコンビ詳細から来たとき)に、行で位置を合わせる。履歴エントリーごとに1回だけ
  const restored = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!ready || margin === 0 || rows.length === 0 || restored.current === key) return
    restored.current = key
    const row = loadRow(key)
    if (row != null && row < rows.length) {
      virtualizer.scrollToIndex(row, { align: 'start' })
      return
    }
    if (focusId != null) {
      const i = rows.findIndex((r) => r.id === focusId)
      if (i >= 0) virtualizer.scrollToIndex(i, { align: 'center' })
    }
  }, [ready, margin, rows, key, focusId, virtualizer])

  // 回戦・絞り込み・並び順を変えたら、一覧の途中に居る場合だけ一覧の先頭へ戻す(上の方に居るなら動かさない)
  const lastSignature = useRef(signature)
  useLayoutEffect(() => {
    if (lastSignature.current === signature) return
    lastSignature.current = signature
    if (margin > 0 && window.scrollY + statusH > margin) {
      window.scrollTo({ top: margin - statusH })
    }
  }, [signature, margin, statusH])

  return (
    <>
      <div className="year-status" ref={statusRef}>
        {status}
        <div className="year-cols" aria-hidden="true">
          <span>No.</span>
          <span>コンビ</span>
          <span>結果</span>
          <span>注目度</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="page-state">該当するコンビがいません</p>
      ) : (
        <div
          ref={listRef}
          className="year-list"
          role="list"
          aria-label={`${year}年 ${ROUND_LABEL[round]}の一覧`}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((v) => {
            const e = rows[v.index]
            const focused = focusId != null && e.id === focusId
            return (
              <div
                key={v.key}
                role="listitem"
                aria-setsize={rows.length}
                aria-posinset={v.index + 1}
                aria-current={focused ? 'true' : undefined}
                data-index={v.index}
                ref={virtualizer.measureElement}
                className={`year-row${focused ? ' is-focus' : ''}`}
                style={{ transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
              >
                <Row
                  e={e}
                  year={year}
                  round={round}
                  hits={e.id != null ? popularity?.hits[String(e.id)]?.n : undefined}
                  official={official}
                  focused={focused}
                />
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export default function YearPage() {
  const { year: yearParam } = useParams()
  const parsedYear = parseYear(yearParam)
  const year = parsedYear ?? 0
  const [params] = useSearchParams()

  const { data: meta } = useMeta()
  // 大会の無い年(2011〜2014 や未来の年)は取りに行かない
  const known = parsedYear !== null && (!meta || meta.years.includes(parsedYear))
  const { data: yearFile, isLoading, isError } = useYear(known ? parsedYear : null)
  const { data: popularity } = usePopularity()
  const { data: official } = useOfficialVideos()

  const [resultFilter, setResultFilter] = useUrlParam<ResultFilter>('result', 'all', RESULT_FILTERS)
  const [sort, setSort] = useUrlParam<SortKey>('sort', 'hits', SORTS)
  const roundParam = params.get('round') ?? 'first'
  const focusId = Number(params.get('focus')) || null
  const headRef = useRef<HTMLDivElement>(null)

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

  const showAbsent = roundParam === ABSENT
  // 年を移って、引き継いだ回戦がその年に無ければ1回戦を出す(URL はそのまま)
  const round: RoundKey =
    !showAbsent &&
    (ROUND_ORDER as string[]).includes(roundParam) &&
    (roundCounts.get(roundParam as RoundKey) ?? 0) > 0
      ? (roundParam as RoundKey)
      : 'first'
  useDocumentTitle(
    yearFile
      ? `M-1グランプリ${year} ${showAbsent ? '資格がありながら未エントリーの組' : `${ROUND_LABEL[round]}の結果`}`
      : null,
  )

  const rows = useMemo(() => {
    if (!yearFile) return []
    let list = yearFile.entries.filter((e) => e.results[round])
    if (resultFilter === 'pass') list = list.filter((e) => isPassing(e.results[round]))
    if (resultFilter === 'fail')
      list = list.filter((e) => e.results[round] === 'fail' || e.results[round] === 'fail_inferred')
    const kanaCmp = (a: YearEntry, b: YearEntry) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja')
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
      sorted.sort((a, b) => (a.no ?? Number.MAX_SAFE_INTEGER) - (b.no ?? Number.MAX_SAFE_INTEGER))
    }
    return sorted
  }, [yearFile, round, resultFilter, sort, popularity])

  // 「資格がありながら未エントリー」の判定用。その年エントリーした全組のID
  const enteredIds = useMemo(() => {
    const ids = new Set<number>()
    for (const e of yearFile?.entries ?? []) if (e.id != null) ids.add(e.id)
    return ids
  }, [yearFile])
  const absentRows = useAbsentRows(year, enteredIds)

  // この回戦で公式動画のある組数(回戦の案内に出す)
  const videoCount = useMemo(() => {
    if (!yearFile || !official) return 0
    return yearFile.entries.filter((e) => combiVideos(official, year, e.id, round).length > 0).length
  }, [yearFile, official, year, round])

  // 戻るボタンの位置を正しくするため、注目度順は注目度データが届いてから並びを確定とみなす
  const ready = sort !== 'hits' || popularity !== undefined

  // 年の並び。年を移っても回戦・絞り込み・並び順は引き継ぐ(その年に無い回戦なら1回戦を出す)
  const yearItems = useMemo<ScrollNavItem[]>(() => {
    if (!meta) return []
    const sorted = [...meta.years].sort((a, b) => b - a)
    const items: ScrollNavItem[] = []
    sorted.forEach((y, i) => {
      if (i > 0 && sorted[i - 1] - y > 1) items.push({ key: `gap-${y}`, separator: '休止' })
      items.push({
        key: String(y),
        to: { pathname: `/years/${y}`, search: searchFor(params, {}) },
        label: y,
        current: y === year,
      })
    })
    return items
  }, [meta, params, year])

  if (parsedYear === null || (meta && !known)) {
    const hiatus = parsedYear !== null && parsedYear >= 2011 && parsedYear <= 2014
    return (
      <NotFound title={parsedYear ? `${parsedYear}年の大会はありません` : 'ページが見つかりません'}>
        <p>
          {hiatus
            ? 'M-1グランプリは2011〜2014年に開かれていません(2010年で一度終了し、2015年に再開)。'
            : 'この年の記録はありません。'}
        </p>
      </NotFound>
    )
  }
  if (isError) return <ErrorState message={`${year}年のデータを読み込めませんでした。`} />
  if (isLoading || !yearFile) return <Loading />

  const isArchive = yearFile.source === 'official-archive'
  const activeRounds = ROUND_ORDER.filter((rk) => (roundCounts.get(rk) ?? 0) > 0)
  const passCount = rows.filter((e) => isPassing(e.results[round])).length
  const yearVideos = official?.years[String(year)]
  const total = roundCounts.get(round) ?? 0

  const roundItems: ScrollNavItem[] = activeRounds.map((rk) => {
    const count = roundCounts.get(rk) ?? 0
    const hasVideo = (yearVideos?.playlists[rk]?.length ?? 0) > 0
    return {
      key: rk,
      to: { search: searchFor(params, { round: rk === 'first' ? null : rk }) },
      inPage: true,
      current: !showAbsent && rk === round,
      ariaLabel: `${ROUND_LABEL[rk]} ${count.toLocaleString('ja-JP')}組${hasVideo ? '(公式動画あり)' : ''}`,
      label: (
        <>
          <span className="step-label">
            {ROUND_LABEL[rk]}
            {hasVideo && <span className="yt-icon" aria-hidden />}
          </span>
          <span className="step-count">{count.toLocaleString('ja-JP')}</span>
        </>
      ),
    }
  })
  if (absentRows.length > 0) {
    roundItems.push({ key: 'sep', separator: '' })
    roundItems.push({
      key: ABSENT,
      to: { search: searchFor(params, { round: ABSENT, result: null }) },
      inPage: true,
      current: showAbsent,
      ariaLabel: `資格がありながら未エントリー ${absentRows.length}組`,
      label: (
        <>
          <span className="step-label">未エントリー</span>
          <span className="step-count">{absentRows.length}</span>
        </>
      ),
    })
  }

  return (
    <div className="year-page">
      <div ref={headRef} className="year-head">
        <div className="year-title">
          <h1 className="page-title">M-1グランプリ {year}</h1>
          <p className="year-entries">
            エントリー {yearFile.entries.length.toLocaleString('ja-JP')}組
            {isArchive && '(公式アーカイブ由来のため、1回戦で敗退した組は載っていません)'}
          </p>
          {meta?.finalsYears.includes(year) && (
            <Link className="year-finals-link" to={`/finals/${year}`}>
              決勝の得点表
            </Link>
          )}
        </div>
        <ScrollNav label="年" variant="pills" items={yearItems} />
        <ScrollNav label="回戦" variant="steps" items={roundItems} />

        {!showAbsent && (
          <>
            <div className="year-toolbar">
              <Segmented
                label="結果で絞り込む"
                options={[
                  { value: 'all', label: 'すべて' },
                  { value: 'pass', label: '通過' },
                  { value: 'fail', label: '敗退' },
                ]}
                value={resultFilter}
                onChange={setResultFilter}
              />
              <label className="select">
                <span className="sr-only">並び順</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {SORTS.map((s) => (
                    <option key={s} value={s}>
                      {SORT_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
              <details className="note">
                <summary>
                  <span className="note-label">注目度とは</span>
                </summary>
                <p>
                  コンビ名とメンバー名で YouTube
                  を検索した上位動画のうち、コンビ名またはメンバー名を単語として含むものの再生数の合計です。3回戦以上に出たことのあるコンビが対象で、データが無いコンビは五十音順で後ろに並びます。
                </p>
              </details>
            </div>
            {/* 動画データの到着前から高さを確保して、一覧の位置がずれないようにする */}
            <div className="round-videos-slot">
              {official !== undefined && (
                <RoundVideos
                  playlists={official ? (yearVideos?.playlists[round] ?? []) : null}
                  channel={official?.channel ?? OFFICIAL_CHANNEL_URL}
                  round={round}
                  videoCount={videoCount}
                  isPast={meta ? year < meta.latestYear : false}
                />
              )}
            </div>
          </>
        )}
      </div>

      {showAbsent ? (
        <AbsentAdvancers year={year} rows={absentRows} isArchive={isArchive} />
      ) : (
        <>
          <YearBoard
            key={year}
            rows={rows}
            year={year}
            round={round}
            popularity={popularity}
            official={official}
            focusId={focusId}
            ready={ready}
            signature={`${round}|${resultFilter}|${sort}`}
            headRef={headRef}
            status={
              <p className="year-status-text">
                <strong>{ROUND_LABEL[round]}</strong>
                <span>
                  {resultFilter === 'all'
                    ? `${total.toLocaleString('ja-JP')}組(通過 ${passCount.toLocaleString('ja-JP')})`
                    : `${resultFilter === 'pass' ? '通過' : '敗退'} ${rows.length.toLocaleString('ja-JP')}組`}
                </span>
                <span className="year-status-sort">{SORT_LABEL[sort]}</span>
              </p>
            }
          />
          <p className="legend">
            「最高」は{year}年まで({year}年を含む)の最高戦績で、後の年の成績は含みません。「ラストイヤー」は出場資格(結成
            {m1LimitYears(year)}年以内)の最後の年です。
          </p>
        </>
      )}
    </div>
  )
}
