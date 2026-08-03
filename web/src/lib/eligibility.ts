// M-1の出場資格(結成年数)まわりの導出。
// 満経過年数 = 大会年 − 結成年。公式「結成N年以内」と同じ数え方で、
// ラストイヤー = 満経過年数がその年の上限に一致する年。
//   第1期 2001–2010: 結成10年以内 (例: 笑い飯 2000結成 → 2010がラストイヤー)
//   第2期 2015–現在: 結成15年以内 (例: かまいたち 2004結成 → 2019がラストイヤー)

export function m1LimitYears(year: number): number {
  return year <= 2010 ? 10 : 15
}

/** null を返したら「結成年不明などで表示しない」。 */
export function formationInfo(
  year: number,
  formed: number | null | undefined,
): { years: number; isLastYear: boolean } | null {
  if (formed == null) return null
  const years = year - formed
  if (years < 0) return null // 結成が大会より後(データ異常)は非表示
  return { years, isLastYear: years === m1LimitYears(year) }
}
