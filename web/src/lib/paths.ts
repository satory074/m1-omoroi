// サイト内のパス。事前描画したページ(年度・決勝・記録統計)は「ディレクトリ/index.html」として置くので、
// 末尾に / を付ける。付けないと GitHub Pages が / 付きへ 301 で転送し直す(検索エンジンにも余計な手間)。
// scripts/seo-check.mjs が静的 HTML の中のリンクの末尾 / 漏れを検出する。

/** 年度一覧。search は '?round=final' のようにクエリを付けるとき */
export const yearPath = (year: number, search = '') => `/years/${year}/${search}`

export const finalsPath = (year: number) => `/finals/${year}/`

/** 記録・統計。'' は「大会」タブ(/stats/) */
export const statsPath = (section = '') => (section ? `/stats/${section}/` : '/stats/')

/** コンビ詳細。まだ事前描画していない(404.html から画面を描く)ので末尾 / は付けない */
export const combiPath = (id: number) => `/combi/${id}`
