import { Link } from 'react-router-dom'

import { sliceWithTies } from '../lib/rank'
import { RESULT_DISPLAY, ROUND_LABEL } from '../lib/rounds'
import type { LastYearEntrants, Rankings, StreakItem } from '../lib/types'
import BestChip from './BestChip'
import CombiLink from './CombiLink'
import HistoryTable from './HistoryTable'
import { RankTable, type RankRow } from './RankTable'

const SHOWN = 15 // 各ランキングの表示件数(境界の同点はすべて表示)

/** 連続出場: 最上位は「全大会皆勤」の大きな同値グループになるため、組数+全組リストで表示(折り畳まない) */
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
      <div className="streak-box">
        <p className="streak-head">
          {maxVal}大会連続({perfect[0].start}〜{perfect[0].end})の全{perfect.length}組
        </p>
        <p className="streak-names">
          {perfect.map((s, i) => (
            <span key={s.id}>
              {i > 0 && '・'}
              <Link to={`/combi/${s.id}`}>{s.name}</Link>
            </span>
          ))}
        </p>
      </div>
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

/**
 * 最新の年がラストイヤー(出場資格の最後の年)の組と、その年にどこまで進んだか。
 * シーズン中に「ラストイヤーの組がどこまで残っているか」を見るためのもの。回戦のセルは年度一覧のその組の行へ飛ぶ
 */
function LastYearSection({ ly }: { ly: LastYearEntrants | null }) {
  if (!ly || ly.combis.length === 0) return null
  return (
    <>
      <h2 className="section-title">{ly.year}年がラストイヤーの組</h2>
      <p className="section-note">
        結成{ly.formed}年の組は、{ly.year}年が出場資格(結成{ly.limit}年以内)の最後の年です。{ly.year}年にエントリーした
        {ly.combis.length}組が、今年どこまで進んだかを、進んだ回戦の深い順に並べています。
      </p>
      <HistoryTable caption={`${ly.year}年がラストイヤーの組`}>
        <thead>
          <tr>
            <th scope="col" className="sticky-name">
              コンビ
            </th>
            <th scope="col">{ly.year}年</th>
            <th scope="col">通算の最高</th>
          </tr>
        </thead>
        <tbody>
          {ly.combis.map((c) => (
            <tr key={c.id}>
              <td className="sticky-name">
                <CombiLink id={c.id}>{c.name}</CombiLink>
              </td>
              <td>
                {c.round ? (
                  <Link className="cell-target" to={`/years/${ly.year}?round=${c.round}&focus=${c.id}`}>
                    {ROUND_LABEL[c.round]}
                    {c.result && RESULT_DISPLAY[c.result].label && ` ${RESULT_DISPLAY[c.result].label}`}
                  </Link>
                ) : (
                  '結果待ち'
                )}
              </td>
              <td>
                <BestChip level={c.best} />
              </td>
            </tr>
          ))}
        </tbody>
      </HistoryTable>
    </>
  )
}

/** 記録・統計「コンビ」タブ: 公式コンビ情報(2015年以降)の通算記録(rankings.json) */
export default function CombiRecords({ data }: { data: Rankings }) {
  const sections: { key: string; title: string; unit: string; note?: string; items: RankRow[] }[] = [
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
      <LastYearSection ly={data.lastYearEntrants} />
      <div className="rank-grid">
        {sections.map((s) => (
          <section key={s.key} className="rank-section">
            <h2 className="section-title">{s.title}</h2>
            {s.note && <p className="section-note">{s.note}</p>}
            <RankTable items={sliceWithTies(s.items, SHOWN, (it) => it.value)} unit={s.unit} />
          </section>
        ))}
      </div>
      <StreakSection streaks={data.longestStreaks} />
    </>
  )
}
