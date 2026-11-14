import { formatDay } from '../lib/schedule'
import type { ScheduleVenue } from '../lib/types'

/**
 * 選んだ回戦の日程(M-1公式サイトの会場JSON由来、data/schedule.json)。会場ごとに1行:
 *   11/18(水) 18:30開演 大阪 なんばグランド花月 MC ギャロップ 36組
 * 出場者がまだ居ない回戦(detailed)は一覧が無く場所が空くので開場時刻も出す。
 * 終わった日は文字を補助色にし、色だけに頼らないよう「終了」とも書く。
 */
export default function RoundSchedule({
  venues,
  today,
  url,
  detailed,
}: {
  venues: ScheduleVenue[]
  /** 日本時間の今日(YYYY-MM-DD) */
  today: string
  /** 公式の日程ページ */
  url: string
  detailed: boolean
}) {
  return (
    <section className="round-schedule" aria-label="日程">
      <span className="round-schedule-head" aria-hidden="true">
        日程
      </span>
      <ul className="round-schedule-list">
        {venues.map((v) => {
          const past = v.date < today
          return (
            <li key={v.id} className={past ? 'is-past' : undefined}>
              <span className="rs-day">{formatDay(v)}</span>
              {v.start && (
                <span>
                  {detailed && v.open ? `${v.open}開場 ` : ''}
                  {v.start}開演
                </span>
              )}
              <span>
                {v.area && `${v.area} `}
                {v.place ?? '会場は調整中'}
              </span>
              {v.mc && <span>MC {v.mc}</span>}
              {v.entrants > 0 && <span>{v.entrants.toLocaleString('ja-JP')}組</span>}
              {past && <span className="rs-done">終了</span>}
            </li>
          )
        })}
      </ul>
      <a className="round-schedule-src" href={url} target="_blank" rel="noopener noreferrer">
        公式の日程
      </a>
    </section>
  )
}
