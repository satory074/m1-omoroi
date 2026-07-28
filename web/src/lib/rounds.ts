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

export const RESULT_DISPLAY: Record<ResultKey, { sym: string; label: string }> = {
  pass: { sym: '○', label: '通過' },
  seed_pass: { sym: '◎', label: 'シード通過' },
  fail: { sym: '×', label: '敗退' },
  fail_inferred: { sym: '×', label: '敗退' },
  champion: { sym: '★', label: '優勝' },
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
