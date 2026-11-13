import { Link } from 'react-router-dom'

import { competitionRanks } from '../lib/rank'
import type { FinalsStats } from '../lib/types'
import { WinnersCell } from './RankTable'
import HistoryTable from './HistoryTable'

/** 決勝の傾向(分布・傾向系): 出番順別/王者の1本目順位/結成年数別/事務所別。記録・統計の「決勝」タブが表示 */
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
      <h3 className="section-title">出番順別の成績(ファーストラウンド)</h3>
      <p className="section-note">
        どの出番順が優勝しやすいか。全21大会分。10番手は決勝10組の年(2017年以降ほか)のみ存在。
      </p>
      <HistoryTable caption="出番順別の成績(ファーストラウンド)">
          <thead>
            <tr>
              <th scope="col">出番順</th>
              <th scope="col">出場</th>
              <th scope="col">最終決戦進出</th>
              <th scope="col">優勝</th>
              <th scope="col">優勝コンビ</th>
            </tr>
          </thead>
          <tbody>
            {fs.firstRoundOrderStats.map((r) => (
              <tr key={r.order}>
                <td className="no">{r.order}</td>
                <td className="no">{r.appearances}</td>
                <td className="no">{r.finalists}</td>
                <td className="no">{r.wins}</td>
                <td className="names-cell">
                  <WinnersCell winners={r.winners} />
                </td>
              </tr>
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
              <tr key={r.order}>
                <td className="no">{r.order}番手</td>
                <td className="no">{r.appearances}</td>
                <td className="no">{r.wins}</td>
                <td className="names-cell">
                  <WinnersCell winners={r.winners} />
                </td>
              </tr>
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
        </HistoryTable>

      <h3 className="section-title">結成年数別の到達数</h3>
      <p className="section-note">
        結成N年 = 大会年 − 結成年(出場資格と同じ数え方)。決勝/準決勝/準々決勝は延べ(コンビ×年)で、上位ラウンド進出年は下位ラウンドにも数える。
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
        </HistoryTable>

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
              const rows: { label: string; entrants: number; finalists: number; champions: number }[] = []
              for (const r of fs.nameLengthStats) {
                if (r.length <= 9) {
                  rows.push({ label: `${r.length}文字`, ...r })
                } else {
                  const last = rows[rows.length - 1]
                  if (last && last.label === '10文字以上') {
                    last.entrants += r.entrants
                    last.finalists += r.finalists
                    last.champions += r.champions
                  } else {
                    rows.push({ label: '10文字以上', entrants: r.entrants, finalists: r.finalists, champions: r.champions })
                  }
                }
              }
              return rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="no">{r.entrants.toLocaleString('ja-JP')}</td>
                  <td className="no">{r.finalists > 0 ? r.finalists : ''}</td>
                  <td className="no">{r.champions > 0 ? r.champions : ''}</td>
                  <td className="no">
                    {r.finalists > 0 ? `${((r.finalists / r.entrants) * 100).toFixed(2)}%` : ''}
                  </td>
                </tr>
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
                <tr key={a.agency}>
                  <td className="no">{ranks[i]}</td>
                  <td>{a.agency}</td>
                  <td className="no">{a.value}</td>
                  <td className="no">{a.combis}</td>
                </tr>
              ))
            })()}
          </tbody>
        </HistoryTable>
    </>
  )
}
