import { Link } from 'react-router-dom'

import CareerRecords from '../components/CareerRecords'
import { JudgeCareerSection } from '../components/JudgesRecords'
import PopularityRanking from '../components/PopularityRanking'
import { RankTable, type RankRow } from '../components/RankTable'
import { useFinalsStats, useJudgesStats, usePeopleStats, useRankings } from '../lib/api'
import { sliceWithTies } from '../lib/rank'
import type { FinalsStats, StreakItem } from '../lib/types'

const SHOWN = 15 // 各ランキングの表示件数(境界の同点はすべて表示)

/** 連続出場: 最上位は「全大会皆勤」の大きな同値グループになるため、組数+全組リストで表示 */
function StreakSection({ streaks }: { streaks: StreakItem[] }) {
  if (streaks.length === 0) return null
  const maxVal = streaks[0].value
  const perfect = streaks.filter((s) => s.value === maxVal)
  const rest = streaks.filter((s) => s.value < maxVal)
  return (
    <>
      <h2 className="section-title">連続出場</h2>
      <p className="section-note">
        連続でエントリーした年数（公式コンビ情報の2015年以降。エントリー済みの2026年を含む）。 最長は
        {perfect[0].start}年から{maxVal}大会連続の{perfect.length}組。
      </p>
      <details className="streak-details">
        <summary>
          {maxVal}大会連続({perfect[0].start}〜{perfect[0].end})の全{perfect.length}組を表示
        </summary>
        <p className="streak-names">
          {perfect.map((s, i) => (
            <span key={s.id}>
              {i > 0 && '・'}
              <Link to={`/combi/${s.id}`}>{s.name}</Link>
            </span>
          ))}
        </p>
      </details>
      {rest.length > 0 && (
        <RankTable
          items={sliceWithTies(rest, SHOWN, (it) => it.value).map((s) => ({
            id: s.id,
            name: s.name,
            value: s.value,
            detail: s.value > 1 ? `${s.start}〜${s.end}` : `${s.end}`,
          }))}
          unit="年"
        />
      )}
    </>
  )
}

function FinalsRecords({ fs }: { fs: FinalsStats }) {
  return (
    <>
      <h2 className="section-title">最終決戦 最多進出</h2>
      <p className="section-note">全21大会(2001〜2025)の最終決戦(1本目上位2〜3組)に進んだ回数。同点は全組表示。</p>
      <RankTable
        items={sliceWithTies(fs.mostFinalRoundAppearances, SHOWN, (it) => it.value)}
        unit="回"
      />

      <h2 className="section-title">無冠の帝王(決勝最多進出・未優勝)</h2>
      <p className="section-note">
        決勝(ファーストラウンド)に2回以上進みながら優勝の無いコンビ。全21大会(2001〜2025)。同点は全組表示。
      </p>
      <RankTable items={sliceWithTies(fs.uncrownedKings, SHOWN, (it) => it.value)} unit="回" />

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
              <th>コンビ</th>
            </tr>
          </thead>
          <tbody>
            {fs.debutFinalists.map((d) => (
              <tr key={`${d.year}-${d.name}`}>
                <td className="no">{d.year}</td>
                <td>
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
              <th>コンビ</th>
              <th>得点</th>
              <th>偏差値</th>
            </tr>
          </thead>
          <tbody>
            {fs.deviationScores.map((d) => (
              <tr key={`${d.year}-${d.name}`}>
                <td className="no">{d.rank}</td>
                <td className="no">{d.year}</td>
                <td>{d.combiId != null ? <Link to={`/combi/${d.combiId}`}>{d.name}</Link> : d.name}</td>
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

export default function RankingsPage() {
  const { data, isLoading, isError } = useRankings()
  const { data: finalsStats } = useFinalsStats()
  const { data: judgesStats } = useJudgesStats()
  const { data: peopleStats } = usePeopleStats()
  if (isError) return <div className="error-box">ランキングを読み込めませんでした。</div>
  if (isLoading || !data) return <div className="loading">読み込み中…</div>

  const gridSections: { key: string; title: string; unit: string; note?: string; items: RankRow[] }[] = [
    ...(finalsStats
      ? [
          {
            key: 'mostFinalAppearances',
            title: '決勝 最多進出',
            unit: '回',
            note: '決勝(ファーストラウンド)に進んだ回数。全21大会(2001〜2025)',
            items: finalsStats.mostFinalAppearances,
          },
        ]
      : []),
    {
      key: 'mostQuarterfinals',
      title: '準々決勝 最多進出',
      unit: '回',
      note: '準々決勝に進んだ回数（勝ち上がりは問わない。2015年以降）',
      items: data.mostQuarterfinals,
    },
    {
      key: 'mostSemifinalFails',
      title: '準決勝 最多敗退',
      unit: '回',
      note: 'あと一歩の悲運ランキング（2015年以降）',
      items: data.mostSemifinalFails,
    },
    {
      key: 'mostFirstRoundFails',
      title: '1回戦 最多敗退',
      unit: '回',
      note: 'それでも挑み続けた記録（2015年以降）',
      items: data.mostFirstRoundFails,
    },
  ]

  return (
    <>
      <h1 className="page-title">記録ランキング</h1>
      <p className="page-lede">
        コンビ・人を順位付けするランキング。決勝の記録は2001年からの全期間、その他の通算記録は公式コンビ情報(2015年以降)から集計。
        各ランキング上位{SHOWN}組(同点は全組表示)。出番順・結成年数など傾向の分析は
        <Link to="/stats">統計</Link>へ。
      </p>
      <div className="rank-grid">
        {gridSections.map((s) => (
          <section key={s.key} className="rank-section">
            <h2 className="section-title">{s.title}</h2>
            {s.note && <p className="section-note">{s.note}</p>}
            <RankTable items={sliceWithTies(s.items, SHOWN, (it) => it.value)} unit={s.unit} />
          </section>
        ))}
      </div>
      <StreakSection streaks={data.longestStreaks} />
      {finalsStats && (
        <>
          <h1 className="page-title">決勝の記録</h1>
          <p className="page-lede">全21大会(2001〜2025)の決勝得点表・最終決戦データから集計。</p>
          <FinalsRecords fs={finalsStats} />
        </>
      )}
      {judgesStats && (
        <>
          <h1 className="page-title">審査員の記録</h1>
          <p className="page-lede">
            全21大会の決勝得点表から集計した審査員別の通算記録。年別の傾向は
            <Link to="/stats">統計</Link>へ。
          </p>
          <JudgeCareerSection js={judgesStats} />
        </>
      )}
      <PopularityRanking />
      {peopleStats && (
        <>
          <h1 className="page-title">キャリア・人物の記録</h1>
          <p className="page-lede">
            公式コンビ情報のプロフィール(生年月日・所属・職業・人数)から集計した人の記録。
          </p>
          <CareerRecords ps={peopleStats} />
        </>
      )}
    </>
  )
}
