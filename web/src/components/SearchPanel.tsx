import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'

import { bestRoundLabel, formatHits } from '../lib/rounds'
import {
  comparatorFor,
  formatYears,
  PANEL_SORTS,
  PANEL_TABS,
  type Hits,
  type MemberKeys,
  type PanelSort,
  type PanelTab,
} from '../lib/search'
import type { CombiIndexRow } from '../lib/types'

/** 行の高さ。index.css の .search-panel-row と対応するので、片方だけ変えないこと */
const ROW_HEIGHT = 56

export interface SearchPanelHandle {
  /** 入力欄で ↓ を押したときにリストへ入る */
  focusFirstRow: () => void
}

interface Props {
  /** 見出しに出す生のクエリ */
  query: string
  hits: Hits
  index: CombiIndexRow[]
  memberKeys: MemberKeys | null | undefined
  /** members.json がまだ飛行中か(芸人名の件数が過小に見えるのを説明するため) */
  membersPending: boolean
  /** 入力に対して絞り込みが1テンポ遅れているか */
  stale: boolean
  tab: PanelTab
  sort: PanelSort
  onTab: (t: PanelTab) => void
  onSort: (s: PanelSort) => void
  onClose: () => void
  /** 行から遷移したとき(パネルを畳むため) */
  onPick: () => void
  ref?: Ref<SearchPanelHandle>
}

/**
 * ドロップダウンを展開した検索結果パネル。ヘッダーから吊るオーバーレイで、
 * 上部のタブ・並び替えは固定、下のリストだけが仮想スクロールする。
 *
 * ARIA: コンパクト時の入力欄は combobox + listbox だが、タブと select と仮想リストを
 * 含む器は listbox になれないので、展開中は入力欄が aria-haspopup="dialog" に変わり
 * (CombiSearch 側で制御)ここは role="region" になる。
 *
 * **aria-modal は付けない**。フォーカスは正当にパネルの外(ヘッダーの入力欄)に居続け、
 * そこで打ち続けて絞り込める設計だから。モーダルを名乗るとスクリーンリーダーが
 * 「今まさに打っている入力欄」を隠してしまう。
 *
 * <dialog>+showModal() ならスタッキングもフォーカストラップも無料で手に入るが、
 * 外側が inert になってヘッダーの入力欄が死ぬ。パネル専用の2つ目の入力欄を作って
 * 値を二重管理することになるので採らなかった。
 */
export default function SearchPanel({
  query,
  hits,
  index,
  memberKeys,
  membersPending,
  stale,
  tab,
  sort,
  onTab,
  onSort,
  onClose,
  onPick,
  ref,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const tablistRef = useRef<HTMLDivElement>(null)
  const [focusIdx, setFocusIdx] = useState(-1)
  /** フォーカスしたい行。仮想リストがまだ描いていないことがあるので描けるまで持ち越す */
  const wantFocus = useRef(-1)

  const rows = useMemo(() => {
    const base =
      tab === 'combi' ? hits.combi : tab === 'member' ? hits.member : [...hits.combi, ...hits.member]
    // 全件ソート。最悪27,500行で約49ms(実測)だが、打鍵ごとではなく
    // クエリ・タブ・並び替えが変わったときだけ走る
    return [...base].sort(comparatorFor(sort, index))
  }, [hits, tab, sort, index])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  // Tab でリストに入れるよう、どれか1行は必ず tabIndex=0 にしておく(ローピングタブインデックス)
  const cursor = focusIdx < 0 ? 0 : focusIdx

  useImperativeHandle(ref, () => ({ focusFirstRow: () => moveFocus(0) }))

  // 表示中は背後をスクロールさせない。ヘッダーは sticky ではないので、
  // ロックしないとパネルごと画面外へ流れてしまう
  useEffect(() => {
    // 戻る操作でスクロール位置が復元された直後だとヘッダーが画面外に居ることがある。
    // そのままロックすると二度と見えないので、先に引き戻す
    const anchor = listRef.current?.closest('.combi-search')?.getBoundingClientRect().top ?? 0
    if (anchor < 0) window.scrollTo({ top: 0 })

    const { body } = document
    const prevOverflow = body.style.overflow
    const prevPad = body.style.paddingRight
    const barWidth = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (barWidth > 0) body.style.paddingRight = `${barWidth}px`
    return () => {
      body.style.overflow = prevOverflow
      body.style.paddingRight = prevPad
    }
  }, [])

  // クエリ・タブ・並び替えが変わったら行のフォーカス位置をリセット
  useEffect(() => {
    setFocusIdx(-1)
    wantFocus.current = -1
  }, [query, tab, sort])

  // scrollToIndex は scrollTop を同期で動かすが、仮想リストの再描画は scroll イベント
  // 経由で非同期に来る。末尾へ飛ぶと次フレームではまだ行が無いので、描けるまで毎レンダー試す
  useEffect(() => {
    const i = wantFocus.current
    if (i < 0) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${i}"]`)
    if (el) {
      // preventScroll: ブラウザ側のスクロールが仮想リストのスクロールと喧嘩するのを防ぐ
      el.focus({ preventScroll: true })
      wantFocus.current = -1
    }
  })

  const moveFocus = (next: number) => {
    if (rows.length === 0) return
    const i = Math.max(0, Math.min(rows.length - 1, next))
    setFocusIdx(i)
    wantFocus.current = i
    virtualizer.scrollToIndex(i, { align: 'auto' })
  }

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveFocus(focusIdx + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocus(focusIdx - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      moveFocus(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      moveFocus(rows.length - 1)
    }
  }

  // 自動アクティベーションのタブは、←→ で選択とフォーカスの両方が動く必要がある
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const at = PANEL_TABS.indexOf(tab)
    const d = e.key === 'ArrowRight' ? 1 : -1
    const next = PANEL_TABS[(at + d + PANEL_TABS.length) % PANEL_TABS.length]
    onTab(next)
    requestAnimationFrame(() => {
      tablistRef.current?.querySelector<HTMLButtonElement>(`#search-panel-tab-${next}`)?.focus()
    })
  }

  const total = hits.combi.length + hits.member.length
  const memberCount = membersPending ? '読み込み中' : hits.member.length.toLocaleString('ja-JP')
  const tabLabel: Record<PanelTab, string> = {
    all: `すべて ${total.toLocaleString('ja-JP')}`,
    combi: `コンビ名 ${hits.combi.length.toLocaleString('ja-JP')}`,
    member: `芸人名 ${memberCount}`,
  }

  return (
    <>
      <div className="search-panel-backdrop" onMouseDown={onClose} />
      <section
        id="search-panel"
        className="search-panel"
        role="region"
        aria-label={`「${query}」の検索結果 ${total.toLocaleString('ja-JP')}件`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="search-panel-head">
          <div className="search-panel-count">
            「{query}」の検索結果 <strong>{total.toLocaleString('ja-JP')}</strong> 件
          </div>
          <div className="search-panel-controls">
            <div className="seg" role="tablist" aria-label="結果の種類" ref={tablistRef}>
              {PANEL_TABS.map((t) => (
                <button
                  key={t}
                  id={`search-panel-tab-${t}`}
                  role="tab"
                  aria-selected={t === tab}
                  aria-controls="search-panel-list"
                  tabIndex={t === tab ? 0 : -1}
                  className={t === tab ? 'active' : ''}
                  onClick={() => onTab(t)}
                  onKeyDown={onTabKeyDown}
                >
                  {tabLabel[t]}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => onSort(e.target.value as PanelSort)}
              aria-label="並び順"
            >
              {PANEL_SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          {sort === 'pop' && (
            <p className="search-panel-note">
              注目度は3回戦以上の出場経験があるコンビが対象です。データのない組は後ろに並びます。
            </p>
          )}
        </div>

        <div
          className="search-panel-list"
          id="search-panel-list"
          role="tabpanel"
          aria-labelledby={`search-panel-tab-${tab}`}
          aria-busy={stale}
          ref={listRef}
          onKeyDown={onListKeyDown}
        >
          {rows.length === 0 ? (
            <div className="board-empty">該当するコンビ・芸人がいません</div>
          ) : (
            <div
              role="list"
              aria-label={tabLabel[tab]}
              style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((v) => {
                const hit = rows[v.index]
                const row = index[hit.i]
                const isMember = hit.m >= 0
                const round = bestRoundLabel(row[4] ?? 0)
                return (
                  // aria-setsize/posinset は role="link" では無視されるので listitem に載せる。
                  // 行そのものは Link のままにして、⌘クリック・中クリックで新規タブに開けるようにする
                  <div
                    key={v.key}
                    role="listitem"
                    aria-posinset={v.index + 1}
                    aria-setsize={rows.length}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${v.start}px)`,
                    }}
                  >
                    <Link
                      to={`/combi/${row[0]}`}
                      className="search-panel-row"
                      data-row={v.index}
                      tabIndex={v.index === cursor ? 0 : -1}
                      onFocus={() => setFocusIdx(v.index)}
                      onClick={onPick}
                    >
                      <span className="search-panel-name">
                        {isMember ? memberKeys?.raw[hit.m] : row[1]}
                        {isMember && <span className="search-panel-sub">{row[1]}</span>}
                      </span>
                      <span className="search-panel-meta">
                        {formatYears(row[3])}
                        {round && <span className="search-panel-round">{round}</span>}
                      </span>
                      <span className="search-panel-hits">
                        {hit.pop > 0 ? formatHits(hit.pop) : ''}
                      </span>
                    </Link>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
