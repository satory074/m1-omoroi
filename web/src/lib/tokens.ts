// CSS のトークン(src/styles/tokens/theme.css の --c-*)を JS から読む。
// recharts は SVG の属性に色を渡すため var() を確実には使えない。そこで描画前に実際の値を読んで渡す。
// 値はページの読み込み中に変わらないので、一度読んだらモジュール内に覚えておく。
import { useMemo } from 'react'

const cache = new Map<string, string>()

export function readToken(name: `--${string}`): string {
  const hit = cache.get(name)
  if (hit !== undefined) return hit
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (value) cache.set(name, value)
  return value
}

export function useTokens<const T extends readonly `--${string}`[]>(names: T): Record<T[number], string> {
  const key = names.join(',')
  return useMemo(
    () => Object.fromEntries(names.map((n) => [n, readToken(n)])) as Record<T[number], string>,
    // names は呼び出し側で定数の配列を渡す前提。中身が同じなら作り直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
}

/** '#rrggbb' を [r, g, b] に。色の補間(地図の濃淡など)用 */
export function hexToRgb(hex: string): [number, number, number] {
  // CSS がまだ読めていない(値が空)などで読めないときは黒として扱う(描画は崩さない)
  if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim())) return [0, 0, 0]
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}
