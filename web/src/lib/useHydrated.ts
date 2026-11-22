import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * 事前描画した HTML を引き継いでいる最中(hydrate の最初の描画)とサーバーでの描画では false、それ以外は true。
 * hydrate の最初の描画は HTML と一字一句同じでなければならないので、端末ごとに違う値(localStorage の採点、
 * CSS から読む色など)や、HTML に出したくないもの(まだページの無いコンビ詳細へのリンク)はこれが true に
 * なってから出す。true になると React がすぐ描き直す。画面を移った後や createRoot では最初から true。
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
