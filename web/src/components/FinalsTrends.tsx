import { Fragment } from 'react'

import { competitionRanks } from '../lib/rank'
import type { FinalsStats } from '../lib/types'
import { FinalistAgeSection, FinalistMakeupSection } from './FinalistTrends'
import { WinnersCell } from './RankTable'
import HistoryTable from './HistoryTable'
import CombiLink from './CombiLink'
import { fromRoster, useReveal, type RevealItem } from '../lib/reveal'
import { RevealButton, RevealRow } from './RevealCount'

/** 決勝の傾向(分布・傾向系): 出番順別/王者の1本目順位/結成年数別/年齢と結成年数の推移/事務所別/顔ぶれの推移。記録・統計の「決勝」タブが表示 */
export default function FinalsTrends({ fs }: { fs: FinalsStats }) {
  const unknown = fs.formationYears.unknownFormed
  const hasUnknown = unknown.final + unknown.semifinal + unknown.quarterfinal > 0
  const roster = fs.roster
  // 数字を押すと行の下に名前が開く。表ごとに開くのは1つ
  const orderReveal = useReveal()
  const finalOrderReveal = useReveal()
  const revivalReveal = useReveal()
  const formationReveal = useReveal()
  const nameLengthReveal = useReveal()
  const agencyReveal = useReveal()

  // 結成年数別: 0〜15年は個別行、16年以上はまとめる(結成年の誤登録等に備える)。
  // 優勝・決勝は名前も持つ(準決勝・準々決勝は延べ数百〜千組あるので数だけ)
  const formationRows = (() => {
    const series = ['champion', 'final', 'semifinal', 'quarterfinal'] as const
    const maps = series.map(
      (s) => new Map(fs.formationYears[s].map((r) => [r.years, r])),
    )
    const namesOf = (r: (typeof fs.formationYears.final)[number] | undefined): RevealItem[] =>
      r ? (r.combis ?? fromRoster(roster, r.rows)) : []
    const maxYears = Math.max(0, ...maps.flatMap((m) => [...m.keys()]))
    const rows: { label: string; counts: number[]; champions: RevealItem[]; finalists: RevealItem[] }[] = []
    for (let y = 0; y <= Math.min(maxYears, 15); y++) {
      rows.push({
        label: `結成${y}年`,
        counts: maps.map((m) => m.get(y)?.count ?? 0),
        champions: namesOf(maps[0].get(y)),
        finalists: namesOf(maps[1].get(y)),
      })
    }
    if (maxYears > 15) {
      const over = (m: (typeof maps)[number]) => [...m.entries()].filter(([y]) => y > 15).map(([, r]) => r)
      rows.push({
        label: '結成16年以上',
        counts: maps.map((m) => over(m).reduce((sum, r) => sum + r.count, 0)),
        champions: over(maps[0]).flatMap(namesOf),
        finalists: over(maps[1]).flatMap(namesOf),
      })
    }
    return rows
  })()

  return (
    <>
      <h3 className="section-title">出番順別の成績(ファーストラウンド)</h3>
      <p className="section-note">
        どの出番順が優勝しやすいか。全{fs.firstRoundOrderStats[0]?.appearances ?? 0}大会分。10番手は決勝10組の年(2017年以降ほか)のみ存在。
        「平均偏差値」は、その年の1本目の合計点を偏差値(その年の平均が50、標準偏差が10)にして、出番ごとに平均したものです。
        比べる目安は全体の平均の50。1つの出番は各年1組なので、1大会ぶんの出来で大きく動きます。
      </p>
      <HistoryTable caption="出番順別の成績(ファーストラウンド)">
          <thead>
            <tr>
              <th scope="col">出番順</th>
              <th scope="col">出場</th>
              <th scope="col">最終決戦進出</th>
              <th scope="col">優勝</th>
              <th scope="col">平均偏差値</th>
              <th scope="col">優勝コンビ</th>
            </tr>
          </thead>
          <tbody>
            {fs.firstRoundOrderStats.map((r) => (
              <Fragment key={r.order}>
                <tr>
                  <td className="no">{r.order}</td>
                  <td className="no">
                    <RevealButton reveal={orderReveal} row={String(r.order)} col="appear" label={`${r.order}番の出場`} count={r.appearances} />
                  </td>
                  <td className="no">
                    <RevealButton
                      reveal={orderReveal}
                      row={String(r.order)}
                      col="final"
                      label={`${r.order}番から最終決戦`}
                      count={r.finalists ?? 0}
                    />
                  </td>
                  <td className="no">{r.wins}</td>
                  <td className="no">{r.meanDeviation != null ? r.meanDeviation.toFixed(1) : '—'}</td>
                  <td className="names-cell">
                    <WinnersCell winners={r.winners} />
                  </td>
                </tr>
                <RevealRow
                  reveal={orderReveal}
                  row={String(r.order)}
                  colSpan={6}
                  content={(col) =>
                    col === 'appear'
                      ? { title: `${r.order}番の出場`, items: fromRoster(roster, r.rows) }
                      : { title: `${r.order}番から最終決戦`, items: fromRoster(roster, r.finalRoundRows) }
                  }
                />
              </Fragment>
            ))}
          </tbody>
        </HistoryTable>

      <h3 className="section-title">最終決戦の出番順別の成績</h3>
      <p className="section-note">
        最終決戦のネタ披露順ごとの優勝回数。3番手は最終決戦3組の年(2002年以降)のみ。
      </p>
      <HistoryTable caption="最終決戦の出番順別の成績">
          <thead>
            <tr>
              <th scope="col">出番順</th>
              <th scope="col">進出</th>
              <th scope="col">優勝</th>
              <th scope="col">優勝コンビ</th>
            </tr>
          </thead>
          <tbody>
            {fs.finalOrderStats.map((r) => (
              <Fragment key={r.order}>
                <tr>
                  <td className="no">{r.order}番手</td>
                  <td className="no">
                    <RevealButton
                      reveal={finalOrderReveal}
                      row={String(r.order)}
                      col="appear"
                      label={`最終決戦の${r.order}番手`}
                      count={r.appearances}
                    />
                  </td>
                  <td className="no">{r.wins}</td>
                  <td className="names-cell">
                    <WinnersCell winners={r.winners} />
                  </td>
                </tr>
                <RevealRow
                  reveal={finalOrderReveal}
                  row={String(r.order)}
                  colSpan={4}
                  content={() => ({ title: `最終決戦の${r.order}番手`, items: fromRoster(roster, r.rows) })}
                />
              </Fragment>
            ))}
          </tbody>
        </HistoryTable>

      <h3 className="section-title">敗者復活の記録</h3>
      <p className="section-note">
        敗者復活戦は{fs.revivalStats.sinceYear}年開始({fs.revivalStats.sinceYear}年以降が集計対象)。出場は延べ(コンビ×年)。
        敗者復活からの優勝: <WinnersCell winners={fs.revivalStats.winners} />
      </p>
      <HistoryTable caption="敗者復活の記録">
          <thead>
            <tr>
              <th scope="col">区分</th>
              <th scope="col">決勝出場</th>
              <th scope="col">最終決戦進出</th>
              <th scope="col">優勝</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['敗者復活組', fs.revivalStats.revival],
                ['ストレート組', fs.revivalStats.straight],
              ] as const
            ).map(([label, b]) => (
              <Fragment key={label}>
                <tr>
                  <td>{label}</td>
                  <td className="no">
                    <RevealButton reveal={revivalReveal} row={label} col="appear" label={`${label}の決勝出場`} count={b.appearances} />
                  </td>
                  <td className="no">
                    <RevealButton reveal={revivalReveal} row={label} col="final" label={`${label}の最終決戦進出`} count={b.finalists} />
                    {b.appearances > 0 && ` (${Math.round((b.finalists / b.appearances) * 100)}%)`}
                  </td>
                  <td className="no">
                    <RevealButton reveal={revivalReveal} row={label} col="win" label={`${label}の優勝`} count={b.wins} />
                    {b.appearances > 0 && ` (${Math.round((b.wins / b.appearances) * 100)}%)`}
                  </td>
                </tr>
                <RevealRow
                  reveal={revivalReveal}
                  row={label}
                  colSpan={4}
                  content={(col) =>
                    col === 'appear'
                      ? { title: `${label}の決勝出場`, items: fromRoster(roster, b.rows) }
                      : col === 'final'
                        ? { title: `${label}の最終決戦進出`, items: fromRoster(roster, b.finalRoundRows) }
                        : { title: `${label}の優勝`, items: fromRoster(roster, b.winRows) }
                  }
                />
              </Fragment>
            ))}
          </tbody>
        </HistoryTable>

      <h3 className="section-title">何回目の決勝で優勝したか</h3>
      <p className="section-note">優勝した年が、そのコンビにとって通算何回目の決勝進出だったか。</p>
      <HistoryTable caption="何回目の決勝で優勝したか">
          <thead>
            <tr>
              <th scope="col">通算</th>
              <th scope="col">回数</th>
              <th scope="col">王者</th>
            </tr>
          </thead>
          <tbody>
            {fs.championNthFinal.map((r) => (
              <tr key={r.n}>
                <td className="no">{r.n}回目</td>
                <td className="no">{r.count}</td>
                <td className="names-cell">
                  <WinnersCell winners={r.winners} />
                </td>
              </tr>
            ))}
          </tbody>
        </HistoryTable>

      <SemifinalsBeforeFirstFinal data={fs.semifinalsBeforeFirstFinal} />

      <h3 className="section-title">王者のファーストラウンド順位</h3>
      <p className="section-note">優勝コンビが1本目で何位だったか。</p>
      <HistoryTable caption="王者のファーストラウンド順位">
          <thead>
            <tr>
              <th scope="col">1本目の順位</th>
              <th scope="col">回数</th>
              <th scope="col">王者</th>
            </tr>
          </thead>
          <tbody>
            {fs.championFirstRoundRank.map((r) => (
              <tr key={r.rank}>
                <td className="no">{r.rank}位</td>
                <td className="no">{r.count}</td>
                <td className="names-cell">
                  <WinnersCell winners={r.winners} />
                </td>
              </tr>
            ))}
          </tbody>
        </HistoryTable>

      <h3 className="section-title">1本目の1位と2位の点差</h3>
      <p className="section-note">
        ファーストラウンド1位と2位の合計点差(接戦順)。審査員数・満点が年により違うため点差の単純比較は目安。
      </p>
      <HistoryTable caption="1本目の1位と2位の点差">
          <thead>
            <tr>
              <th scope="col">点差</th>
              <th scope="col">年</th>
              <th scope="col">1位</th>
              <th scope="col">2位</th>
            </tr>
          </thead>
          <tbody>
            {[...fs.firstRoundMargins]
              .sort((a, b) => a.margin - b.margin || a.year - b.year)
              .map((m) => (
                <tr key={m.year}>
                  <td className="no">{m.margin}</td>
                  <td className="no">{m.year}</td>
                  <td>
                    <CombiLink id={m.first.combiId}>{m.first.name}</CombiLink>{' '}
                    ({m.first.total})
                  </td>
                  <td>
                    <CombiLink id={m.second.combiId}>{m.second.name}</CombiLink>{' '}
                    ({m.second.total})
                  </td>
                </tr>
              ))}
          </tbody>
        </HistoryTable>

      <h3 className="section-title">結成年数別の到達数</h3>
      <p className="section-note">
        結成N年 = 大会年 − 結成年(出場資格と同じ数え方)。決勝/準決勝/準々決勝は延べ(コンビ×年)で、上位ラウンド進出年は下位ラウンドにも数える。
        優勝・決勝の数字を押すとその組が出ます(準決勝・準々決勝は延べ数百〜千組あるので数だけ)。
        {hasUnknown &&
          ` 結成年不明の延べ${unknown.final + unknown.semifinal + unknown.quarterfinal}件(決勝${unknown.final}・準決勝${unknown.semifinal}・準々決勝${unknown.quarterfinal})は除外。`}
      </p>
      <HistoryTable caption="結成年数別の到達数">
          <thead>
            <tr>
              <th scope="col">結成年数</th>
              <th scope="col">優勝</th>
              <th scope="col">決勝</th>
              <th scope="col">準決勝</th>
              <th scope="col">準々決勝</th>
            </tr>
          </thead>
          <tbody>
            {formationRows.map((row) => (
              <Fragment key={row.label}>
                <tr>
                  <td>{row.label}</td>
                  {row.counts.map((c, i) => (
                    <td key={i} className="no">
                      {c === 0 ? (
                        ''
                      ) : i === 0 || i === 1 ? (
                        <RevealButton
                          reveal={formationReveal}
                          row={row.label}
                          col={i === 0 ? 'champion' : 'final'}
                          label={`${row.label}で${i === 0 ? '優勝' : '決勝'}`}
                          count={c}
                        />
                      ) : (
                        c
                      )}
                    </td>
                  ))}
                </tr>
                <RevealRow
                  reveal={formationReveal}
                  row={row.label}
                  colSpan={5}
                  content={(col) =>
                    col === 'champion'
                      ? { title: `${row.label}で優勝`, items: row.champions }
                      : { title: `${row.label}で決勝`, items: row.finalists }
                  }
                />
              </Fragment>
            ))}
          </tbody>
        </HistoryTable>

      <FinalistAgeSection rows={fs.finalistsByYear} />

      <h3 className="section-title">コンビ名の文字数と成績</h3>
      <p className="section-note">
        「短い名前ほど優勝しやすい」説の検証。文字数は空白を除き全半角をそろえて数えた値。
        エントリーは記録に残る全コンビ、決勝・優勝はコンビ単位(複数回進出も1組)。
      </p>
      <HistoryTable caption="コンビ名の文字数と成績">
          <thead>
            <tr>
              <th scope="col">文字数</th>
              <th scope="col">エントリー</th>
              <th scope="col">決勝進出</th>
              <th scope="col">優勝</th>
              <th scope="col">決勝率</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              type Row = {
                label: string
                entrants: number
                finalists: number
                champions: number
                finalCombis: RevealItem[]
                championCombis: RevealItem[]
              }
              const rows: Row[] = []
              for (const r of fs.nameLengthStats) {
                if (r.length <= 9) {
                  rows.push({ label: `${r.length}文字`, ...r })
                } else {
                  const last = rows[rows.length - 1]
                  if (last && last.label === '10文字以上') {
                    last.entrants += r.entrants
                    last.finalists += r.finalists
                    last.champions += r.champions
                    last.finalCombis = [...last.finalCombis, ...r.finalCombis]
                    last.championCombis = [...last.championCombis, ...r.championCombis]
                  } else {
                    rows.push({ ...r, label: '10文字以上' })
                  }
                }
              }
              return rows.map((r) => (
                <Fragment key={r.label}>
                  <tr>
                    <td>{r.label}</td>
                    <td className="no">{r.entrants.toLocaleString('ja-JP')}</td>
                    <td className="no">
                      {r.finalists > 0 && (
                        <RevealButton reveal={nameLengthReveal} row={r.label} col="final" label={`${r.label}で決勝進出`} count={r.finalists} />
                      )}
                    </td>
                    <td className="no">
                      {r.champions > 0 && (
                        <RevealButton reveal={nameLengthReveal} row={r.label} col="champion" label={`${r.label}で優勝`} count={r.champions} />
                      )}
                    </td>
                    <td className="no">
                      {r.finalists > 0 ? `${((r.finalists / r.entrants) * 100).toFixed(2)}%` : ''}
                    </td>
                  </tr>
                  <RevealRow
                    reveal={nameLengthReveal}
                    row={r.label}
                    colSpan={5}
                    content={(col) =>
                      col === 'final'
                        ? { title: `${r.label}で決勝進出`, items: r.finalCombis }
                        : { title: `${r.label}で優勝`, items: r.championCombis }
                    }
                  />
                </Fragment>
              ))
            })()}
          </tbody>
        </HistoryTable>

      <h3 className="section-title">事務所別 決勝進出</h3>
      <p className="section-note">
        延べ = 決勝(ファーストラウンド)出場のコンビ×年。所属は公式コンビDBの現行表記のため、移籍・改名は現在の所属で集計。
        {fs.agencyFinalsExcluded > 0 && ` 所属不明の延べ${fs.agencyFinalsExcluded}件は除外。`}
      </p>
      <HistoryTable caption="事務所別 決勝進出">
          <thead>
            <tr>
              <th scope="col">順位</th>
              <th scope="col">事務所</th>
              <th scope="col">延べ回数</th>
              <th scope="col">組数</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const ranks = competitionRanks(fs.agencyFinals, (x) => x.value)
              return fs.agencyFinals.map((a, i) => (
                <Fragment key={a.agency}>
                  <tr>
                    <td className="no">{ranks[i]}</td>
                    <td>{a.agency}</td>
                    <td className="no">{a.value}</td>
                    <td className="no">
                      <RevealButton reveal={agencyReveal} row={a.agency} col="combis" label={`${a.agency}の決勝進出`} count={a.combis} />
                    </td>
                  </tr>
                  <RevealRow
                    reveal={agencyReveal}
                    row={a.agency}
                    colSpan={4}
                    content={() => ({
                      title: `${a.agency}の決勝進出`,
                      items: a.names.map((c) => ({ name: c.name, combiId: c.combiId, note: `${c.n}回` })),
                    })}
                  />
                </Fragment>
              ))
            })()}
          </tbody>
        </HistoryTable>

      <FinalistMakeupSection rows={fs.finalistsByYear} roster={roster} />
    </>
  )
}

/**
 * 何度目の準決勝で初めて決勝に届いたか。突破率 = n回目の準決勝で初めて決勝に進んだ組 ÷ n回目の準決勝に出た(まだ決勝経験のない)組
 */
function SemifinalsBeforeFirstFinal({ data }: { data: FinalsStats['semifinalsBeforeFirstFinal'] }) {
  if (data.dist.length === 0) return null
  const firstTry = data.dist.find((r) => r.n === 1)
  return (
    <>
      <h3 className="section-title">何度目の準決勝で初めて決勝に届いたか</h3>
      <p className="section-note">
        初めて決勝に進んだ年までに、準決勝に何回出たか(その年を含む。敗者復活から決勝に進んだ年も、その年の準決勝に出ているので数えます)。
        {data.sinceYear}年以降に初めて決勝へ進んだ{data.combis}組が対象です({data.sinceYear}年は第1回なので、その年の決勝進出組は全組1回目)。
        {firstTry && (
          <>
            初めての準決勝でそのまま決勝に進んだのは{firstTry.count}組({Math.round((firstTry.count / data.combis) * 100)}%)でした。
          </>
        )}
      </p>
      <p className="section-note">
        「突破率」は、n回目の準決勝に出た(まだ決勝経験のない)組のうち、その年に決勝へ進んだ割合です。
        回数が増えるほど突破率が上がって見えますが、何度も準決勝に来られる組はもともと強い組なので、挑戦の回数そのものの効果とは言えません。
      </p>
      <HistoryTable caption="何度目の準決勝で初めて決勝に届いたか">
        <thead>
          <tr>
            <th scope="col">準決勝</th>
            <th scope="col">出た組</th>
            <th scope="col">決勝へ</th>
            <th scope="col">突破率</th>
            <th scope="col">初めて決勝に届いた組</th>
          </tr>
        </thead>
        <tbody>
          {data.dist.map((r) => (
            <tr key={r.n}>
              <td className="no">{r.n}回目</td>
              <td className="no">{r.attempts}</td>
              <td className="no">{r.count}</td>
              <td className="no">{r.attempts ? `${Math.round((r.count / r.attempts) * 100)}%` : '—'}</td>
              <td className="names-cell">
                <WinnersCell winners={r.combis} />
              </td>
            </tr>
          ))}
        </tbody>
      </HistoryTable>
      <p className="legend">組の名前の横の年は、初めて決勝に進んだ年。準決勝の記録は決勝の得点表がある年(休止の2011〜2014年を除く)だけ数えます。</p>
    </>
  )
}
