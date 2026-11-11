import type { ResultKey, RoundKey } from './types'

export const ROUND_ORDER: RoundKey[] = [
  'first',
  'second',
  'third',
  'quarterfinal',
  'semifinal',
  'playoff',
  'final',
]

export const ROUND_LABEL: Record<RoundKey, string> = {
  first: '1回戦',
  second: '2回戦',
  third: '3回戦',
  quarterfinal: '準々決勝',
  semifinal: '準決勝',
  playoff: '敗者復活戦',
  final: '決勝',
}

/** combi/index.json の5要素目(最高到達ラウンド)の対応表。0=不明なので添字は1始まり。
 *  ビルド側 build_json.py の MAIN_ROUNDS と一致させること(playoff を含まない)。 */
export const BEST_ROUND_KEYS: RoundKey[] = ROUND_ORDER.filter((r) => r !== 'playoff')

/** 最高到達ラウンドの表示ラベル。不明(0)や範囲外は null。 */
export function bestRoundLabel(best: number): string | null {
  const key = BEST_ROUND_KEYS[best - 1]
  return key ? ROUND_LABEL[key] : null
}

/** 最高戦績の「優勝」。BEST_ROUND_KEYS の決勝(6)の1つ上。
 *  ビルド側 build_json.py の BEST_CHAMPION と一致させること(年度JSONの best に入る)。 */
export const BEST_CHAMPION = BEST_ROUND_KEYS.length + 1

/** 最高戦績の表示ラベル(1..6=回戦、7=優勝)。0や範囲外は null。 */
export function bestResultLabel(level: number): string | null {
  return level === BEST_CHAMPION ? '優勝' : bestRoundLabel(level)
}

/** 1年分の results の戦績段階。build_json.py の _result_level と同じ(到達はキーの有無、合否は問わない) */
export function resultLevel(results: Partial<Record<RoundKey, ResultKey>>): number {
  if (results.final === 'champion') return BEST_CHAMPION
  let level = 0
  BEST_ROUND_KEYS.forEach((rk, i) => {
    if (results[rk]) level = i + 1
  })
  return level
}

/** 全出場年を通じた最高戦績(コンビ詳細の見出し用) */
export function bestResultOfHistory(
  history: Record<string, { results: Partial<Record<RoundKey, ResultKey>> }>,
): number {
  return Math.max(0, ...Object.values(history).map((h) => resultLevel(h.results)))
}

export const RESULT_DISPLAY: Record<ResultKey, { sym: string; label: string }> = {
  pass: { sym: '○', label: '通過' },
  seed_pass: { sym: '◎', label: 'シード通過' },
  fail: { sym: '×', label: '敗退' },
  fail_inferred: { sym: '×', label: '敗退' },
  champion: { sym: '★', label: '優勝' },
  absent: { sym: '－', label: '欠席' },
  scheduled: { sym: '…', label: '出場予定' },
  unknown: { sym: '—', label: '' },
}

export const PASSING: ResultKey[] = ['pass', 'seed_pass', 'champion']

export function isPassing(r: ResultKey | undefined): boolean {
  return r !== undefined && PASSING.includes(r)
}

/** その年に到達した最終回戦(敗者復活戦は本線扱いしない) */
export function furthestRound(results: Partial<Record<RoundKey, ResultKey>>): RoundKey | null {
  for (const rk of [...ROUND_ORDER].reverse()) {
    if (rk === 'playoff') continue
    if (results[rk]) return rk
  }
  return null
}

export function formatHits(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}億`
  if (n >= 10_000) return `${Math.round(n / 10_000)}万`
  return n.toLocaleString('ja-JP')
}
