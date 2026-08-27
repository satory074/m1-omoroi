import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useCombiIndex, useCombiMembers, usePopularity } from '../lib/api'
import {
  cmpHit,
  findHits,
  formatYears,
  getCombiKeys,
  isPanelSort,
  isPanelTab,
  normalize,
  topK,
  type Hit,
  type PanelSort,
  type PanelTab,
} from '../lib/search'
import SearchPanel, { type SearchPanelHandle } from './SearchPanel'

const MAX_RESULTS = 20
/** members.json 到着前に芸人名セクション用に空けておく枠。到着時に一覧が縮んで見えるのを防ぐ */
const MEMBER_RESERVE = 8
/** 展開中にURLの q を追随させるまでの待ち。打鍵ごとに履歴を触らないため */
const URL_SYNC_MS = 400

/** ドロップダウンの1行。「他 N 件」も listbox の中の option として扱い、↑↓で届くようにする */
type Row = { kind: 'hit'; hit: Hit } | { kind: 'more'; tab: PanelTab; total: number }

/**
 * コンビ名と芸人の個人名を全年度横断で引くタイプアヘッド検索。共通ヘッダーに常駐する。
 * 候補は「コンビ名」「芸人名」の2セクションに分かれ、どちらを選んでもコンビ詳細へジャンプする。
 * 20件に収まらない分は「他 N 件」から展開パネル(SearchPanel)へ移り、全件を並べ替えて見られる。
 *
 * 入力値はローカルstateのみで持つ。URL由来の値を value に流すと setSearchParams の
 * startTransition のせいでIME変換中に巻き戻る(コミット 1328974 で撤去済みの不具合)ため、
 * URLへの書き込みは展開・タブ・並び替えと、展開中の遅延同期に限る。
 */
export default function CombiSearch() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  // 展開状態はURLが正。これでブラウザの戻るがそのままパネルを閉じる操作になる
  const urlQuery = params.get('q')
  const expanded = urlQuery !== null
  const tabParam = params.get('tab')
  const tab: PanelTab = isPanelTab(tabParam) ? tabParam : 'all'
  const sortParam = params.get('qsort')
  const sort: PanelSort = isPanelSort(sortParam) ? sortParam : 'relevance'

  // 初期値だけURLから取る(以後は同期しない = IME巻き戻し対策)
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  // 一度フォーカスされたら索引を取りに行く。以後降ろさない(再フォーカスで取り直さないため)。
  // 共有リンクで開いた場合はフォーカス操作が無いので最初から立てる
  const [armed, setArmed] = useState(() => params.get('q') !== null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<SearchPanelHandle>(null)
  /** IME変換中は URL 同期を止める(確定前の文字列を書かないため) */
  const composingRef = useRef(false)
  /** このセッションで自分が履歴を push したか(閉じ方を決めるのに使う) */
  const pushedRef = useRef(false)

  // 絞り込みは低優先で中断可能にし、入力欄の反映(=IME)だけは常に最優先で通す
  const needle = useDeferredValue(query.trim())

  const { data: index } = useCombiIndex(armed)
  const { data: memberKeys, isPending: membersPending } = useCombiMembers(armed)
  const { data: popularity } = usePopularity(armed)

  const combiKeys = useMemo(() => (index ? getCombiKeys(index) : null), [index])
  const q = useMemo(() => normalize(needle), [needle])

  // members.json 待ちか。取得が確定して null(=ファイル無し)なら待たない
  const memberPending = armed && membersPending

  const popOf = useMemo(() => {
    const hitMap = popularity?.hits
    return (id: number) => hitMap?.[String(id)]?.n ?? -1
  }, [popularity])

  // 全ヒット。ドロップダウンは topK で20件に絞るだけで、展開パネルと同じ母集団を見る
  const hits = useMemo(
    () => findHits(q, index, combiKeys, memberKeys, popOf),
    [q, index, combiKeys, memberKeys, popOf],
  )

  const results = useMemo(() => {
    // 未到着のうちは芸人名の枠を確保しておき、到着時にコンビ名側が縮まないようにする
    const reserve = Math.min(memberKeys ? hits.member.length : MEMBER_RESERVE, MEMBER_RESERVE)
    const nCombi = Math.min(hits.combi.length, MAX_RESULTS - reserve)
    const nMember = Math.min(hits.member.length, MAX_RESULTS - nCombi)
    return {
      combi: topK(hits.combi, nCombi, cmpHit),
      combiTotal: hits.combi.length,
      member: topK(hits.member, nMember, cmpHit),
      memberTotal: hits.member.length,
    }
  }, [hits, memberKeys])

  // キーボード操作と aria-activedescendant は2セクションを通し番号で扱う
  const rows = useMemo(() => {
    const out: Row[] = []
    for (const hit of results.combi) out.push({ kind: 'hit', hit })
    if (results.combiTotal > results.combi.length) {
      out.push({ kind: 'more', tab: 'combi', total: results.combiTotal })
    }
    for (const hit of results.member) out.push({ kind: 'hit', hit })
    if (!memberPending && results.memberTotal > results.member.length) {
      out.push({ kind: 'more', tab: 'member', total: results.memberTotal })
    }
    return out
  }, [results, memberPending])

  const combiRowCount = results.combi.length + (results.combiTotal > results.combi.length ? 1 : 0)
  const showMenu = open && needle.length > 0 && !expanded

  // クエリが変わるたびにハイライトをリセット
  useEffect(() => {
    setActive(-1)
  }, [q])

  // ハイライト行が 320px のリストからはみ出したら見える位置まで送る
  useEffect(() => {
    if (active < 0) return
    document.getElementById(`combi-search-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // 展開中は入力を追ってURLの q を更新する。共有したリンクが古いクエリを指さないようにする。
  // replace なので履歴は増えず、value はローカルstateのままなのでIMEにも触らない
  useEffect(() => {
    if (!expanded) return
    const trimmed = query.trim()
    if (!trimmed || trimmed === urlQuery) return
    const t = setTimeout(() => {
      if (composingRef.current) return
      const next = new URLSearchParams(params)
      next.set('q', trimmed)
      setParams(next, { replace: true })
    }, URL_SYNC_MS)
    return () => clearTimeout(t)
  }, [expanded, query, urlQuery, params, setParams])

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

  // フォーカス外クリックで閉じる(展開中はパネル側の背景が受け持つ)
  useEffect(() => {
    if (!showMenu) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showMenu])

  const setUrl = (mutate: (p: URLSearchParams) => void, push = false) => {
    const next = new URLSearchParams(params)
    mutate(next)
    setParams(next, push ? undefined : { replace: true })
  }

  /** 候補リストから展開パネルへ移る。push なので戻るボタンで閉じられる */
  const expand = (t: PanelTab) => {
    const trimmed = query.trim()
    if (!trimmed) return
    pushedRef.current = true
    setUrl((p) => {
      p.set('q', trimmed)
      if (t === 'all') p.delete('tab')
      else p.set('tab', t)
      p.delete('qsort')
    }, true)
    setOpen(false)
    setActive(-1)
  }

  const closePanel = () => {
    if (pushedRef.current) {
      // 自分が積んだ履歴を1つ戻す = 開く前のURLに戻る
      pushedRef.current = false
      navigate(-1)
    } else {
      // 共有リンクで直接開かれた場合。戻るとサイトの外に出てしまうのでURLを掃除する
      setUrl((p) => {
        p.delete('q')
        p.delete('tab')
        p.delete('qsort')
      })
    }
    inputRef.current?.focus()
  }

  const go = (hit: Hit) => {
    if (!index) return
    navigate(`/combi/${index[hit.i][0]}`)
    setQuery('')
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (expanded) closePanel()
      else setOpen(false)
      return
    }
    if (expanded) {
      // 展開中はリストへ入る導線だけ用意する(候補の走査はもう無い)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        panelRef.current?.focusFirstRow()
      }
      return
    }
    if (!showMenu) return
    if (e.key === 'Enter') {
      e.preventDefault()
      const row = active >= 0 && active < rows.length ? rows[active] : null
      // 候補を選ばずに Enter なら、すべてのタブで展開する
      if (!row) expand('all')
      else if (row.kind === 'more') expand(row.tab)
      else go(row.hit)
      return
    }
    if (rows.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % rows.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? rows.length - 1 : i - 1))
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

  /** 「他 N 件」。静的テキストではなく実際に選べる option にして、展開への導線にする */
  const moreOption = (kind: 'combi' | 'member', total: number, shown: number, flatIndex: number) => {
    if (total <= shown) return null
    const label = kind === 'combi' ? 'コンビ名' : '芸人名'
    return (
      <div
        key={`more-${kind}`}
        id={`combi-search-opt-${flatIndex}`}
        role="option"
        aria-selected={flatIndex === active}
        aria-label={`${label}の結果をすべて見る ${total.toLocaleString('ja-JP')}件`}
        className={`combi-search-more${flatIndex === active ? ' active' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setActive(flatIndex)}
        onClick={() => expand(kind)}
      >
        他 {(total - shown).toLocaleString('ja-JP')} 件 — すべて見る
      </div>
    )
  }

  return (
    <div className={`combi-search${expanded ? ' expanded' : ''}`} ref={wrapRef} role="search">
      <input
        ref={inputRef}
        type="search"
        // 展開中は combobox をやめる。タブと select と仮想リストを含むパネルは listbox になれない
        role="combobox"
        // 展開中のポップアップはタブとselectを含むのでlistboxではなくdialog扱いにする
        // (ARIA 1.2 が combobox + haspopup=dialog を認めている)
        aria-haspopup={expanded ? 'dialog' : 'listbox'}
        aria-expanded={expanded || showMenu}
        aria-controls={expanded ? 'search-panel' : 'combi-search-menu'}
        // 展開中は実フォーカスが行を移動するので activedescendant は降ろす
        aria-activedescendant={!expanded && active >= 0 ? `combi-search-opt-${active}` : undefined}
        aria-autocomplete={expanded ? undefined : 'list'}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
        }}
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
          if (!expanded) setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {showMenu && (
        <div className="combi-search-menu" id="combi-search-menu" role="listbox" aria-label="検索候補">
          {!index ? (
            <div className="combi-search-empty">読み込み中…</div>
          ) : rows.length === 0 && !memberPending ? (
            <div className="combi-search-empty">該当するコンビ・芸人がいません</div>
          ) : (
            <>
              {results.combi.length > 0 && (
                <div role="group" aria-label="コンビ名">
                  {/* 見出しと進捗は option ではないので、group の子から隠して
                      アクセシビリティツリーを option だけに保つ(名前は aria-label 側で付く) */}
                  <div className="combi-search-group" aria-hidden="true">
                    コンビ名
                  </div>
                  {results.combi.map((hit, k) => option(hit, k))}
                  {moreOption('combi', results.combiTotal, results.combi.length, results.combi.length)}
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
                    results.member.map((hit, k) => option(hit, combiRowCount + k))
                  )}
                  {!memberPending &&
                    moreOption(
                      'member',
                      results.memberTotal,
                      results.member.length,
                      combiRowCount + results.member.length,
                    )}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {expanded && !index && (
        <>
          <div className="search-panel-backdrop" onMouseDown={closePanel} />
          <section className="search-panel" id="search-panel" role="region" aria-label="検索結果">
            <div className="loading">読み込み中…</div>
          </section>
        </>
      )}
      {expanded && index && (
        <SearchPanel
          query={query.trim() || (urlQuery ?? '')}
          hits={hits}
          index={index}
          memberKeys={memberKeys}
          membersPending={memberPending}
          // useDeferredValue のぶんリストは1テンポ遅れる。追いつくまで薄く見せる
          stale={query.trim() !== needle}
          tab={tab}
          sort={sort}
          ref={panelRef}
          onTab={(t) => setUrl((p) => (t === 'all' ? p.delete('tab') : p.set('tab', t)))}
          onSort={(s) =>
            setUrl((p) => (s === 'relevance' ? p.delete('qsort') : p.set('qsort', s)))
          }
          onClose={closePanel}
          onPick={() => {
            pushedRef.current = false
            setQuery('')
          }}
        />
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {liveText}
      </div>
    </div>
  )
}
