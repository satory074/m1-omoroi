import type { OfficialVideoLink, OfficialVideos, RoundKey } from './types'

/** データが無いときの既定(official_videos.json の channel と同じ) */
export const OFFICIAL_CHANNEL_URL = 'https://www.youtube.com/@m1grandprix'

export const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`
export const playlistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`

/** そのコンビのその年・その回戦の公式動画(無ければ空配列) */
export function combiVideos(
  data: OfficialVideos | null | undefined,
  year: number,
  combiId: number | null,
  round: RoundKey,
): OfficialVideoLink[] {
  if (!data || combiId == null) return []
  return data.years[String(year)]?.combis[String(combiId)]?.[round] ?? []
}

/** ツールチップ用: 「公式YouTube・3回戦ネタ・11/3(火) 東京 KANDA SQUARE HALL・2組目」 */
export function videoLabel(link: OfficialVideoLink): string {
  return ['公式YouTube', link.k, link.at, link.p].filter(Boolean).join('・')
}
