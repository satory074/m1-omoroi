import { Link } from 'react-router-dom'

import { ROUND_LABEL } from '../lib/rounds'
import type { AgeRecordRow, PeopleStats, ReachRow } from '../lib/types'
import { RankTable } from './RankTable'

function ageRows(rows: AgeRecordRow[]) {
  return rows.map((r) => ({
    id: r.combiId,
    name: `${r.member ?? '?'}（${r.combi}）`,
    value: r.age,
    detail: `${r.year}年`,
  }))
}

function ReachTable({ rows }: { rows: ReachRow[] }) {
  return (
    <div className="history-wrap">
      <table className="history">
        <thead>
          <tr>
            <th>最高到達</th>
            <th>コンビ</th>
            <th>到達年</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{ROUND_LABEL[r.bestRound]}</td>
              <td>
                <Link to={`/combi/${r.id}`}>{r.name}</Link>
              </td>
              <td className="no">{r.years.join('・')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** キャリア・人物の記録(最年少最年長・年齢差・アマチュア・職業別・トリオ) */
export default function CareerRecords({ ps }: { ps: PeopleStats }) {
  const ageGroups = [
    { key: 'appearance', title: '出場' },
    { key: 'final', title: '決勝進出' },
    { key: 'champion', title: '優勝' },
  ] as const
  return (
    <>
      <h2 className="section-title">最年少・最年長の記録</h2>
      <p className="section-note">
        公式コンビ情報の生年月日(自己申告)から算出。出場は「大会年 −
        生年」の近似(年末時点の満年齢)、決勝進出・優勝は決勝開催日時点の満年齢。同一人物は極値1件に集約、上位10+同点。
        {ps.ageExcluded > 0 && ` 明らかに不自然な年齢の${ps.ageExcluded}名は除外。`}
        生年月日が未登録のメンバー(2001〜2010の多く)は対象外。
      </p>
      <div className="rank-grid">
        {ageGroups.flatMap((g) => [
          <section key={`${g.key}-young`} className="rank-section">
            <h2 className="section-title">最年少{g.title}</h2>
            <RankTable items={ageRows(ps.ageRecords[g.key].youngest)} unit="歳" />
          </section>,
          <section key={`${g.key}-old`} className="rank-section">
            <h2 className="section-title">最年長{g.title}</h2>
            <RankTable items={ageRows(ps.ageRecords[g.key].oldest)} unit="歳" />
          </section>,
        ])}
      </div>

      <h2 className="section-title">コンビ内の年齢差</h2>
      <p className="section-note">
        メンバー間の歳の差(年下が生まれた時点での年上の満年齢)。自己申告ノイズを避けるため準々決勝以上に到達した組のみ。
      </p>
      <RankTable
        items={ps.ageGap.map((g) => ({
          id: g.id,
          name: g.name,
          value: g.gapYears,
          detail: `${g.older ?? '?'}・${g.younger ?? '?'}（最高到達: ${ROUND_LABEL[g.bestRound]}）`,
        }))}
        unit="歳差"
      />

      <h2 className="section-title">アマチュアの最高到達</h2>
      <p className="section-note">
        所属が「アマチュア」で準々決勝以上に到達した組(所属は現在の登録区分。出場当時と異なる場合あり)。
      </p>
      <ReachTable rows={ps.amateur} />

      <h2 className="section-title">職業別の最高到達</h2>
      <p className="section-note">
        メンバーの職業(公式コンビ情報、2015年以降のみ)ごとの最高到達。コンビは各メンバーの職業すべてに数える。
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>職業</th>
              <th>最高到達</th>
              <th>組数</th>
              <th>コンビ(到達年)</th>
            </tr>
          </thead>
          <tbody>
            {ps.jobs.map((j) => (
              <tr key={j.job}>
                <td>{j.job}</td>
                <td>{ROUND_LABEL[j.bestRound]}</td>
                <td className="no">{j.count}</td>
                <td>
                  {j.combis.map((c, i) => (
                    <span key={c.id} className="winner-item">
                      {i > 0 && '・'}
                      <Link to={`/combi/${c.id}`}>{c.name}</Link>({c.year})
                    </span>
                  ))}
                  {j.count > j.combis.length && ' ほか'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">トリオの記録</h2>
      <p className="section-note">
        3人組で3回戦以上に到達した組。人数は公式コンビ情報の現行登録(結成・出場当時と異なる場合あり。例:
        2006年決勝のザ・プラン９は当時5人組)。
      </p>
      <ReachTable rows={ps.trio} />
    </>
  )
}
