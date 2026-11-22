// サイト内のパス。事前描画したページ(年度・決勝・記録統計・一部のコンビ詳細)は「ディレクトリ/index.html」として
// 置くので、末尾に / を付ける。付けないと GitHub Pages が / 付きへ 301 で転送し直す(検索エンジンにも余計な手間)。
// scripts/seo-check.mjs が静的 HTML の中のリンクの末尾 / 漏れを検出する。
import combiPages from 'virtual:combi-pages'

/** 年度一覧。search は '?round=final' のようにクエリを付けるとき */
export const yearPath = (year: number, search = '') => `/years/${year}/${search}`

export const finalsPath = (year: number) => `/finals/${year}/`

/** 記録・統計。'' は「大会」タブ(/stats/) */
export const statsPath = (section = '') => (section ? `/stats/${section}/` : '/stats/')

/** コンビ詳細を事前描画しているか(最高到達が準々決勝以上の組。集合は vite.config.ts の virtual:combi-pages) */
export const hasCombiPage = (id: number) => combiPages.has(id)

/** コンビ詳細。事前描画した組は末尾 / 付き。それ以外(1〜3回戦止まり)はページが無く、
 *  404.html から画面を描くので / は付けない */
export const combiPath = (id: number) => (combiPages.has(id) ? `/combi/${id}/` : `/combi/${id}`)
