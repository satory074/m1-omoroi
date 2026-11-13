// ランキング表示の共通ユーティリティ(記録・統計の各タブ共用)。

/** 先頭 n 件で切るが、境界値と同値の項目はすべて含める(同点を件数で切り捨てない)。 */
export function sliceWithTies<T>(items: T[], n: number, value: (item: T) => number): T[] {
  if (items.length <= n) return items
  const boundary = value(items[n - 1])
  let end = n
  while (end < items.length && value(items[end]) === boundary) end++
  return items.slice(0, end)
}

/** 標準競技順位 (1,1,3,…)。ソート済み配列に対して同値は同順位を返す。 */
export function competitionRanks<T>(items: T[], value: (item: T) => number): number[] {
  const ranks: number[] = []
  items.forEach((it, i) => {
    ranks.push(i > 0 && value(items[i - 1]) === value(it) ? ranks[i - 1] : i + 1)
  })
  return ranks
}

/**
 * 並べていない値の配列の標準競技順位(大きいほど上位。同値は同順位、数値でないものは null)。
 * 決勝得点表の合計・審査員ごと・あなたの列で使う(以前は FinalsScoreTable に同じ処理の写しがあった)。
 */
export function competitionRanksOf(vals: readonly (number | null | undefined)[]): (number | null)[] {
  const order = vals
    .map((_, i) => i)
    .filter((i) => typeof vals[i] === 'number')
    .sort((a, b) => (vals[b] as number) - (vals[a] as number))
  const ranks = new Array<number | null>(vals.length).fill(null)
  let lastVal: number | null = null
  let lastRank = 0
  order.forEach((idx, pos) => {
    if (lastVal === null || vals[idx] !== lastVal) {
      lastRank = pos + 1
      lastVal = vals[idx] as number
    }
    ranks[idx] = lastRank
  })
  return ranks
}
