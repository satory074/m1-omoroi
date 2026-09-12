// 「もしあなたが審査員だったら」でユーザーが入力した点数を localStorage へ保存する。
// 年ごとに独立したキー(m1:my-scores:{year})で { 組のキー: 点数 } を持つ。
// プライベートブラウズやサイトデータ無効化の環境では localStorage へのアクセス自体が
// 例外を投げるため、読み書きすべてを try/catch で包む(保存はベストエフォート)。

/** 組のキー → あなたがつけた点数(0〜100の整数)。未入力の組はキーごと存在しない */
export type MyScores = Record<string, number>

/** 入力できる点数の範囲。全21年の実データ最大値は100(2001の会場票も1会場100点満点) */
export const MY_SCORE_MIN = 0
export const MY_SCORE_MAX = 100
/** 空欄のセルで ↑↓ を押したときの起点。近年の決勝は90点前後が中心 */
export const MY_SCORE_DEFAULT = 90

const KEY_PREFIX = 'm1:my-scores:'

const storageKey = (year: number) => `${KEY_PREFIX}${year}`

/** 0〜100の整数に丸める */
export function clampMyScore(n: number): number {
  return Math.min(MY_SCORE_MAX, Math.max(MY_SCORE_MIN, Math.round(n)))
}

/**
 * 保存済みの点数を読む。壊れた値・型違いは黙って捨てる。
 * validKeys を渡すと、現在の出場組に無いキー(データ修正で消えた古い組)も落とす。
 */
export function loadMyScores(year: number, validKeys?: readonly string[]): MyScores {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(storageKey(year))
  } catch {
    // ストレージ自体が使えない環境。採点なしとして続行する
    return {}
  }
  if (!raw) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 手で書き換えられた等でJSONが壊れている
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

  const allow = validKeys ? new Set(validKeys) : null
  const out: MyScores = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (allow && !allow.has(key)) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    out[key] = clampMyScore(value)
  }
  return out
}

/** 保存する。空ならキーごと削除(クリア操作がそのままゴミ掃除になる) */
export function saveMyScores(year: number, scores: MyScores): void {
  try {
    if (Object.keys(scores).length === 0) window.localStorage.removeItem(storageKey(year))
    else window.localStorage.setItem(storageKey(year), JSON.stringify(scores))
  } catch {
    // QuotaExceededError やストレージ無効。保存できなくても画面上の操作は続行できる
  }
}
