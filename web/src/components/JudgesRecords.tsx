import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { JudgesStats } from '../lib/types'

/** 連続年をまとめて表示する: [2001..2010, 2016..2023] → "2001〜2010・2016〜2023" */
function compressYears(years: number[]): string {
  const runs: string[] = []
  let start = years[0]
  let prev = years[0]
  for (const y of years.slice(1).concat(NaN)) {
    if (y !== prev + 1) {
      runs.push(start === prev ? `${start}` : `${start}〜${prev}`)
      start = y
    }
    prev = y
  }
  return runs.join('・')
}

/** 審査員の通算記録(記録ランキングページ) */
export function JudgeCareerSection({ js }: { js: JudgesStats }) {
  return (
    <>
      <h2 className="section-title">審査員の通算記録</h2>
      <p className="section-note">
        審査員名は年により表記が違うため名寄せして通算(担当年数順)。
        点差 = 自分の点からその組への審査員平均点を引いた値の平均で、マイナスほど辛口・プラスほど甘口。
        最高点/最低点はその組に対して審査員の中で最高/最低の点を付けた回数(同点は全員に計上)。
        見る目 = 最終決戦で優勝コンビに投票した回数/投票機会。2001年の会場票(大阪・札幌・福岡)は含まない。
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>審査員</th>
              <th>担当</th>
              <th>採点数</th>
              <th>点差</th>
              <th>最高点</th>
              <th>最低点</th>
              <th>見る目</th>
            </tr>
          </thead>
          <tbody>
            {js.career.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td className="no" title={compressYears(c.years)}>
                  {c.yearCount}年
                </td>
                <td className="no">{c.scored}組</td>
                <td className="no">{c.avgDiff != null ? (c.avgDiff > 0 ? `+${c.avgDiff.toFixed(2)}` : c.avgDiff.toFixed(2)) : '—'}</td>
                <td className="no">{c.topCount}</td>
                <td className="no">{c.lowCount}</td>
                <td className="no">{c.votes > 0 ? `${c.champVotes}/${c.votes}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** 審査員の年別採点傾向+最終決戦の得票(統計ページ) */
export function JudgesYearlySection({ js }: { js: JudgesStats }) {
  const years = js.byYear.map((y) => y.year)
  const [year, setYear] = useState(years[years.length - 1])
  const yearRow = js.byYear.find((y) => y.year === year)
  const venueNote = js.venueColumns[String(year)]
  return (
    <>
      <h2 className="section-title">審査員の年別採点傾向</h2>
      <p className="section-note">
        平均差 = その審査員の平均点 − その年の審査員全体の平均点。最高点/最低点はその組に対して
        審査員の中で最高/最低の点を付けた回数(同点は全員に計上)。
        {venueNote && ` ${year}年の会場票(${venueNote.join('・')})は集計に含まない。`}
      </p>
      <div className="year-strip judges-year-strip">
        {[...years].reverse().map((y) => (
          <button key={y} className={y === year ? 'active' : ''} onClick={() => setYear(y)}>
            {y}
          </button>
        ))}
      </div>
      {yearRow && (
        <div className="history-wrap">
          <table className="history">
            <thead>
              <tr>
                <th>審査員</th>
                <th>平均点</th>
                <th>平均差</th>
                <th>最高点</th>
                <th>最低点</th>
                <th>点の幅</th>
              </tr>
            </thead>
            <tbody>
              {[...yearRow.judges]
                .sort((a, b) => b.mean - a.mean)
                .map((j) => (
                  <tr key={j.name}>
                    <td>{j.canonical}</td>
                    <td className="no">{j.mean.toFixed(1)}</td>
                    <td className="no">{j.diff > 0 ? `+${j.diff.toFixed(1)}` : j.diff.toFixed(1)}</td>
                    <td className="no">{j.top}回</td>
                    <td className="no">{j.low}回</td>
                    <td className="no">
                      {j.min}〜{j.max}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {yearRow && <p className="legend">審査員全体の平均点: {yearRow.judgeMean.toFixed(1)}</p>}

      <h2 className="section-title">最終決戦の得票(満場一致と接戦)</h2>
      <p className="section-note">
        最終決戦の得票の割れ方。★=全票一致での優勝、票差1は最接戦。2020年は3組に票が割れた唯一の年。
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>年</th>
              <th>王者</th>
              <th>得票</th>
              <th>票差</th>
            </tr>
          </thead>
          <tbody>
            {[...js.finalVotes].reverse().map((r) => (
              <tr key={r.year}>
                <td className="no">{r.year}</td>
                <td>
                  {r.championCombiId != null ? (
                    <Link to={`/combi/${r.championCombiId}`}>{r.champion}</Link>
                  ) : (
                    r.champion
                  )}
                  {r.unanimous && ' ★満場一致'}
                </td>
                <td className="no">{r.votes.join(' - ')}</td>
                <td className="no">{r.margin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
