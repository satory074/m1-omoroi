// 画面幅の切り替え点。CSS の @media と同じ値にそろえる(CSS 側は変数を使えないので数値で書いている)。
//   ≤640px: スマホ(年度一覧の2段組み・表の固定列など)
//   ≥1024px: 広い画面(記録・統計の目次を横に固定する等)
export const NARROW_MAX = 640
export const WIDE_MIN = 1024
export const NARROW_QUERY = `(max-width: ${NARROW_MAX}px)`
export const WIDE_QUERY = `(min-width: ${WIDE_MIN}px)`
