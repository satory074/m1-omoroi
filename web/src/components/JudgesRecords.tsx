import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type { JudgePickCombi, JudgesStats, SingleScore } from '../lib/types'
import { useUrlParam } from '../lib/useUrlParam'
import CombiLink from './CombiLink'
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
        「王者」の印はその年の優勝コンビ。点の幅 = その審査員の最低点〜最高点、標準偏差 = 組ごとの点のばらつき。
        ばらつきの大きい審査員ほど、組の間に大きな点差を付けるので、合計点の順位を動かす力が大きくなります。
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
                <th scope="col">点の幅</th>
                <th scope="col">標準偏差</th>
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
                    <td className="no">
                      {j.min}〜{j.max}
                    </td>
                    <td className="no">{j.sd.toFixed(2)}</td>
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

/** 名前の列(リンクつき)を「・」区切りで並べる。強調する組(標準化で入れ替わった組)は太字 */
function NameList({ combis, strong }: { combis: JudgePickCombi[]; strong?: Set<string> }) {
  return (
    <>
      {combis.map((c, i) => (
        <span key={c.name} className="winner-item">
          {i > 0 && '・'}
          {strong?.has(c.name) ? (
            <strong>
              <CombiLink id={c.combiId}>{c.name}</CombiLink>
            </strong>
          ) : (
            <CombiLink id={c.combiId}>{c.name}</CombiLink>
          )}
        </span>
      ))}
    </>
  )
}

/**
 * 審査員ごとに点数の幅をそろえて(標準化して)足したら、最終決戦に進む組は変わったか。
 * 「点の幅の広い審査員ほど合計点への影響が大きい」という指摘を、実際の得点表で確かめる
 */
export function JudgeStandardizedSection({ js }: { js: JudgesStats }) {
  const rows = js.standardized
  if (rows.length === 0) return null
  const setChanged = rows.filter((r) => r.setChanged).length
  const orderChanged = rows.filter((r) => r.orderChanged).length
  return (
    <>
      <h2 className="section-title">点数の幅をそろえたら最終決戦は変わるか</h2>
      <p className="section-note">
        合計点は審査員の点をそのまま足すので、点の幅の広い審査員ほど順位を動かす力が大きくなります。
        そこで、審査員ごとに「(点 − その審査員の平均点) ÷ その審査員の標準偏差」にそろえてから足し(標準化)、
        最終決戦に進む上位の組(2001年は2組、それ以外は3組)が実際の結果と変わるかを比べました。
        {rows.length}大会のうち、顔ぶれが変わるのは<strong>{setChanged}大会</strong>、
        上位の並びまで含めて変わるのは{orderChanged}大会です。
      </p>
      <HistoryTable caption="標準化した場合の最終決戦進出組">
        <thead>
          <tr>
            <th scope="col">年</th>
            <th scope="col">実際(合計点の順)</th>
            <th scope="col">標準化した場合</th>
            <th scope="col">違い</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => {
            const actualNames = new Set(r.actual.map((c) => c.name))
            const newcomers = new Set(r.standardized.filter((c) => !actualNames.has(c.name)).map((c) => c.name))
            return (
              <tr key={r.year}>
                <td className="no">
                  <Link to={`/finals/${r.year}`}>{r.year}</Link>
                </td>
                <td className="names-cell">
                  <NameList combis={r.actual} />
                </td>
                <td className="names-cell">
                  <NameList combis={r.standardized} strong={newcomers} />
                </td>
                <td>{r.setChanged ? <strong>顔ぶれが変わる</strong> : r.orderChanged ? '並びが変わる' : '同じ'}</td>
              </tr>
            )
          })}
        </tbody>
      </HistoryTable>
      <p className="legend">太字の組は、標準化すると最終決戦に入る組。2001年は会場票(大阪・札幌・福岡)も合計に入っていたので、標準化にも含めています。</p>
    </>
  )
}

function ScoreTable({ caption, rows }: { caption: string; rows: SingleScore[] }) {
  return (
    <HistoryTable caption={caption}>
      <thead>
        <tr>
          <th scope="col">点</th>
          <th scope="col">年</th>
          <th scope="col">審査員</th>
          <th scope="col">コンビ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.year}-${r.judge}-${r.name}`}>
            <td className="no">{r.score}点</td>
            <td className="no">
              <Link to={`/finals/${r.year}`}>{r.year}</Link>
            </td>
            <td>{r.judge}</td>
            <td>
              <CombiLink id={r.combiId}>{r.name}</CombiLink>
            </td>
          </tr>
        ))}
      </tbody>
    </HistoryTable>
  )
}

/** 審査員個人が1組に付けた点の最高・最低(会場票は含まない) */
export function JudgeScoreExtremesSection({ js }: { js: JudgesStats }) {
  const { highest, lowest } = js.scoreExtremes
  if (highest.length === 0) return null
  const lowYears = [...new Set(lowest.map((r) => r.year))].sort((a, b) => a - b)
  return (
    <>
      <h2 className="section-title">審査員個人の最高点・最低点</h2>
      <p className="section-note">
        審査員1人が1組に付けた点の、歴代の最高と最低(上位5件。同点は全件)。2001年の会場票は個人の点ではないので含めません。
        {lowYears.length > 0 &&
          lowYears[lowYears.length - 1] <= 2010 &&
          `最低点はすべて${lowYears.join('・')}年で、初期の大会は今より点の幅を大きく使っていました。`}
      </p>
      <h3 className="chart-small-title">最高点</h3>
      <ScoreTable caption="審査員個人の最高点" rows={highest} />
      <h3 className="chart-small-title">最低点</h3>
      <ScoreTable caption="審査員個人の最低点" rows={lowest} />
    </>
  )
}
