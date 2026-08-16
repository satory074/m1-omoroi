// ランキング表示の共通ユーティリティ(記録ランキング/統計ページ共用)。

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
