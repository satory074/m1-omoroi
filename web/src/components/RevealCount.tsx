import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { finalsPath } from '../lib/paths'
import { revealKey, type Reveal, type RevealContent, type RevealItem } from '../lib/reveal'
import CombiLink from './CombiLink'

/**
 * 記録・統計の「数字だけ」の記録で、その数字がどの組なのかを出す。
 *
 * 数字を押すと、その行のすぐ下に1行差し込んで名前を並べる。もう一度押すと閉じる。表ごとに開くのは1つだけ。
 * ホバーで開かないのは、スマホにホバーが無く、170組ほどの一覧は吹き出しに収まらず、横にスクロールする表の端で
 * 吹き出しが切れるため(ユーザーと決めた。2026-11)。
 * 最初は全部閉じているので、事前描画の HTML と hydrate の最初の描画は食い違わない。
 * 一覧の件数は画面の数字と同じであることをビルド(build_json.py の _check_named_counts)が確かめている。
 * 見た目は styles/components/reveal.css。
 *
 * 使い方(表。useReveal・fromRoster は lib/reveal.ts):
 *   const reveal = useReveal()
 *   <tr>…<td><RevealButton reveal={reveal} row="1" col="appear" label="1番の出場" count={21} /></td>…</tr>
 *   <RevealRow reveal={reveal} row="1" colSpan={6} content={(col) => ({ title: '1番の出場', items })} />
 * 表の外の文中の数字は、段落の後ろに RevealBlock を置く。
 */

/** 押すと名前の一覧が開く数字。0 は開いても何も無いので数字のまま */
export function RevealButton({
  reveal,
  row,
  col,
  label,
  count,
  unit = '組',
  children,
}: {
  reveal: Reveal
  row: string
  col: string
  /** 読み上げの名前(「1番の出場 21組の名前」の「1番の出場」) */
  label: string
  count: number
  unit?: string
  /** 見せる文字(省略時は count) */
  children?: ReactNode
}) {
  if (count === 0) return <>{children ?? count}</>
  const key = revealKey(row, col)
  const expanded = reveal.open === key
  return (
    <button
      type="button"
      className="reveal-btn"
      aria-expanded={expanded}
      // 閉じている間は一覧が DOM に無いので、開いているときだけ指す
      aria-controls={expanded ? reveal.panelId(row) : undefined}
      aria-label={`${label} ${count}${unit}の名前`}
      onClick={() => reveal.toggle(key)}
    >
      {children ?? count}
    </button>
  )
}

/** 開いた列の中身を返す関数から、開いているときだけ差し込む表の1行 */
export function RevealRow({
  reveal,
  row,
  colSpan,
  content,
}: {
  reveal: Reveal
  row: string
  colSpan: number
  content: (col: string) => RevealContent | null
}) {
  const c = openContent(reveal, row, content)
  if (!c) return null
  return (
    <tr className="reveal-row">
      <td className="reveal-cell" colSpan={colSpan}>
        <RevealPanel id={reveal.panelId(row)} content={c} />
      </td>
    </tr>
  )
}

/** 表の外(文中の数字)用。段落の後ろに置く */
export function RevealBlock({
  reveal,
  row,
  content,
}: {
  reveal: Reveal
  row: string
  content: (col: string) => RevealContent | null
}) {
  const c = openContent(reveal, row, content)
  if (!c) return null
  return (
    <div className="reveal-block">
      <RevealPanel id={reveal.panelId(row)} content={c} />
    </div>
  )
}

function openContent(reveal: Reveal, row: string, content: (col: string) => RevealContent | null) {
  const prefix = revealKey(row, '')
  if (!reveal.open?.startsWith(prefix)) return null
  return content(reveal.open.slice(prefix.length))
}

function RevealPanel({ id, content }: { id: string; content: RevealContent }) {
  const { title, items, unit = '組', yearTo = (it: RevealItem) => finalsPath(it.year as number) } = content
  return (
    <div className="reveal-panel" id={id}>
      <p className="reveal-head">
        {title} {items.length}
        {unit}
      </p>
      <p className="reveal-names">
        {items.map((it, i) => (
          <span key={`${it.year ?? ''}:${it.combiId ?? it.name}:${i}`} className="winner-item">
            {i > 0 && '・'}
            <CombiLink id={it.combiId}>{it.name}</CombiLink>
            {it.year != null && (
              <>
                (<Link to={yearTo(it)}>{it.year}</Link>)
              </>
            )}
            {it.note && `(${it.note})`}
          </span>
        ))}
      </p>
    </div>
  )
}
