import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'

import { useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * 画面の描画中に起きた想定外のエラー(ルーターの errorElement)。
 * よくあるのはデプロイ直後: 開きっぱなしのタブが古いファイル名の部品(決勝・統計ページ)を取りに行き、
 * GitHub Pages に既に無いため読み込めない。その場合は再読み込みで直るので、それを案内する。
 */
export default function RouteError() {
  const error = useRouteError()
  useDocumentTitle('表示できませんでした')
  const stale =
    error instanceof Error && /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message)
  const status = isRouteErrorResponse(error) ? error.status : null

  return (
    <div className="not-found" role="alert">
      <h1 className="page-title">表示できませんでした</h1>
      {stale ? (
        <p>サイトが更新されたため、古い画面の部品を読み込めませんでした。再読み込みすると最新の画面になります。</p>
      ) : (
        <p>画面の表示中に問題が起きました{status ? `(${status})` : ''}。再読み込みしても直らないときは、トップページから開き直してください。</p>
      )}
      <p>
        <button type="button" className="button" onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </p>
      <p>
        {/* App の外(errorElement)なので Link は使えるが、壊れた状態を引きずらないよう通常のリンクで開き直す */}
        <Link to="/" reloadDocument>
          トップページへ
        </Link>
      </p>
    </div>
  )
}
