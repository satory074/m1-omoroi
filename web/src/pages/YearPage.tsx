import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

import AbsentAdvancers from '../components/AbsentAdvancers'
import BestChip from '../components/BestChip'
import CombiLink from '../components/CombiLink'
import CombiPhoto from '../components/CombiPhoto'
import FormedChip from '../components/FormedChip'
import LikeButton, { HeartIcon } from '../components/LikeButton'
import { VideoLinks } from '../components/OfficialVideo'
import { ErrorState, Loading, NotFound } from '../components/PageState'
import RoundSchedule from '../components/RoundSchedule'
import ScrollNav, { type ScrollNavItem } from '../components/ScrollNav'
import Segmented from '../components/Segmented'
import YearSummary from '../components/YearSummary'
import { useAbsentRows } from '../lib/absentRows'
import {
  useMeta,
  useOfficialVideos,
  usePopularity,
  useSchedule,
  useScheduleRound,
  useTverLikes,
  useYear,
  useYearSummary,
} from '../lib/api'
import { NARROW_QUERY } from '../lib/breakpoints'
import { m1LimitYears } from '../lib/eligibility'
import { useLikes } from '../lib/likes'
import { likeKey } from '../lib/likesCodec'
import { OFFICIAL_CHANNEL_URL, combiVideos, playlistUrl } from '../lib/officialVideos'
import { parseYear } from '../lib/params'
import { RESULT_DISPLAY, ROUND_LABEL, ROUND_ORDER, formatHits, isPassing } from '../lib/rounds'
import {
  SCHEDULE_PAGE_URL,
  type Slot,
  type SlotIndex,
  buildSlots,
  formatDay,
  nextVenue,
  roundDateLabel,
  roundVenues,
  slotFor,
  slotLabel,
  todayJst,
} from '../lib/schedule'
import { clearRow, loadRow, saveRow } from '../lib/scrollMemory'
import {
  WILDCARD_URL,
  formatTverAt,
  hasTverFor,
  tverClosed,
  tverEpisodeUrl,
  tverGrowthLabel,
  tverItem,
} from '../lib/tver'
import type {
  OfficialPlaylist,
  OfficialVideos,
  Popularity,
  ResultKey,
  RoundKey,
  ScheduleVenue,
  TverItem,
  TverLikes,
  YearEntry,
} from '../lib/types'
import { yearTitle } from '../lib/seo'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useUrlParam } from '../lib/useUrlParam'
import { finalsPath, yearPath } from '../lib/paths'

const RESULT_FILTERS = ['all', 'pass', 'fail'] as const
const SORTS = ['hits', 'no', 'kana', 'order', 'tver'] as const
const LIKED = ['0', '1'] as const
type ResultFilter = (typeof RESULT_FILTERS)[number]
type SortKey = (typeof SORTS)[number]
/** 回戦の代わりに「資格がありながら未エントリー」の表を出す表示(?round=absent) */
const ABSENT = 'absent'

const SORT_LABEL: Record<SortKey, string> = {
  hits: '注目度順',
  no: 'エントリーNo.順',
  kana: '五十音順',
  order: '出番順',
  tver: 'TVer いいね順',
}

/** 日程の会場の行(開演・MC)を出すのは会場がこの数までの回戦。1回戦(74会場)・2回戦(15会場)は
 *  行を並べると一覧がずっと下へ押し出されるので、会場のプルダウンだけにする */
const SCHEDULE_ROWS_MAX = 9

/** 会場のプルダウン。日付ごとに区切り、今日の会場には「今日」と付ける */
function VenueSelect({
  venues,
  value,
  today,
  onChange,
}: {
  venues: ScheduleVenue[]
  value: string | null
  today: string
  onChange: (venueId: string | null) => void
}) {
  const days: { date: string; venues: ScheduleVenue[] }[] = []
  for (const v of venues) {
    const last = days[days.length - 1]
    if (last && last.date === v.date) last.venues.push(v)
    else days.push({ date: v.date, venues: [v] })
  }
  return (
    <label className="select venue-select">
      <span className="sr-only">会場で絞り込む</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">すべての会場</option>
        {days.map((d) => (
          <optgroup key={d.date} label={`${formatDay(d.venues[0])}${d.date === today ? ' 今日' : ''}`}>
            {d.venues.map((v) => (
              <option key={v.id} value={v.id}>
                {/* 同じ会場で昼と夜の2回ある日(3回戦の大阪など)は時刻でしか見分けられないので、狭い画面で切れない前の方に置く */}
                {formatDay(v)}
                {v.start ? ` ${v.start}` : ''} {v.area ? `${v.area} ` : ''}
                {v.place ?? '会場は調整中'}({v.entrants.toLocaleString('ja-JP')}組)
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
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
  tver,
  showTver,
  closed,
  official,
  slot,
  focused,
}: {
  e: YearEntry
  year: number
  round: RoundKey
  hits: number | undefined
  /** TVer のいいね数(その年・その回戦の動画がある組だけ) */
  tver: TverItem | undefined
  /** 数字の列を注目度の代わりに TVer のいいね数にする(TVer いいね順のとき) */
  showTver: boolean
  /** 投票の締切後(伸びを出さない) */
  closed: boolean
  official: OfficialVideos | null | undefined
  /** その回戦の出番(公式日程に載っている組だけ) */
  slot: Slot | null
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
        {slot && (
          <span className="chip chip-venue">
            <span className="sr-only">出番 </span>
            {slotLabel(slot)}
          </span>
        )}
        {focused && <span className="chip chip-focus">この組</span>}
      </span>
      <span className="yr-meta">
        <span className="yr-no">{e.no != null ? `No.${e.no}` : ''}</span>
        {showTver ? (
          <span className="yr-hits yr-tver">
            {tver && (
              <>
                {tver.n.toLocaleString('ja-JP')}
                {!closed && tverGrowthLabel(tver) && (
                  <span className="yr-tver-d">
                    <span className="sr-only">24時間で</span>
                    {tverGrowthLabel(tver)}
                  </span>
                )}
              </>
            )}
          </span>
        ) : (
          <span className="yr-hits">{hits != null ? formatHits(hits) : ''}</span>
        )}
      </span>
      <span className={`yr-result result-${res}`}>
        <span aria-hidden="true">{disp.sym}</span> {disp.label || e.raw?.[round] || '不明'}
        <VideoLinks links={combiVideos(official, year, e.id, round)} name={e.name} />
        {tver && (
          <a
            className="tver-link"
            href={tverEpisodeUrl(tver.ep)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${e.name}の${ROUND_LABEL[round]}の動画を TVer で開く`}
          >
            TVer
          </a>
        )}
      </span>
      <span className="yr-like">
        {/* いいねはコンビIDで覚えるので、IDの紐付かないアーカイブの行(2001〜2010の一部)には付けない */}
        {e.id != null && (
          <LikeButton
            likeKey={likeKey(year, round, e.id)}
            label={`${e.name}(${year}年 ${ROUND_LABEL[round]})をいいね`}
          />
        )}
      </span>
    </>
  )
}

/** TVer いいね順のときの注記。数字が審査の票数ではないこと・出典・時点を一覧の上に出す */
function TverNote({ tver }: { tver: TverLikes }) {
  const closed = tverClosed(tver)
  // 取り始めて24時間は伸びが無いので、無いうちは「小さい数字」の説明を出さない
  const growth = !closed && Object.values(tver.items).some((it) => it.d != null)
  return (
    <p className="tver-note">
      {closed
        ? `TVer のいいね数(締切後 ${formatTverAt(tver.at)} に取得した最終値)。`
        : `TVer のいいね数(${formatTverAt(tver.at)} 時点。投票期間中は1時間ごとに更新${growth ? '、小さい数字は24時間の伸び' : ''})。`}
      ワイルドカードは M-1 の LINE の投票で決まり、<strong>この数は投票数ではありません</strong>。出典:{' '}
      {tver.series ? (
        <a href={tver.series} target="_blank" rel="noopener noreferrer">
          TVer
        </a>
      ) : (
        'TVer'
      )}
      ・
      <a href={WILDCARD_URL} target="_blank" rel="noopener noreferrer">
        ワイルドカード(公式)
      </a>
    </p>
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
  tver,
  showTver,
  official,
  slots,
  venueId,
  focusId,
  ready,
  signature,
  headRef,
  status,
  emptyText,
}: {
  rows: YearEntry[]
  year: number
  round: RoundKey
  popularity: Popularity | null | undefined
  /** その年・その回戦の TVer のいいね数(無ければ null) */
  tver: TverLikes | null
  /** 数字の列を TVer のいいね数にする */
  showTver: boolean
  official: OfficialVideos | null | undefined
  /** その回戦の出番(今シーズンだけ) */
  slots: SlotIndex
  /** 会場で絞っているときの会場ID */
  venueId: string | null
  focusId: number | null
  /** 並び順が確定したか(注目度順は注目度データが届くまで並びが変わる) */
  ready: boolean
  /** 回戦・絞り込み・並び順。変わったら一覧の先頭を見せる */
  signature: string
  /** 一覧より上の部分。高さが変わったら一覧の開始位置(scrollMargin)を測り直す */
  headRef: RefObject<HTMLDivElement | null>
  status: ReactNode
  emptyText: string
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

  const closed = tver ? tverClosed(tver) : false

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
          <span>{showTver ? 'TVer いいね' : '注目度'}</span>
          <span>いいね</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="page-state">{emptyText}</p>
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
                  tver={tverItem(tver, e.id)}
                  showTver={showTver}
                  closed={closed}
                  official={official}
                  slot={slotFor(slots, e.id, venueId)}
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
  const [params, setParams] = useSearchParams()

  const { data: meta } = useMeta()
  // 大会の無い年(2011〜2014 や未来の年)は取りに行かない
  const known = parsedYear !== null && (!meta || meta.years.includes(parsedYear))
  const { data: yearFile, isLoading, isError } = useYear(known ? parsedYear : null)
  const { data: summary } = useYearSummary(known ? parsedYear : null)
  const { data: popularity } = usePopularity()
  const { data: official } = useOfficialVideos()
  const { data: tverLikes } = useTverLikes()
  // 公式日程(準々決勝以降)。持っているのはシーズン中の1年分だけ(schedule.year)
  const { data: schedule, isPending: schedulePending } = useSchedule()
  const likes = useLikes()
  const today = todayJst()

  const [resultFilter, setResultFilter] = useUrlParam<ResultFilter>('result', 'all', RESULT_FILTERS)
  const [sort, setSort] = useUrlParam<SortKey>('sort', 'hits', SORTS)
  const [liked, setLiked] = useUrlParam<(typeof LIKED)[number]>('liked', '0', LIKED)
  const venueParam = params.get('venue')
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
  // 日程はあるが出場者がまだ居ない回戦(準決勝・決勝など)。ナビに日付で並べ、押すと日程だけを出す
  const scheduleOnly = (rk: RoundKey) =>
    (roundCounts.get(rk) ?? 0) === 0 && roundVenues(schedule, year, rk).length > 0
  // 年を移って、引き継いだ回戦がその年に無ければ1回戦を出す(URL はそのまま)
  const round: RoundKey =
    !showAbsent &&
    (ROUND_ORDER as string[]).includes(roundParam) &&
    ((roundCounts.get(roundParam as RoundKey) ?? 0) > 0 || scheduleOnly(roundParam as RoundKey))
      ? (roundParam as RoundKey)
      : 'first'
  const upcoming = !showAbsent && scheduleOnly(round)
  const venues = useMemo(
    () => (showAbsent ? [] : roundVenues(schedule, year, round)),
    [showAbsent, schedule, year, round],
  )
  const next = nextVenue(schedule, year, today)
  // 出番(会場ごとの公式の並び)。日程のある今シーズンの、出場者の載った回戦だけ取りに行く
  const wantSlots = !showAbsent && !upcoming && venues.some((v) => v.entrants > 0)
  const { data: roundFile, isPending: slotsPending } = useScheduleRound(wantSlots ? round : null)
  const slots = useMemo(() => buildSlots(venues, wantSlots ? roundFile : null), [venues, roundFile, wantSlots])
  const hasSlots = slots.size > 0
  const slotsLoading = wantSlots && slotsPending
  const venueId = hasSlots && venueParam && venues.some((v) => v.id === venueParam) ? venueParam : null
  const venueOrder = useMemo(() => new Map(venues.map((v, i) => [v.id, i])), [venues])
  // TVer のいいね数(ワイルドカード争いの参考値)。持っているのは投票のあった年の準々決勝だけ
  const tver = !showAbsent && hasTverFor(tverLikes, year, round) ? tverLikes : null
  // 出番の無い回戦(過去の年など)で ?sort=order が来たら注目度順。出番の到着を待つ間はそのまま。
  // TVer のいいね数の無い年・回戦の ?sort=tver も同じ(届くまではそのまま)
  const sortKey: SortKey =
    (sort === 'order' && !hasSlots && !slotsLoading) || (sort === 'tver' && !tver && tverLikes !== undefined)
      ? 'hits'
      : sort
  const showTver = sortKey === 'tver' && tver !== null

  // 「いいねだけ」の間に外したいいねは、絞り込みを切り替えるまで行を残す(押し間違えても押し直せるように)
  const likeSig = `${year}|${round}|${liked}`
  const [kept, setKept] = useState({ sig: likeSig, keys: likes })
  if (kept.sig !== likeSig) setKept({ sig: likeSig, keys: likes })
  const likedOnly = liked === '1'
  const likedNow = likedOnly ? likes : null
  const roundLikeCount = useMemo(() => {
    const prefix = `${year}:${round}:`
    let n = 0
    for (const k of likes) if (k.startsWith(prefix)) n++
    return n
  }, [likes, year, round])

  const setVenue = (id: string | null) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        // 会場を選んだら出番順にする(観ている会場の組が出てくる順に並ぶ)
        if (id) {
          p.set('venue', id)
          p.set('sort', 'order')
        } else {
          p.delete('venue')
        }
        p.delete('focus')
        return p
      },
      { replace: true, preventScrollReset: true },
    )
  }

  // 回戦の指定が無い URL(事前描画したページ)は年のタイトル。HTML の <title> と同じ関数(lib/seo.ts)で作る。
  // 年が無いとき(NotFound が自分のタイトルを付ける)と、回戦の指定があって年度ファイルを待っている間は触らない
  const invalidYear = parsedYear === null || (meta !== undefined && !known)
  useDocumentTitle(
    invalidYear
      ? null
      : params.get('round') === null
        ? yearTitle(year, null)
        : yearFile
          ? yearTitle(year, showAbsent ? 'absent' : { round, upcoming })
          : null,
  )

  const rows = useMemo(() => {
    if (!yearFile) return []
    let list = yearFile.entries.filter((e) => e.results[round])
    if (venueId) list = list.filter((e) => slotFor(slots, e.id, venueId) !== null)
    if (likedNow) {
      list = list.filter((e) => {
        if (e.id == null) return false
        const k = likeKey(year, round, e.id)
        return likedNow.has(k) || kept.keys.has(k)
      })
    }
    if (resultFilter === 'pass') list = list.filter((e) => isPassing(e.results[round]))
    if (resultFilter === 'fail')
      list = list.filter((e) => e.results[round] === 'fail' || e.results[round] === 'fail_inferred')
    const kanaCmp = (a: YearEntry, b: YearEntry) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja')
    const sorted = [...list]
    if (sortKey === 'kana') {
      sorted.sort(kanaCmp)
    } else if (sortKey === 'order') {
      // 会場(日付順)→ 会場の中の出番。出番の分からない組(欠席など)は後ろに五十音順
      const posOf = (e: YearEntry) => {
        const sl = slotFor(slots, e.id, venueId)
        return sl ? (venueOrder.get(sl.venue.id) ?? 0) * 100000 + sl.n : null
      }
      sorted.sort((a, b) => {
        const pa = posOf(a)
        const pb = posOf(b)
        if (pa != null && pb != null) return pa - pb
        if (pa != null) return -1
        if (pb != null) return 1
        return kanaCmp(a, b)
      })
    } else if (sortKey === 'tver') {
      // 数の無い組(通過組・動画の無い組)は後ろに五十音順(注目度順と同じ)
      const nOf = (e: YearEntry) => tverItem(tver, e.id)?.n
      sorted.sort((a, b) => {
        const na = nOf(a)
        const nb = nOf(b)
        if (na != null && nb != null) return nb - na
        if (na != null) return -1
        if (nb != null) return 1
        return kanaCmp(a, b)
      })
    } else if (sortKey === 'hits') {
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
  }, [yearFile, round, resultFilter, sortKey, popularity, tver, slots, venueId, venueOrder, likedNow, kept, year])

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

  // 戻るボタンの位置を正しくするため、注目度順は注目度データが届いてから、出番順・会場の絞り込みは
  // 出番が届いてから並びを確定とみなす
  const ready =
    (sortKey !== 'hits' || popularity !== undefined) &&
    (sortKey !== 'tver' || tverLikes !== undefined) &&
    (!(sort === 'order' || venueParam) || !slotsLoading)

  // 年の並び。年を移っても回戦・絞り込み・並び順は引き継ぐ(その年に無い回戦なら1回戦を出す)
  const yearItems = useMemo<ScrollNavItem[]>(() => {
    if (!meta) return []
    const sorted = [...meta.years].sort((a, b) => b - a)
    const items: ScrollNavItem[] = []
    sorted.forEach((y, i) => {
      if (i > 0 && sorted[i - 1] - y > 1) items.push({ key: `gap-${y}`, separator: '休止' })
      items.push({
        key: String(y),
        to: { pathname: yearPath(y), search: searchFor(params, { venue: null }) },
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
  // 最新の年は日程(約1KB)も待つ。待たないと ?round=semifinal を直接開いたとき一瞬1回戦が出て、
  // 届いた日程の分だけ一覧が下にずれる(戻ったときの行の位置合わせも狂う)
  const waitSchedule = schedulePending && (!meta || meta.latestYear === year)

  // 見出しの行と年の並び。年度ファイル(最大1.7MB)を待たず、要約(数KB)と meta だけで出せる部分。
  // 事前描画した HTML はこの「読み込み中」の形(年度ファイル・日程・注目度は HTML に埋め込まない)。
  // 読み込み中と読み込み後で同じ位置に同じ要素を置くので、開いた「勝ち上がり」は閉じない
  const fileSource = yearFile?.source ?? summary?.source
  const entryCount = yearFile?.entries.length ?? summary?.entries
  const isArchive = fileSource === 'official-archive'
  const head = (nextLink: ReactNode) => (
    <div className="year-title">
      <h1 className="page-title">M-1グランプリ {year}</h1>
      {entryCount != null && (
        <p className="year-entries">
          エントリー {entryCount.toLocaleString('ja-JP')}組
          {isArchive && '(公式アーカイブ由来のため、1回戦で敗退した組は載っていません)'}
        </p>
      )}
      {summary?.champion && (
        <p className="year-champion">
          <span className="chip chip-champion">優勝</span>
          <CombiLink id={summary.champion.id}>{summary.champion.name}</CombiLink>
        </p>
      )}
      {nextLink}
      {summary && <YearSummary summary={summary} />}
      {meta?.finalsYears.includes(year) && (
        <Link className="year-finals-link" to={finalsPath(year)}>
          決勝の得点表
        </Link>
      )}
    </div>
  )
  const yearNav = <ScrollNav label="年" variant="pills" items={yearItems} />

  if (isLoading || !yearFile || waitSchedule) {
    return (
      <div className="year-page">
        <div className="year-head">
          {head(null)}
          {yearNav}
        </div>
        <Loading />
      </div>
    )
  }

  const activeRounds = ROUND_ORDER.filter((rk) => (roundCounts.get(rk) ?? 0) > 0)
  const upcomingRounds = ROUND_ORDER.filter(scheduleOnly)
  const passCount = rows.filter((e) => isPassing(e.results[round])).length
  const yearVideos = official?.years[String(year)]
  const total = roundCounts.get(round) ?? 0
  const selectedVenue = venueId ? (venues.find((v) => v.id === venueId) ?? null) : null

  const roundItems: ScrollNavItem[] = activeRounds.map((rk) => {
    const count = roundCounts.get(rk) ?? 0
    const hasVideo = (yearVideos?.playlists[rk]?.length ?? 0) > 0
    return {
      key: rk,
      to: { search: searchFor(params, { round: rk === 'first' ? null : rk, venue: null }) },
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
  if (upcomingRounds.length > 0) roundItems.push({ key: 'sep-upcoming', separator: '' })
  for (const rk of upcomingRounds) {
    const date = roundDateLabel(roundVenues(schedule, year, rk))
    roundItems.push({
      key: rk,
      to: { search: searchFor(params, { round: rk, result: null, venue: null }) },
      inPage: true,
      current: !showAbsent && rk === round,
      className: 'is-upcoming',
      ariaLabel: `${ROUND_LABEL[rk]} ${date}(出場者は未定)`,
      label: (
        <>
          <span className="step-label">{ROUND_LABEL[rk]}</span>
          <span className="step-count step-date">{date}</span>
        </>
      ),
    })
  }
  if (absentRows.length > 0) {
    roundItems.push({ key: 'sep', separator: '' })
    roundItems.push({
      key: ABSENT,
      to: { search: searchFor(params, { round: ABSENT, result: null, venue: null }) },
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
        {/* 「次は…」は今日の日付で変わるので、年度ファイルの後(事前描画した HTML の後)にだけ出す */}
        {head(
          next && (
            <Link
              className="year-next"
              to={{ search: searchFor(params, { round: next.round, result: null, venue: null }) }}
              replace
              preventScrollReset
            >
              {next.venue.date === today ? '今日は' : '次は'} {ROUND_LABEL[next.round]} {formatDay(next.venue)}
            </Link>
          ),
        )}
        {yearNav}
        <ScrollNav label="回戦" variant="steps" items={roundItems} />

        {venues.length > 0 && (upcoming || venues.length <= SCHEDULE_ROWS_MAX) && (
          <RoundSchedule
            venues={venues}
            today={today}
            url={schedule?.url ?? SCHEDULE_PAGE_URL}
            detailed={upcoming}
          />
        )}

        {!showAbsent && !upcoming && (
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
                <select value={sortKey} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {SORTS.filter(
                    (s) => (s !== 'order' || hasSlots || sortKey === 'order') && (s !== 'tver' || tver || sortKey === 'tver'),
                  ).map((s) => (
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
            <div className="year-toolbar year-watch">
              <button
                type="button"
                className="like-filter"
                aria-pressed={likedOnly}
                onClick={() => setLiked(likedOnly ? '0' : '1')}
              >
                <HeartIcon filled />
                いいねだけ
                <span className="like-filter-count">{roundLikeCount.toLocaleString('ja-JP')}</span>
              </button>
              {hasSlots && <VenueSelect venues={venues} value={venueId} today={today} onChange={setVenue} />}
            </div>
            {showTver && tver && <TverNote tver={tver} />}
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
      ) : upcoming ? (
        <p className="page-state">{ROUND_LABEL[round]}の出場者は、公式の発表があり次第載せます。</p>
      ) : (
        <>
          <YearBoard
            key={year}
            rows={rows}
            year={year}
            round={round}
            popularity={popularity}
            tver={tver}
            showTver={showTver}
            official={official}
            slots={slots}
            venueId={venueId}
            focusId={focusId}
            ready={ready}
            signature={`${round}|${resultFilter}|${sortKey}|${venueId}|${liked}`}
            headRef={headRef}
            emptyText={
              likedOnly
                ? `${ROUND_LABEL[round]}でいいねした組はまだありません。各行の右端の ♡ で付けられます。`
                : '該当するコンビがいません'
            }
            status={
              <p className="year-status-text">
                <strong>{ROUND_LABEL[round]}</strong>
                <span>
                  {resultFilter === 'all' && !venueId && !likedOnly
                    ? `${total.toLocaleString('ja-JP')}組(通過 ${passCount.toLocaleString('ja-JP')})`
                    : `${[
                        selectedVenue && `${formatDay(selectedVenue)} ${selectedVenue.area ?? ''}`.trim(),
                        likedOnly && 'いいね',
                        resultFilter === 'pass' ? '通過' : resultFilter === 'fail' ? '敗退' : null,
                      ]
                        .filter(Boolean)
                        .join('・')} ${rows.length.toLocaleString('ja-JP')}組`}
                </span>
                <span className="year-status-sort">{SORT_LABEL[sortKey]}</span>
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
