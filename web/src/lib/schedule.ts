import { ROUND_ORDER } from './rounds'
import type { RoundKey, ScheduleFile, ScheduleRoundFile, ScheduleVenue } from './types'

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

/** 1組の出番。n = 会場の中で何組目か(1始まり、欠席は数えない) */
export interface Slot {
  venue: ScheduleVenue
  n: number
}

/** 出番の引き当て。組ごとに、その回戦で出番のある会場の一覧(日付順。1回戦は再エントリーで2つのことがある) */
export type SlotIndex = Map<number, Slot[]>

export function buildSlots(venues: ScheduleVenue[], file: ScheduleRoundFile | null | undefined): SlotIndex {
  const index: SlotIndex = new Map()
  if (!file) return index
  // venues は日付順(build が並べている)。この順で足すので、組ごとの一覧も日付順になる
  for (const venue of venues) {
    const ids = file[venue.id]
    if (!ids) continue
    ids.forEach((id, i) => {
      const slot = { venue, n: i + 1 }
      const list = index.get(id)
      if (list) list.push(slot)
      else index.set(id, [slot])
    })
  }
  return index
}

/**
 * 行に出す出番。会場で絞っていればその会場の出番、絞っていなければ遅い方(1回戦の再エントリーなら、
 * その年の結果を決めた方)。出番が無ければ null
 */
export function slotFor(index: SlotIndex, id: number | null, venueId: string | null): Slot | null {
  if (id == null) return null
  const list = index.get(id)
  if (!list) return null
  if (venueId) return list.find((s) => s.venue.id === venueId) ?? null
  return list[list.length - 1]
}

/** 「11/18(水) 大阪 13組目」 */
export function slotLabel(slot: Slot): string {
  return `${formatDay(slot.venue)}${slot.venue.area ? ` ${slot.venue.area}` : ''} ${slot.n}組目`
}
