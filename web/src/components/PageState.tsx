import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * 読み込み中・エラー・見つからない、の表示をそろえる。
 * どれも「次に何をすればいいか」を必ず示す(行き止まりにしない)。
 */
export function Loading({ label = '読み込み中…' }: { label?: string }) {
  return (
    <div className="page-state" role="status" aria-live="polite">
      {label}
    </div>
  )
}

export function ErrorState({ message = 'データを読み込めませんでした。' }: { message?: string }) {
  return (
    <div className="page-state page-state-error" role="alert">
      <p>{message}</p>
      <p>通信の具合で失敗することがあります。少し待って再読み込みしてください。</p>
      <button type="button" className="button" onClick={() => window.location.reload()}>
        再読み込み
      </button>
    </div>
  )
}

/** ページが無いときの表示。title はそのページの <h1>、children で理由を補足する */
export function NotFound({
  title = 'ページが見つかりません',
  children,
}: {
  title?: string
  children?: ReactNode
}) {
  useDocumentTitle(title)
  return (
    <div className="not-found">
      <h1 className="page-title">{title}</h1>
      {children ?? <p>URL が間違っているか、ページが移動した可能性があります。</p>}
      <ul className="not-found-links">
        <li>
          <Link to="/">トップページ</Link>
        </li>
        <li>
          <Link to="/years">最新の年度別結果</Link>
        </li>
        <li>
          <Link to="/finals">決勝の得点</Link>
        </li>
        <li>
          <Link to="/stats">記録・統計</Link>
        </li>
      </ul>
      <p className="not-found-hint">コンビや芸人を探すときは、上の検索欄に名前を入れてください。</p>
    </div>
  )
}
