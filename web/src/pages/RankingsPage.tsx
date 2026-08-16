import { Link } from 'react-router-dom'

import { useFinalsStats, useRankings } from '../lib/api'
import { competitionRanks, sliceWithTies } from '../lib/rank'
import type { FinalsStats, FinalsStatsWinner } from '../lib/types'

const SHOWN = 15 // 各ランキングの表示件数(境界の同点はすべて表示)

const SECTIONS: { key: keyof import('../lib/types').Rankings; title: string; unit: string; note?: string }[] = [
  { key: 'mostFinals', title: '決勝 最多進出', unit: '回', note: '決勝に進んだ回数' },
  { key: 'mostQuarterfinals', title: '準々決勝 最多進出', unit: '回', note: '準々決勝に進んだ回数（勝ち上がりは問わない）' },
  { key: 'mostSemifinalFails', title: '準決勝 最多敗退', unit: '回', note: 'あと一歩の悲運ランキング' },
  { key: 'mostFirstRoundFails', title: '1回戦 最多敗退', unit: '回', note: 'それでも挑み続けた記録' },
]

interface RankRow {
  id: number | null
  name: string
  value: number
  /** 該当年のリスト(あれば2行目に表示) */
  years?: number[]
}

function RankTable({ items, unit }: { items: RankRow[]; unit: string }) {
  // 同値は順位を共有する(標準競技順位: 1,1,3,…)
  const rank = competitionRanks(items, (it) => it.value)
  const hasYears = items.some((it) => it.years && it.years.length > 0)
  return (
    <ol className={`rank-list${hasYears ? ' vote-list' : ''}`}>
      {items.map((item, i) => (
        <li key={item.id ?? item.name}>
          <div className="rank-main">
            <span className={`rank-pos${rank[i] === 1 ? ' champion' : ''}`}>{rank[i]}</span>
            {item.id != null ? (
              <Link className="rank-name" to={`/combi/${item.id}`} title={item.name}>
                {item.name}
              </Link>
            ) : (
              <span className="rank-name" title={item.name}>
                {item.name}
              </span>
            )}
            <span className="rank-value">
              {item.value}
              <small>{unit}</small>
            </span>
          </div>
          {item.years && item.years.length > 0 && (
            <div className="rank-voters">{item.years.join('・')}</div>
          )}
        </li>
      ))}
    </ol>
  )
}

/** 優勝コンビセル: 「コンビ名(年)」をリンクつきで列挙 */
function WinnersCell({ winners }: { winners: FinalsStatsWinner[] }) {
  if (winners.length === 0) return <>—</>
  return (
    <>
      {winners.map((w, i) => (
        <span key={`${w.year}-${w.name}`} className="winner-item">
          {i > 0 && '・'}
          {w.combiId != null ? <Link to={`/combi/${w.combiId}`}>{w.name}</Link> : w.name}({w.year})
        </span>
      ))}
    </>
  )
}

function FinalsRecords({ fs }: { fs: FinalsStats }) {
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
      <h2 className="section-title">最終決戦 最多進出</h2>
      <p className="section-note">全21大会(2001〜2025)の最終決戦(1本目上位2〜3組)に進んだ回数。同点は全組表示。</p>
      <RankTable
        items={sliceWithTies(fs.mostFinalRoundAppearances, SHOWN, (it) => it.value)}
        unit="回"
      />

      <h2 className="section-title">歴代最高スコア(得点偏差値)</h2>
      <p className="section-note">
        偏差値 = その年のファーストラウンド得点内での (得点−平均)÷標準偏差×10+50。
        審査員数・満点(2001年は1000点満点)・採点の辛さが違う年をまたいで比較するための正規化。上位20+同点。
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
            {fs.topDeviationScores.map((d) => (
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

export default function RankingsPage() {
  const { data, isLoading, isError } = useRankings()
  const { data: finalsStats } = useFinalsStats()
  if (isError) return <div className="error-box">ランキングを読み込めませんでした。</div>
  if (isLoading || !data) return <div className="loading">読み込み中…</div>

  return (
    <>
      <h1 className="page-title">記録ランキング</h1>
      <p className="page-lede">
        公式コンビ情報(2015年以降)から集計した通算記録・各ランキング上位{SHOWN}組(同点は全組表示)。 2001年からの全期間は
        <Link to="/stats">統計の到達回数ランキング</Link>を参照。
      </p>
      <div className="rank-grid">
        {SECTIONS.map((s) => (
          <section key={s.key} className="rank-section">
            <h2 className="section-title">{s.title}</h2>
            {s.note && <p className="section-note">{s.note}</p>}
            <RankTable items={sliceWithTies(data[s.key], SHOWN, (it) => it.value)} unit={s.unit} />
          </section>
        ))}
      </div>
      {finalsStats && (
        <>
          <h1 className="page-title">決勝の記録</h1>
          <p className="page-lede">全21大会(2001〜2025)の決勝得点表・最終決戦データから集計。</p>
          <FinalsRecords fs={finalsStats} />
        </>
      )}
    </>
  )
}
