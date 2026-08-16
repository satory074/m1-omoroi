import { Link } from 'react-router-dom'

import { competitionRanks } from '../lib/rank'
import type { FinalsStats } from '../lib/types'
import { WinnersCell } from './RankTable'

/** 決勝の傾向(分布・傾向系): 出番順別/王者の1本目順位/結成年数別/事務所別。統計ページが表示 */
export default function FinalsTrends({ fs }: { fs: FinalsStats }) {
  const unknown = fs.formationYears.unknownFormed
  const hasUnknown = unknown.final + unknown.semifinal + unknown.quarterfinal > 0

  // 結成年数別: 0〜15年は個別行、16年以上はまとめる(結成年の誤登録等に備える)
  const formationRows = (() => {
    const series = ['champion', 'final', 'semifinal', 'quarterfinal'] as const
    const maps = series.map(
      (s) => new Map(fs.formationYears[s].map((r) => [r.years, r.count])),
    )
    const maxYears = Math.max(0, ...maps.flatMap((m) => [...m.keys()]))
    const rows: { label: string; counts: number[] }[] = []
    for (let y = 0; y <= Math.min(maxYears, 15); y++) {
      rows.push({ label: `結成${y}年`, counts: maps.map((m) => m.get(y) ?? 0) })
    }
    if (maxYears > 15) {
      rows.push({
        label: '結成16年以上',
        counts: maps.map((m) =>
          [...m.entries()].filter(([y]) => y > 15).reduce((sum, [, c]) => sum + c, 0),
        ),
      })
    }
    return rows
  })()

  return (
    <>
      <h2 className="section-title">出番順別の成績(ファーストラウンド)</h2>
      <p className="section-note">
        どの出番順が優勝しやすいか。全21大会分。10番手は決勝10組の年(2017年以降ほか)のみ存在。
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>出番順</th>
              <th>出場</th>
              <th>最終決戦進出</th>
              <th>優勝</th>
              <th>優勝コンビ</th>
            </tr>
          </thead>
          <tbody>
            {fs.firstRoundOrderStats.map((r) => (
              <tr key={r.order}>
                <td className="no">{r.order}</td>
                <td className="no">{r.appearances}</td>
                <td className="no">{r.finalists}</td>
                <td className="no">{r.wins}</td>
                <td>
                  <WinnersCell winners={r.winners} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">最終決戦の出番順別の成績</h2>
      <p className="section-note">
        最終決戦のネタ披露順ごとの優勝回数。3番手は最終決戦3組の年(2002年以降)のみ。
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>出番順</th>
              <th>進出</th>
              <th>優勝</th>
              <th>優勝コンビ</th>
            </tr>
          </thead>
          <tbody>
            {fs.finalOrderStats.map((r) => (
              <tr key={r.order}>
                <td className="no">{r.order}番手</td>
                <td className="no">{r.appearances}</td>
                <td className="no">{r.wins}</td>
                <td>
                  <WinnersCell winners={r.winners} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">敗者復活の記録</h2>
      <p className="section-note">
        敗者復活戦は{fs.revivalStats.sinceYear}年開始({fs.revivalStats.sinceYear}年以降が集計対象)。出場は延べ(コンビ×年)。
        敗者復活からの優勝: <WinnersCell winners={fs.revivalStats.winners} />
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>区分</th>
              <th>決勝出場</th>
              <th>最終決戦進出</th>
              <th>優勝</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['敗者復活組', fs.revivalStats.revival],
                ['ストレート組', fs.revivalStats.straight],
              ] as const
            ).map(([label, b]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="no">{b.appearances}</td>
                <td className="no">
                  {b.finalists}
                  {b.appearances > 0 && ` (${Math.round((b.finalists / b.appearances) * 100)}%)`}
                </td>
                <td className="no">
                  {b.wins}
                  {b.appearances > 0 && ` (${Math.round((b.wins / b.appearances) * 100)}%)`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">何回目の決勝で優勝したか</h2>
      <p className="section-note">優勝した年が、そのコンビにとって通算何回目の決勝進出だったか。</p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>通算</th>
              <th>回数</th>
              <th>王者</th>
            </tr>
          </thead>
          <tbody>
            {fs.championNthFinal.map((r) => (
              <tr key={r.n}>
                <td className="no">{r.n}回目</td>
                <td className="no">{r.count}</td>
                <td>
                  <WinnersCell winners={r.winners} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">王者のファーストラウンド順位</h2>
      <p className="section-note">優勝コンビが1本目で何位だったか。</p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>1本目の順位</th>
              <th>回数</th>
              <th>王者</th>
            </tr>
          </thead>
          <tbody>
            {fs.championFirstRoundRank.map((r) => (
              <tr key={r.rank}>
                <td className="no">{r.rank}位</td>
                <td className="no">{r.count}</td>
                <td>
                  <WinnersCell winners={r.winners} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">1本目の1位と2位の点差</h2>
      <p className="section-note">
        ファーストラウンド1位と2位の合計点差(接戦順)。審査員数・満点が年により違うため点差の単純比較は目安。
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>点差</th>
              <th>年</th>
              <th>1位</th>
              <th>2位</th>
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
                    {m.first.combiId != null ? (
                      <Link to={`/combi/${m.first.combiId}`}>{m.first.name}</Link>
                    ) : (
                      m.first.name
                    )}{' '}
                    ({m.first.total})
                  </td>
                  <td>
                    {m.second.combiId != null ? (
                      <Link to={`/combi/${m.second.combiId}`}>{m.second.name}</Link>
                    ) : (
                      m.second.name
                    )}{' '}
                    ({m.second.total})
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">結成年数別の到達数</h2>
      <p className="section-note">
        結成N年 = 大会年 − 結成年(出場資格と同じ数え方)。決勝/準決勝/準々決勝は延べ(コンビ×年)で、上位ラウンド進出年は下位ラウンドにも数える。
        {hasUnknown &&
          ` 結成年不明の延べ${unknown.final + unknown.semifinal + unknown.quarterfinal}件(決勝${unknown.final}・準決勝${unknown.semifinal}・準々決勝${unknown.quarterfinal})は除外。`}
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>結成年数</th>
              <th>優勝</th>
              <th>決勝</th>
              <th>準決勝</th>
              <th>準々決勝</th>
            </tr>
          </thead>
          <tbody>
            {formationRows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                {row.counts.map((c, i) => (
                  <td key={i} className="no">
                    {c > 0 ? c : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">事務所別 決勝進出</h2>
      <p className="section-note">
        延べ = 決勝(ファーストラウンド)出場のコンビ×年。所属は公式コンビDBの現行表記のため、移籍・改名は現在の所属で集計。
        {fs.agencyFinalsExcluded > 0 && ` 所属不明の延べ${fs.agencyFinalsExcluded}件は除外。`}
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>順位</th>
              <th>事務所</th>
              <th>延べ回数</th>
              <th>組数</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const ranks = competitionRanks(fs.agencyFinals, (x) => x.value)
              return fs.agencyFinals.map((a, i) => (
                <tr key={a.agency}>
                  <td className="no">{ranks[i]}</td>
                  <td>{a.agency}</td>
                  <td className="no">{a.value}</td>
                  <td className="no">{a.combis}</td>
                </tr>
              ))
            })()}
          </tbody>
        </table>
      </div>
    </>
  )
}
