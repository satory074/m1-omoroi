// URL のパラメーターを検証する。数字でないもの(/years/abc 等)を「見つからない」として扱うため。
// 以前は Number('abc') = NaN のまま取得を止め、「読み込み中…」が永久に出ていた。

/** 4桁の年なら数値、それ以外は null */
export function parseYear(param: string | undefined): number | null {
  return param && /^\d{4}$/.test(param) ? Number(param) : null
}

/** 正の整数の ID なら数値、それ以外は null */
export function parseId(param: string | undefined): number | null {
  return param && /^\d{1,7}$/.test(param) ? Number(param) : null
}
