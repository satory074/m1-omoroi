import { useEffect } from 'react'

export const SITE_NAME = 'M-1オモロイ'
const DEFAULT_TITLE = `${SITE_NAME} | M-1グランプリ全回戦の通過・敗退データベース`

/**
 * ページごとにタブ・履歴・ブックマークで区別できるタイトルを付ける。
 * React 19 の <title> 要素は index.html に既にある静的な <title> に負けるので、document.title を直接書く。
 *   文字列 … そのタイトルにする / '' … サイト既定のタイトル(トップページ)
 *   null  … 触らない(読み込み中)。親ページが null のまま、子の NotFound が付けたタイトルを
 *           上書きしないため(副作用は子 → 親の順に走るので、親が既定値を書くと子のタイトルが消える)
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title === null) return
    document.title = title ? `${title} | ${SITE_NAME}` : DEFAULT_TITLE
  }, [title])
}
