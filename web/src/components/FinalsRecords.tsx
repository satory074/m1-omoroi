import { Link } from 'react-router-dom'

import { sliceWithTies } from '../lib/rank'
import type { FinalsStats } from '../lib/types'
import { RankTable } from './RankTable'

const SHOWN = 15 // 各ランキングの表示件数(境界の同点はすべて表示)

/** 記録・統計「決勝」タブの前半: コンビを順位付けする決勝の記録(finals_stats.json)。後半の傾向は FinalsTrends */
export default function FinalsRecords({ fs }: { fs: FinalsStats }) {
  return (
    <>
      <div className="rank-grid">
        <section className="rank-section">
          <h2 className="section-title">決勝 最多進出</h2>
          <p className="section-note">決勝(ファーストラウンド)に進んだ回数。全21大会(2001〜2025)</p>
          <RankTable items={sliceWithTies(fs.mostFinalAppearances, SHOWN, (it) => it.value)} unit="回" />
        </section>
        <section className="rank-section">
          <h2 className="section-title">最終決戦 最多進出</h2>
          <p className="section-note">最終決戦(1本目上位2〜3組)に進んだ回数。全21大会(2001〜2025)</p>
          <RankTable
            items={sliceWithTies(fs.mostFinalRoundAppearances, SHOWN, (it) => it.value)}
            unit="回"
          />
        </section>
        <section className="rank-section">
          <h2 className="section-title">無冠の帝王(決勝最多進出・未優勝)</h2>
          <p className="section-note">決勝に2回以上進みながら優勝の無いコンビ。全21大会(2001〜2025)</p>
          <RankTable items={sliceWithTies(fs.uncrownedKings, SHOWN, (it) => it.value)} unit="回" />
        </section>
      </div>
      <p className="section-note">各ランキング上位{SHOWN}組(同点は全組表示)。</p>

      <h2 className="section-title">初出場で決勝進出</h2>
      <p className="section-note">
        初エントリーの年にいきなり決勝へ進んだコンビ。第1回(2001年)は全組が初出場のため対象外。
        ※印は2001〜2010に1回戦敗退などの記録が残らないため「記録に残る範囲での初出場」。
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>年</th>
              <th className="sticky-name">コンビ</th>
            </tr>
          </thead>
          <tbody>
            {fs.debutFinalists.map((d) => (
              <tr key={`${d.year}-${d.name}`}>
                <td className="no">{d.year}</td>
                <td className="sticky-name">
                  {d.combiId != null ? <Link to={`/combi/${d.combiId}`}>{d.name}</Link> : d.name}
                  {d.recordedOnly && ' ※'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">歴代スコアランキング(得点偏差値)</h2>
      <p className="section-note">
        偏差値 = その年のファーストラウンド得点内での (得点−平均)÷標準偏差×10+50。
        審査員数・満点(2001年は1000点満点)・採点の辛さが違う年をまたいで比較するための正規化。
        全{new Set(fs.deviationScores.map((d) => d.year)).size}大会の決勝進出全組を表示。
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>順位</th>
              <th>年</th>
              <th className="sticky-name">コンビ</th>
              <th>得点</th>
              <th>偏差値</th>
            </tr>
          </thead>
          <tbody>
            {fs.deviationScores.map((d) => (
              <tr key={`${d.year}-${d.name}`}>
                <td className="no">{d.rank}</td>
                <td className="no">{d.year}</td>
                <td className="sticky-name">{d.combiId != null ? <Link to={`/combi/${d.combiId}`}>{d.name}</Link> : d.name}</td>
                <td className="no">{d.total}</td>
                <td className="no">{d.deviation.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
