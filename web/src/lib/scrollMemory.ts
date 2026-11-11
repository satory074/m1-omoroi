/**
 * ページ内の「内側スクロール」(年度一覧の仮想リスト)の位置を、履歴エントリーごとに覚える。
 * ウィンドウのスクロールは App.tsx の <ScrollRestoration /> が扱うが、それは window しか見ないため。
 *
 * キーは location.key(戻る/進むで同じエントリーに戻ると同じ値になる)。値はピクセルではなく
 * 「先頭に見えている行の番号」— 狭幅は名前の折り返しで行高が変わり、作り直した仮想リストでは
 * 実測前の見積もり高さで並ぶため、ピクセルで戻すと行がずれる。
 *
 * メモリ上の Map を正とし、sessionStorage にも写す(再読み込み後の戻るにも効かせるため)。
 * sessionStorage はプライベートモード等で例外を投げるので、失敗しても Map だけで動く。
 */
const PREFIX = 'm1:scroll-row:'
const memory = new Map<string, number>()

export function saveRow(key: string, row: number): void {
  if (memory.get(key) === row) return
  memory.set(key, row)
  try {
    sessionStorage.setItem(PREFIX + key, String(row))
  } catch {
    // 保存できなくても、このタブを開いている間は Map で戻せる
  }
}

export function loadRow(key: string): number | null {
  const hit = memory.get(key)
  if (hit != null) return hit
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    const n = raw == null ? NaN : Number(raw)
    return Number.isInteger(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}
