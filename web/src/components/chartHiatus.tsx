import { ReferenceArea } from 'recharts'

/** 大会が開かれなかった年(グラフでは空白として描き、年を詰めない) */
export const HIATUS = [2011, 2012, 2013, 2014]

/**
 * 年の軸に休止の年を挟んで昇順に並べる。年を詰めると 2010→2015 が隣り合って時間の幅が歪んで見えるため、
 * 休止の年も軸に置き、値は空(null)にする。記録・統計の年ごとのグラフで共用する。
 */
export function yearsWithHiatus(years: number[]): number[] {
  return [...new Set([...years, ...HIATUS])].sort((a, b) => a - b)
}

/**
 * 休止の年を塗る面。グラフの子として直接置く(`{hiatusArea(...)}`)。
 * 色は呼び出し側が useTokens で読んだ値を渡す(色の直書きをしないため)。
 */
export function hiatusArea(fill: string, labelColor: string) {
  return (
    <ReferenceArea
      x1={String(HIATUS[0])}
      x2={String(HIATUS[HIATUS.length - 1])}
      fill={fill}
      fillOpacity={1}
      label={{ value: '休止', position: 'insideTop', fill: labelColor, fontSize: 12 }}
    />
  )
}
