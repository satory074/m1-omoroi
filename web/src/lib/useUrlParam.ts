import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * URL のクエリ1つを、画面の状態として読み書きする(絞り込み・並び替え・表示の切り替え)。
 * URL に持たせると、戻る/進む・再読み込み・共有で状態が保たれる。
 *   - 既定値のときはクエリから消す(URL を短く保つ)
 *   - 書き込みは replace(履歴を増やさない)+ preventScrollReset(同じページなので先頭へ飛ばさない)
 *   - 切り替えたら focus(コンビ詳細から来たときの「この組へ移る」)は役目を終えるので消す
 * 検索パネルの q / tab / qsort には触らない(ヘッダー常駐の検索が使っている)。
 */
export function useUrlParam<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const value = raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback

  const set = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === fallback) p.delete(key)
          else p.set(key, next)
          p.delete('focus')
          return p
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [key, fallback, setParams],
  )

  return [value, set]
}
