import { ROUND_ORDER } from './rounds'
import type { RoundKey, ScheduleFile, ScheduleVenue } from './types'

/** 公式の日程ページ(データが無いときの既定。schedule.json の url と同じ) */
export const SCHEDULE_PAGE_URL = 'https://www.m-1gp.com/schedule/'

/** 「11/18(水)」 */
export function formatDay(v: Pick<ScheduleVenue, 'date' | 'wd'>): string {
  const [, m, d] = v.date.split('-')
  return `${Number(m)}/${Number(d)}(${v.wd})`
}

/** 回戦ナビの短い日付。1日なら「12/3(木)」、複数日なら「11/18〜20」(月をまたげば「11/30〜12/1」) */
export function roundDateLabel(venues: ScheduleVenue[]): string {
  const days = [...new Set(venues.map((v) => v.date))].sort()
  if (days.length === 0) return ''
  const first = venues.find((v) => v.date === days[0])!
  if (days.length === 1) return formatDay(first)
  const [, m1, d1] = days[0].split('-').map(Number)
  const [, m2, d2] = days[days.length - 1].split('-').map(Number)
  return m1 === m2 ? `${m1}/${d1}〜${d2}` : `${m1}/${d1}〜${m2}/${d2}`
}

/** 日本時間の今日(YYYY-MM-DD)。日程の「次は」「終わった日」の判定に使う */
export function todayJst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

/** その回戦の会場(日付順)。その年の日程が無ければ空 */
export function roundVenues(s: ScheduleFile | null | undefined, year: number, round: RoundKey): ScheduleVenue[] {
  if (!s || s.year !== year) return []
  return s.rounds[round] ?? []
}

/** 今日以降で最初の会場(当日を含む)。無ければ null */
export function nextVenue(
  s: ScheduleFile | null | undefined,
  year: number,
  today: string,
): { round: RoundKey; venue: ScheduleVenue } | null {
  if (!s || s.year !== year) return null
  for (const round of ROUND_ORDER) {
    const venue = (s.rounds[round] ?? []).find((v) => v.date >= today)
    if (venue) return { round, venue }
  }
  return null
}

/** そのコンビのその回戦の出番の会場。分からなければ null */
export function combiVenue(
  s: ScheduleFile | null | undefined,
  year: number,
  combiId: number | null,
  round: RoundKey,
): ScheduleVenue | null {
  if (!s || s.year !== year || combiId == null) return null
  const vid = s.combis[String(combiId)]?.[round]
  if (!vid) return null
  return s.rounds[round]?.find((v) => v.id === vid) ?? null
}
