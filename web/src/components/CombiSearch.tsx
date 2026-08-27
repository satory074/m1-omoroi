import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useCombiIndex, useCombiMembers, usePopularity } from '../lib/api'
import {
  getCombiKeys,
  normalize,
  TIER_EXACT,
  TIER_NONE,
  tierOf,
  topK,
  type MemberKeys,
} from '../lib/search'
import type { CombiIndexRow } from '../lib/types'

const MAX_RESULTS = 20
/** members.json 到着前に芸人名セクション用に空けておく枠。到着時に一覧が縮んで見えるのを防ぐ */
const MEMBER_RESERVE = 8

/** 五十音順の比較。localeCompare より速く、毎回作り直さないようモジュールスコープに置く */
const collator = new Intl.Collator('ja')

interface Hit {
  /** combi/index.json の行番号 */
  i: number
  /** MemberKeys 内のメンバー番号(コンビ名ヒットは -1) */
  m: number
  tier: number
  pop: number
  nYears: number
  lastYear: number
  sortKey: string
}

/** 出場年リストを連続範囲に畳んで表示する。例 [2015,2016,2017,2022,2023] → "2015–2017, 2022–2023" */
function formatYears(years: number[]): string {
  if (!years || years.length === 0) return ''
  const ys = [...years].sort((a, b) => a - b)
  const parts: string[] = []
  let start = ys[0]
  let prev = ys[0]
  for (let i = 1; i <= ys.length; i++) {
    if (i < ys.length && ys[i] === prev + 1) {
      prev = ys[i]
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`)
    if (i < ys.length) {
      start = ys[i]
      prev = ys[i]
    }
  }
  return parts.join(', ')
}

/**
 * 一致の質 → 注目度 → 出場年数 → 直近出場年 → 五十音 → 行番号。
 * 注目度(YouTube再生数)は3回戦以上の約1,300組にしか無く、残り約41,800組は全て -1 で並ぶ。
 * そのまま五十音へ落とすと「田中」のような多ヒット時の並びが無作為に見えるので、
 * index に元から入っている出場年で「常連ほど上」の弱い信号を足している。
 */
function cmpHit(a: Hit, b: Hit): number {
  if (a.tier !== b.tier) return a.tier - b.tier
  if (a.pop !== b.pop) return b.pop - a.pop
  if (a.nYears !== b.nYears) return b.nYears - a.nYears
  if (a.lastYear !== b.lastYear) return b.lastYear - a.lastYear
  const c = collator.compare(a.sortKey, b.sortKey)
  return c !== 0 ? c : a.i - b.i
}

function makeHit(
  index: CombiIndexRow[],
  i: number,
  m: number,
  tier: number,
  pop: number,
  sortKey: string,
): Hit {
  const yrs = index[i][3]
  return {
    i,
    m,
    tier,
    pop,
    nYears: yrs.length,
    lastYear: yrs.length > 0 ? yrs[yrs.length - 1] : 0,
    sortKey,
  }
}

/**
 * コンビ名と芸人の個人名を全年度横断で引くタイプアヘッド検索。共通ヘッダーに常駐する。
 * 候補は「コンビ名」「芸人名」の2セクションに分かれ、どちらを選んでもコンビ詳細へジャンプする。
 * 入力値はローカルstateのみ(URLに載せない)なのでIME変換中の巻き戻しは起きない。
 */
export default function CombiSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  // 一度フォーカスされたら索引を取りに行く。以後降ろさない(再フォーカスで取り直さないため)
  const [armed, setArmed] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 絞り込みは低優先で中断可能にし、入力欄の反映(=IME)だけは常に最優先で通す
  const needle = useDeferredValue(query.trim())

  const { data: index } = useCombiIndex(armed)
  const { data: memberKeys, isPending: membersPending } = useCombiMembers(armed)
  const { data: popularity } = usePopularity(armed)

  const combiKeys = useMemo(() => (index ? getCombiKeys(index) : null), [index])
  const q = useMemo(() => normalize(needle), [needle])

  // members.json 待ちか。取得が確定して null(=ファイル無し)なら待たない
  const memberPending = armed && membersPending

  const results = useMemo(() => {
    const empty = { combi: [] as Hit[], combiTotal: 0, member: [] as Hit[], memberTotal: 0 }
    // 記号や空白だけの入力は正規化すると空文字になる。includes('') は常に true なので
    // ここで弾かないと全43,108組 + 全88,315人がヒットする
    if (!q || !index || !combiKeys) return empty
    const popOf = (id: number) => popularity?.hits[String(id)]?.n ?? -1

    // --- コンビ名
    const matchedCombi = new Uint8Array(index.length)
    const cHits: Hit[] = []
    for (let i = 0; i < index.length; i++) {
      const t = tierOf(combiKeys.names[i], combiKeys.kanas[i], q)
      if (t === TIER_NONE) continue
      matchedCombi[i] = 1
      cHits.push(makeHit(index, i, -1, t, popOf(index[i][0]), index[i][2] || index[i][1]))
    }

    // --- 芸人名(コンビ名で既に出る組は除外し、1組につき最良の1人だけ出す)
    const mHits: Hit[] = []
    if (memberKeys) {
      const { names, kanas, rawSort, off } = memberKeys as MemberKeys
      for (let i = 0; i < index.length; i++) {
        if (matchedCombi[i]) continue
        let best = -1
        let bestTier = TIER_NONE
        for (let m = off[i]; m < off[i + 1]; m++) {
          const t = tierOf(names[m], kanas[m], q)
          if (t < bestTier) {
            bestTier = t
            best = m
            if (t === TIER_EXACT) break
          }
        }
        if (best < 0) continue
        mHits.push(makeHit(index, i, best, bestTier, popOf(index[i][0]), rawSort[best]))
      }
    }

    // 未到着のうちは芸人名の枠を確保しておき、到着時にコンビ名側が縮まないようにする
    const reserve = Math.min(memberKeys ? mHits.length : MEMBER_RESERVE, MEMBER_RESERVE)
    const nCombi = Math.min(cHits.length, MAX_RESULTS - reserve)
    const nMember = Math.min(mHits.length, MAX_RESULTS - nCombi)
    return {
      combi: topK(cHits, nCombi, cmpHit),
      combiTotal: cHits.length,
      member: topK(mHits, nMember, cmpHit),
      memberTotal: mHits.length,
    }
  }, [q, index, combiKeys, memberKeys, popularity])

  // キーボード操作と aria-activedescendant は2セクションを通し番号で扱う
  const flat = useMemo(
    () => [...results.combi, ...results.member],
    [results.combi, results.member],
  )
  const showMenu = open && needle.length > 0

  // クエリが変わるたびにハイライトをリセット
  useEffect(() => {
    setActive(-1)
  }, [q])

  // ハイライト行が 320px のリストからはみ出したら見える位置まで送る
  useEffect(() => {
    if (active < 0) return
    document.getElementById(`combi-search-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // 件数の読み上げ。打鍵ごとに喋らせないよう落ち着いてから1回だけ更新する。
  // 芸人名セクションが後から合流する挙動は、これが無いと読み上げ環境に伝わらない
  const [liveText, setLiveText] = useState('')
  useEffect(() => {
    if (!showMenu || !q) {
      setLiveText('')
      return
    }
    const t = setTimeout(() => {
      const members = memberPending
        ? '読み込み中'
        : `${results.memberTotal.toLocaleString('ja-JP')} 件`
      setLiveText(`コンビ名 ${results.combiTotal.toLocaleString('ja-JP')} 件、芸人名 ${members}`)
    }, 500)
    return () => clearTimeout(t)
  }, [showMenu, q, results.combiTotal, results.memberTotal, memberPending])

  // フォーカス外クリックで閉じる
  useEffect(() => {
    if (!showMenu) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showMenu])

  const go = (hit: Hit) => {
    if (!index) return
    navigate(`/combi/${index[hit.i][0]}`)
    setQuery('')
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!showMenu || flat.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? flat.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0 && active < flat.length) {
      e.preventDefault()
      go(flat[active])
    }
  }

  const option = (hit: Hit, flatIndex: number) => {
    if (!index) return null
    const row = index[hit.i]
    const isMember = hit.m >= 0
    return (
      <div
        key={isMember ? `m${hit.i}` : `c${hit.i}`}
        id={`combi-search-opt-${flatIndex}`}
        role="option"
        aria-selected={flatIndex === active}
        aria-label={isMember ? `${memberKeys?.raw[hit.m]}(${row[1]})` : row[1]}
        className={`combi-search-option${isMember ? ' member' : ''}${flatIndex === active ? ' active' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setActive(flatIndex)}
        onClick={() => go(hit)}
      >
        <span className="combi-search-name">{isMember ? memberKeys?.raw[hit.m] : row[1]}</span>
        {isMember && <span className="combi-search-sub">{row[1]}</span>}
        <span className="combi-search-years">{formatYears(row[3])}</span>
      </div>
    )
  }

  const more = (total: number, shown: number) =>
    total > shown ? (
      <div className="combi-search-more" aria-hidden="true">
        他 {(total - shown).toLocaleString('ja-JP')} 件
      </div>
    ) : null

  return (
    <div className="combi-search" ref={wrapRef} role="search">
      <input
        type="search"
        role="combobox"
        aria-expanded={showMenu}
        aria-controls="combi-search-menu"
        aria-activedescendant={active >= 0 ? `combi-search-opt-${active}` : undefined}
        aria-autocomplete="list"
        placeholder="コンビ名・芸人名で探す"
        aria-label="コンビ名・芸人名で探す(全年度)"
        value={query}
        onChange={(e) => {
          setArmed(true)
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setArmed(true)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {showMenu && (
        <div className="combi-search-menu" id="combi-search-menu" role="listbox" aria-label="検索候補">
          {!index ? (
            <div className="combi-search-empty">読み込み中…</div>
          ) : flat.length === 0 && !memberPending ? (
            <div className="combi-search-empty">該当するコンビ・芸人がいません</div>
          ) : (
            <>
              {results.combi.length > 0 && (
                <div role="group" aria-label="コンビ名">
                  {/* 見出し・件数・進捗は option ではないので、group の子から隠して
                      アクセシビリティツリーを option だけに保つ(名前は aria-label 側で付く) */}
                  <div className="combi-search-group" aria-hidden="true">
                    コンビ名
                  </div>
                  {results.combi.map((hit, k) => option(hit, k))}
                  {more(results.combiTotal, results.combi.length)}
                </div>
              )}
              {(results.member.length > 0 || memberPending) && (
                <div role="group" aria-label="芸人名">
                  <div className="combi-search-group" aria-hidden="true">
                    芸人名
                  </div>
                  {memberPending ? (
                    <div className="combi-search-pending" aria-hidden="true">
                      芸人名を読み込み中…
                    </div>
                  ) : (
                    results.member.map((hit, k) => option(hit, results.combi.length + k))
                  )}
                  {!memberPending && more(results.memberTotal, results.member.length)}
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {liveText}
      </div>
    </div>
  )
}
