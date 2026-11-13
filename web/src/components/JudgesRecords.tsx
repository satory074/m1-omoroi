import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type { JudgePickCombi, JudgesStats } from '../lib/types'
import { useUrlParam } from '../lib/useUrlParam'
import HistoryTable from './HistoryTable'
import ScrollNav, { type ScrollNavItem } from './ScrollNav'

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

/** 審査員の通算記録(記録・統計の「審査員」タブ) */
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
      <HistoryTable caption="審査員の通算記録">
          <thead>
            <tr>
              <th scope="col" className="sticky-name">審査員</th>
              <th scope="col">担当</th>
              <th scope="col">採点数</th>
              <th scope="col">点差</th>
              <th scope="col">最高点</th>
              <th scope="col">最低点</th>
              <th scope="col">見る目</th>
            </tr>
          </thead>
          <tbody>
            {js.career.map((c) => (
              <tr key={c.name}>
                <td className="sticky-name">{c.name}</td>
                <td className="no">
                  {c.yearCount}年
                  <span className="cell-note">{compressYears(c.years)}</span>
                </td>
                <td className="no">{c.scored}組</td>
                <td className="no">{c.avgDiff != null ? (c.avgDiff > 0 ? `+${c.avgDiff.toFixed(2)}` : c.avgDiff.toFixed(2)) : '—'}</td>
                <td className="no">{c.topCount}</td>
                <td className="no">{c.lowCount}</td>
                <td className="no">{c.votes > 0 ? `${c.champVotes}/${c.votes}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </HistoryTable>
    </>
  )
}

/** 「点数 + その点を付けた組」のセル。同点は全組を「・」で並べ、その年の王者には「王者」の印(以前は👑の絵文字だけ) */
function PickCell({
  score,
  combis,
  championId,
}: {
  score: number
  combis: JudgePickCombi[]
  championId: number | null
}) {
  return (
    <td className="judge-pick">
      <span className="pick-score">{score}</span>
      {combis.map((c, i) => (
        <span key={`${c.name}-${i}`} className="winner-item">
          {i > 0 && '・'}
          {c.combiId != null ? <Link to={`/combi/${c.combiId}`}>{c.name}</Link> : c.name}
          {c.combiId != null && c.combiId === championId && <span className="chip chip-champion">王者</span>}
        </span>
      ))}
    </td>
  )
}

/** 審査員の年別採点傾向+最終決戦の得票(記録・統計の「審査員」タブ) */
export function JudgesYearlySection({ js }: { js: JudgesStats }) {
  const years = js.byYear.map((y) => y.year)
  const yearKeys = useMemo(() => years.map(String), [years])
  // 年は URL(?year=)に持たせる。戻る・共有で選んだ年が保たれる
  const [yearKey] = useUrlParam<string>('year', yearKeys[yearKeys.length - 1], yearKeys)
  const year = Number(yearKey)
  const [params] = useSearchParams()
  const yearItems: ScrollNavItem[] = [...years].reverse().map((y) => {
    const p = new URLSearchParams(params)
    p.set('year', String(y))
    return { key: String(y), to: { search: `?${p}` }, label: y, current: y === year, inPage: true }
  })
  const yearRow = js.byYear.find((y) => y.year === year)
  const venueNote = js.venueColumns[String(year)]
  // その年の王者IDは finalVotes から引く(全年 championCombiId が入っている)
  const championId = js.finalVotes.find((v) => v.year === year)?.championCombiId ?? null
  return (
    <>
      <h2 className="section-title">審査員の年別採点傾向</h2>
      <p className="section-note">
        平均差 = その審査員の平均点 − その年の審査員全体の平均点。最高点回数/最低点回数はその組に対して
        審査員の中で最高/最低の点を付けた回数(同点は全員に計上)。
        自己最高点/自己最低点 = その審査員がその年に最も高く/低く評価した組(同点は全組)で、
        「王者」の印はその年の優勝コンビ。
        {venueNote && ` ${year}年の会場票(${venueNote.join('・')})は集計に含まない。`}
      </p>
      <ScrollNav label="年" variant="pills" items={yearItems} />
      {yearRow && (
        <HistoryTable caption={`${year}年 審査員の採点傾向`}>
            <thead>
              <tr>
                <th scope="col" className="sticky-name">審査員</th>
                <th scope="col">平均点</th>
                <th scope="col">平均差</th>
                <th scope="col">最高点回数</th>
                <th scope="col">最低点回数</th>
                <th scope="col">自己最高点</th>
                <th scope="col">自己最低点</th>
              </tr>
            </thead>
            <tbody>
              {[...yearRow.judges]
                .sort((a, b) => b.mean - a.mean)
                .map((j) => (
                  <tr key={j.name}>
                    <td className="sticky-name">{j.canonical}</td>
                    <td className="no">{j.mean.toFixed(1)}</td>
                    <td className="no">{j.diff > 0 ? `+${j.diff.toFixed(1)}` : j.diff.toFixed(1)}</td>
                    <td className="no">{j.top}回</td>
                    <td className="no">{j.low}回</td>
                    <PickCell score={j.max} combis={j.maxCombis} championId={championId} />
                    <PickCell score={j.min} combis={j.minCombis} championId={championId} />
                  </tr>
                ))}
            </tbody>
          </HistoryTable>
      )}
      {yearRow && <p className="legend">審査員全体の平均点: {yearRow.judgeMean.toFixed(1)}</p>}

      <h2 className="section-title">最終決戦の得票(満場一致と接戦)</h2>
      <p className="section-note">
        最終決戦の得票の割れ方。「満場一致」は全票を集めての優勝、票差1は最接戦。2020年は3組に票が割れた唯一の年。
      </p>
      <HistoryTable caption="最終決戦の得票(満場一致と接戦)">
          <thead>
            <tr>
              <th scope="col">年</th>
              <th scope="col">王者</th>
              <th scope="col">得票</th>
              <th scope="col">票差</th>
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
                  {r.unanimous && <span className="chip chip-champion">満場一致</span>}
                </td>
                <td className="no">{r.votes.join(' - ')}</td>
                <td className="no">{r.margin}</td>
              </tr>
            ))}
          </tbody>
        </HistoryTable>
    </>
  )
}
