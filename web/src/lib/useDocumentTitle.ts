import { useEffect } from 'react'

import { fullTitle } from './seo'

/**
 * ページごとにタブ・履歴・ブックマークで区別できるタイトルを付ける。
 * React 19 の <title> 要素は index.html に既にある静的な <title> に負けるので、document.title を直接書く。
 * 文言は lib/seo.ts で作る(事前描画した HTML の <title> と同じ関数を通す)。
 *   文字列 … そのタイトルにする / '' … サイト既定のタイトル(トップページ)
 *   null  … 触らない(読み込み中)。親ページが null のまま、子の NotFound が付けたタイトルを
 *           上書きしないため(副作用は子 → 親の順に走るので、親が既定値を書くと子のタイトルが消える)
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title === null) return
    document.title = fullTitle(title)
  }, [title])
}
