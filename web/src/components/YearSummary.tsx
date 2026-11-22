import { ROUND_LABEL } from '../lib/rounds'
import type { YearSummary as Summary } from '../lib/types'
import CombiLink from './CombiLink'

const fmt = (n: number) => n.toLocaleString('ja-JP')

/**
 * 年度ページの「{年}年の勝ち上がり」。決勝・準決勝・準々決勝に進んだ組の名前と、回戦ごとの組数。
 * 年度ファイル(最大1.7MB)ではなく数KBの要約(years/{年}.summary.json)から描くので、年度ファイルを
 * 待たずに出せ、事前描画した HTML にも入る(JavaScript を実行しないクローラーにも読める)。
 * 一覧より上を詰めるため(スマホで最初の画面から一覧が見えるように)、普段は1行に畳んでおく。
 */
export default function YearSummary({ summary }: { summary: Summary }) {
  if (summary.reached.length === 0 && summary.rounds.length === 0) return null
  return (
    <details className="note year-summary">
      <summary>
        <span className="note-label">{summary.year}年の勝ち上がり</span>
      </summary>
      <div className="year-summary-body">
        {summary.reached.length > 0 && (
          <dl className="year-summary-groups">
            {summary.reached.map((g) => (
              <div key={g.round} className="year-summary-group">
                <dt>
                  {ROUND_LABEL[g.round]}進出 <small>{g.combis.length}組</small>
                </dt>
                <dd>
                  <ul className="year-summary-names">
                    {g.combis.map((c) => (
                      <li key={c.id ?? c.name}>
                        <CombiLink id={c.id}>{c.name}</CombiLink>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="year-summary-rounds">
          回戦ごとの組数:{' '}
          {summary.rounds
            .map((r) => `${ROUND_LABEL[r.round]} ${fmt(r.appeared)}組${r.passed > 0 ? `(通過 ${fmt(r.passed)})` : ''}`)
            .join('、')}
          。名前は五十音順です。
        </p>
      </div>
    </details>
  )
}
