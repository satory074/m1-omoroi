import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type { JudgePickCombi, JudgesStats, LeaveOneOutChange, SingleScore, SplitScore } from '../lib/types'
import { useUrlParam } from '../lib/useUrlParam'
import CombiLink from './CombiLink'
import HistoryTable from './HistoryTable'
import ScrollNav, { type ScrollNavItem } from './ScrollNav'
import { finalsPath } from '../lib/paths'

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
          <CombiLink id={c.combiId}>{c.name}</CombiLink>
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
                  <CombiLink id={r.championCombiId}>{r.champion}</CombiLink>
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
                  <Link to={finalsPath(r.year)}>{r.year}</Link>
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

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—'
}

/**
 * 最終決戦の1票ずつを、投票した審査員の1本目の採点と比べる。
 * 比べる目安は「1本目を全く見ずに選んだ場合」(N組なら乗り換えは (N−1)/N)と「1本目どおりにしか入れない場合」(0%)
 */
export function JudgeVoteConsistencySection({ js }: { js: JudgesStats }) {
  const { years, total } = js.voteConsistency
  if (years.length === 0) return null
  const decided = total.same + total.switched
  return (
    <>
      <h2 className="section-title">最終決戦の票は1本目の採点どおりか</h2>
      <p className="section-note">
        最終決戦の1票ずつについて、投票した審査員が1本目(ファーストラウンド)で最終決戦の組に付けた点を見ました。
        自分の採点で1位だった組に入れた票が「1本目どおり」、それ以外の組に入れた票が「乗り換え」です。
        自分の採点で1位が同点だった票は「同点」として分けます。
        全{total.votes}票のうち、1位が同点でない{decided}票では、乗り換えが
        <strong>
          {total.switched}票({percent(total.switched, decided)})
        </strong>
        でした。
      </p>
      <p className="section-note">
        比べる目安: 1本目の点を全く見ずに最終決戦の組から選んだとすると、乗り換えは約{percent(total.expectedSwitch, decided)}
        (3組なら3票に2票)。1本目どおりにしか入れないなら0%です。
      </p>
      <HistoryTable caption={`最終決戦の票と1本目の採点(${years[0].year}〜${years[years.length - 1].year}年の合計)`}>
        <thead>
          <tr>
            <th scope="col">票</th>
            <th scope="col">1本目どおり</th>
            <th scope="col">同点</th>
            <th scope="col">乗り換え</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="no">{total.votes}</td>
            <td className="no">{total.same}</td>
            <td className="no">{total.tie}</td>
            <td className="no">
              <strong>
                {total.switched}({percent(total.switched, decided)})
              </strong>
            </td>
          </tr>
        </tbody>
      </HistoryTable>
      <p className="legend">乗り換えの割合は、1位が同点の票を除いた{decided}票に対するもの。2001年は最終決戦が2組、それ以外は3組。2001年の会場票は投票していません。</p>
      <details className="note">
        <summary>
          <span className="note-label">年ごとに見る</span>
        </summary>
        <HistoryTable caption="最終決戦の票と1本目の採点(年ごと)">
          <thead>
            <tr>
              <th scope="col">年</th>
              <th scope="col">票</th>
              <th scope="col">1本目どおり</th>
              <th scope="col">同点</th>
              <th scope="col">乗り換え</th>
            </tr>
          </thead>
          <tbody>
            {[...years].reverse().map((r) => (
              <tr key={r.year}>
                <td className="no">
                  <Link to={finalsPath(r.year)}>{r.year}</Link>
                </td>
                <td className="no">{r.votes}</td>
                <td className="no">{r.same}</td>
                <td className="no">{r.tie}</td>
                <td className="no">{r.switched}</td>
              </tr>
            ))}
          </tbody>
        </HistoryTable>
      </details>
    </>
  )
}

/** 同じ結果になる審査員を1行にまとめるための鍵 */
function changeKey(c: LeaveOneOutChange): string {
  const names = (xs: JudgePickCombi[]) => xs.map((x) => x.name).join('/')
  return [c.tie, names(c.added), names(c.dropped), names(c.tied)].join('|')
}

function judgeLabel(c: LeaveOneOutChange): string {
  return c.venue ? `会場票(${c.canonical})` : c.canonical
}

function ChangeResult({ c }: { c: LeaveOneOutChange }) {
  const strong = new Set(c.added.map((x) => x.name))
  return (
    <>
      {c.added.length > 0 && (
        <>
          <NameList combis={c.added} strong={strong} />
          が入り、
          <NameList combis={c.dropped} />
          が外れる
        </>
      )}
      {c.added.length === 0 && c.dropped.length > 0 && (
        <>
          <NameList combis={c.dropped} />
          が外れる
        </>
      )}
      {c.tie && (
        <>
          {c.added.length > 0 || c.dropped.length > 0 ? '。さらに ' : ''}
          <NameList combis={c.tied} />
          が同じ点で並び、決まらない
        </>
      )}
    </>
  )
}

/**
 * 審査員(列)を1人ずつ外し、残りの審査員の合計で最終決戦の組を選び直す。
 * 「その人がいなかったら」の結果ではなく(代わりの人は別の点を付けたはず)、境目がどれだけ僅差だったかを示す
 */
export function JudgeLeaveOneOutSection({ js }: { js: JudgesStats }) {
  const rows = js.leaveOneOut.rows
  if (rows.length === 0) return null
  const flipYears = rows.filter((r) => r.changes.some((c) => !c.tie)).length
  const onepoint = rows.filter((r) => r.cutMargin === 1).length
  const shown = [...rows].reverse().filter((r) => r.changes.length > 0)
  return (
    <>
      <h2 className="section-title">審査員を1人外すと最終決戦の顔ぶれは変わるか</h2>
      <p className="section-note">
        1本目の得点表から審査員を1人ずつ外し、残りの審査員の合計で上位の組(2001年は2組、それ以外は3組)を選び直して、
        実際に最終決戦へ進んだ組と比べました。
        {rows.length}大会のうち、誰か1人を外すと顔ぶれが変わるのは<strong>{flipYears}大会</strong>です。
        最終決戦に進む最後の組とその次の組の点差(境目の点差)が1点だった大会は{onepoint}大会ありました。
      </p>
      <p className="section-note">
        外した審査員の代わりに別の人がいれば、別の点を付けたはずです。なので「その人がいなかったら」の結果ではなく、
        境目がどれだけ僅差だったかを示すものです。
      </p>
      <HistoryTable caption="審査員を1人外して選び直した最終決戦の組">
        <thead>
          <tr>
            <th scope="col">年</th>
            <th scope="col">境目の点差</th>
            <th scope="col">外した審査員</th>
            <th scope="col">選び直すと</th>
          </tr>
        </thead>
        <tbody>
          {shown.flatMap((r) => {
            const groups = new Map<string, LeaveOneOutChange[]>()
            for (const c of r.changes) {
              const k = changeKey(c)
              groups.set(k, [...(groups.get(k) ?? []), c])
            }
            return [...groups.values()].map((cs, i) => (
              <tr key={`${r.year}-${i}`}>
                {i === 0 && (
                  <>
                    <td className="no" rowSpan={groups.size}>
                      <Link to={finalsPath(r.year)}>{r.year}</Link>
                    </td>
                    <td className="no" rowSpan={groups.size}>
                      {r.cutMargin != null ? `${r.cutMargin}点` : '—'}
                    </td>
                  </>
                )}
                <td>{cs.map(judgeLabel).join('・')}</td>
                <td className="names-cell">
                  <ChangeResult c={cs[0]} />
                </td>
              </tr>
            ))
          })}
        </tbody>
      </HistoryTable>
      <p className="legend">
        境目の点差は、全員の合計で最終決戦に進む最後の組(3位。2001年は2位)と次の組の点差。
        太字は選び直すと入る組。「同じ点で並び、決まらない」は、選び直すと最後の枠を同じ点の組が争う場合です
        (実際の大会の同点の決め方はこの計算に入れていません)。2001年は会場票(大阪・札幌・福岡)も合計に入っていたので、1列ずつ外す対象に含めています。
        載せているのは、誰かを外すと結果が変わる大会だけです。
      </p>
    </>
  )
}

function SplitTable({ caption, rows }: { caption: string; rows: SplitScore[] }) {
  return (
    <HistoryTable caption={caption}>
      <thead>
        <tr>
          <th scope="col" className="sticky-name">
            コンビ
          </th>
          <th scope="col">年</th>
          <th scope="col">割れ具合</th>
          <th scope="col">最高点</th>
          <th scope="col">最低点</th>
          <th scope="col">1本目の順位</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.year}-${r.name}`}>
            <td className="sticky-name">
              <CombiLink id={r.combiId}>{r.name}</CombiLink>
            </td>
            <td className="no">
              <Link to={finalsPath(r.year)}>{r.year}</Link>
            </td>
            <td className="no">{r.spread.toFixed(2)}</td>
            <td>
              {r.maxScore}点<span className="cell-note">{r.maxJudges.join('・')}</span>
            </td>
            <td>
              {r.minScore}点<span className="cell-note">{r.minJudges.join('・')}</span>
            </td>
            <td className="no">{r.rank != null ? `${r.rank}位` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </HistoryTable>
  )
}

/** 審査員ごとに点の甘さ・幅をそろえたうえで、組ごとに審査員の評価がどれだけ分かれたか */
export function JudgeSplitSection({ js }: { js: JudgesStats }) {
  const { mean, count, highest, lowest } = js.splitScores
  if (highest.length === 0 || mean == null) return null
  return (
    <>
      <h2 className="section-title">審査員の評価が割れたネタ・揃ったネタ</h2>
      <p className="section-note">
        審査員ごとに、その年の全組への点を「(点 − その審査員の平均点) ÷ その審査員の標準偏差」にそろえてから
        (甘い・辛い・点の幅の違いを消すため)、組ごとに審査員の間でのばらつき(標準偏差)を測りました。
        0なら全員が同じ評価で、大きいほど審査員によって評価が分かれたネタです。
        比べる目安: 1本目の全{count}組の平均は{mean.toFixed(2)}です。2001年の会場票は個人の点ではないので除きます。
      </p>
      <h3 className="chart-small-title">評価が割れたネタ</h3>
      <SplitTable caption="審査員の評価が割れたネタ" rows={highest} />
      <h3 className="chart-small-title">評価が揃ったネタ</h3>
      <SplitTable caption="審査員の評価が揃ったネタ" rows={lowest} />
      <p className="legend">最高点・最低点の下は、その点を付けた審査員。上位10件・5件(境目の同点は全件)。</p>
    </>
  )
}

// これ未満の回数は1組の出来で決まってしまうので、本文の集計に入れず参考として分ける
const FIRST_PERFORMER_MIN = 5

function FirstPerformerTable({ caption, rows }: { caption: string; rows: JudgesStats['firstPerformer'] }) {
  return (
    <HistoryTable caption={caption}>
      <thead>
        <tr>
          <th scope="col" className="sticky-name">
            審査員
          </th>
          <th scope="col">回数</th>
          <th scope="col">平均との差</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td className="sticky-name">{r.name}</td>
            <td className="no">{r.n}回</td>
            <td className="no">
              {r.meanDiff > 0 ? '+' : ''}
              {r.meanDiff.toFixed(1)}点
            </td>
          </tr>
        ))}
      </tbody>
    </HistoryTable>
  )
}

/** トップバッター(出番1番)に付けた点 − その審査員のその年の平均点。回数の多い順 */
export function JudgeFirstPerformerSection({ js }: { js: JudgesStats }) {
  const rows = js.firstPerformer
  if (rows.length === 0) return null
  const main = rows.filter((r) => r.n >= FIRST_PERFORMER_MIN)
  const few = rows.filter((r) => r.n < FIRST_PERFORMER_MIN)
  const lower = (xs: typeof rows) => xs.filter((r) => r.meanDiff < 0).length
  return (
    <>
      <h2 className="section-title">トップバッターへの採点</h2>
      <p className="section-note">
        出番1番の組に付けた点から、その審査員のその年の平均点を引いた値の平均です。
        0ならその審査員の平均どおり、マイナスなら平均より低く付けています。
        トップバッターを{FIRST_PERFORMER_MIN}回以上採点した{main.length}人のうち、<strong>{lower(main)}人</strong>がマイナスでした
        (回数の少ない人も含めた全{rows.length}人では{lower(rows)}人)。
        回数が少ないと1組の出来で大きく動くので、{FIRST_PERFORMER_MIN}回未満の人は参考として分けています。
        トップバッターの組が本当に弱かった年もあります。
      </p>
      <h3 className="chart-small-title">{FIRST_PERFORMER_MIN}回以上</h3>
      <FirstPerformerTable caption={`トップバッターへの採点(${FIRST_PERFORMER_MIN}回以上)`} rows={main} />
      {few.length > 0 && (
        <details className="note">
          <summary>
            <span className="note-label">{FIRST_PERFORMER_MIN - 1}回以下の{few.length}人(参考)</span>
          </summary>
          <FirstPerformerTable caption={`トップバッターへの採点(${FIRST_PERFORMER_MIN - 1}回以下・参考)`} rows={few} />
        </details>
      )}
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
              <Link to={finalsPath(r.year)}>{r.year}</Link>
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
