import type { RoundKey, TverItem, TverLikes } from './types'

/**
 * TVer のいいね数(ワイルドカード争いの参考値)の表示用。
 * 審査は M-1 の LINE ミニアプリの1人1票で、途中経過は公開されない。この数は投票数ではないので、
 * 出すときは必ず「TVer」と出典・時点を添える(サイト独自の ♡ いいねと混ざらないように)。
 */

export const WILDCARD_URL = 'https://www.m-1gp.com/wildcard/'

export function tverEpisodeUrl(ep: string): string {
  return `https://tver.jp/episodes/${ep}`
}

/** その年・その回戦のいいね数を持っているか */
export function hasTverFor(t: TverLikes | null | undefined, year: number, round: RoundKey): t is TverLikes {
  return !!t && t.year === year && t.round === round && Object.keys(t.items).length > 0
}

export function tverItem(t: TverLikes | null | undefined, id: number | null): TverItem | undefined {
  return id != null ? t?.items[String(id)] : undefined
}

/** 締切を過ぎたか(最終値を取る前でも、締切後は伸びを出さない) */
export function tverClosed(t: TverLikes, now: number = Date.now()): boolean {
  return t.final || (t.deadline != null && now > Date.parse(t.deadline))
}

/** "2026-11-23T11:55+09:00" → "11/23 11:55"。日本時間で書かれた文字列をそのまま読む(端末の時刻帯に依らない) */
export function formatTverAt(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[1])}/${Number(m[2])} ${m[3]}:${m[4]}`
}

/** 24時間の伸び「+120」。CI が遅れて幅が24時間から2時間以上ずれたら「+120/22時間」 */
export function tverGrowthLabel(item: TverItem): string | null {
  if (item.d == null || item.h == null) return null
  const sign = item.d >= 0 ? '+' : '−'
  const n = `${sign}${Math.abs(item.d).toLocaleString('ja-JP')}`
  return Math.abs(item.h - 24) >= 2 ? `${n}/${item.h}時間` : n
}
