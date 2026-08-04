import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useCombiIndex, usePopularity } from '../lib/api'
import type { CombiIndexRow } from '../lib/types'

const MAX_RESULTS = 20

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
 * コンビ名の全年度横断タイプアヘッド検索。年度ボードには手を付けず、
 * 入力欄の下に全年度の該当コンビ候補を重ね、選択でコンビ詳細へジャンプする。
 * 入力値はローカルstateのみ(URLに載せない)なのでIME変換中の巻き戻しは起きない。
 */
export default function CombiSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)

  const needle = query.trim()
  const { data: index } = useCombiIndex(needle.length > 0)
  const { data: popularity } = usePopularity()

  const results = useMemo(() => {
    if (!needle || !index) return { shown: [] as CombiIndexRow[], total: 0 }
    const hit = (id: number) => popularity?.hits[String(id)]?.n ?? -1
    const matched = index.filter(
      ([, name, kana]) => name.includes(needle) || (kana ?? '').includes(needle),
    )
    matched.sort((a, b) => {
      const ap = a[1].startsWith(needle) || (a[2] ?? '').startsWith(needle)
      const bp = b[1].startsWith(needle) || (b[2] ?? '').startsWith(needle)
      if (ap !== bp) return ap ? -1 : 1
      const ha = hit(a[0])
      const hb = hit(b[0])
      if (ha !== hb) return hb - ha
      return (a[2] || a[1]).localeCompare(b[2] || b[1], 'ja')
    })
    return { shown: matched.slice(0, MAX_RESULTS), total: matched.length }
  }, [index, popularity, needle])

  const shown = results.shown
  const showMenu = open && needle.length > 0

  // クエリが変わるたびにハイライトをリセット
  useEffect(() => {
    setActive(-1)
  }, [needle])

  // フォーカス外クリックで閉じる
  useEffect(() => {
    if (!showMenu) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showMenu])

  const go = (row: CombiIndexRow) => {
    navigate(`/combi/${row[0]}`)
    setQuery('')
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!showMenu || shown.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % shown.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? shown.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0 && active < shown.length) {
      e.preventDefault()
      go(shown[active])
    }
  }

  return (
    <div className="combi-search" ref={wrapRef}>
      <input
        type="search"
        role="combobox"
        aria-expanded={showMenu}
        aria-controls="combi-search-menu"
        aria-activedescendant={active >= 0 ? `combi-search-opt-${active}` : undefined}
        aria-autocomplete="list"
        placeholder="コンビ名で探す"
        aria-label="コンビ名で探す(全年度)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showMenu && (
        <ul className="combi-search-menu" id="combi-search-menu" role="listbox">
          {!index ? (
            <li className="combi-search-empty">読み込み中…</li>
          ) : shown.length === 0 ? (
            <li className="combi-search-empty">該当するコンビがいません</li>
          ) : (
            <>
              {shown.map((row, i) => (
                <li
                  key={row[0]}
                  id={`combi-search-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`combi-search-option${i === active ? ' active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(row)}
                >
                  <span className="combi-search-name">{row[1]}</span>
                  <span className="combi-search-years">{formatYears(row[3])}</span>
                </li>
              ))}
              {results.total > shown.length && (
                <li className="combi-search-more" aria-hidden>
                  他 {(results.total - shown.length).toLocaleString('ja-JP')} 件
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  )
}
