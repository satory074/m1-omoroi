import { Link, useParams } from 'react-router-dom'

import { useFinals, useMeta } from '../lib/api'

export default function FinalsPage() {
  const { year: yearParam } = useParams()
  const { data: meta } = useMeta()
  const finalsYears = meta?.finalsYears ?? []
  const year = yearParam ? Number(yearParam) : (finalsYears.at(-1) ?? null)
  const { data: finals, isLoading } = useFinals(year)

  if (!meta || isLoading) return <div className="loading">読み込み中…</div>

  if (finalsYears.length === 0 || !finals) {
    return (
      <>
        <h1 className="page-title">決勝の得点</h1>
        <div className="board-empty">決勝の得点データは準備中です。</div>
      </>
    )
  }

  return (
    <>
      <div className="year-strip">
        {[...finalsYears]
          .sort((a, b) => b - a)
          .map((y) => (
            <Link key={y} to={`/finals/${y}`} className={y === year ? 'active' : ''}>
              {y}
            </Link>
          ))}
      </div>
      <h1 className="page-title">M-1グランプリ {year} 決勝</h1>
      <div className="history-wrap">
        <table className="history finals-table">
          <thead>
            <tr>
              <th>順</th>
              <th>コンビ</th>
              {finals.judges.map((j) => (
                <th key={j}>{j}</th>
              ))}
              <th>合計</th>
            </tr>
          </thead>
          <tbody>
            {[...finals.firstRound]
              .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
              .map((row) => (
              <tr key={row.name}>
                <td className="no">{row.rank ?? ''}</td>
                <td>
                  {row.combiId != null ? (
                    <Link to={`/combi/${row.combiId}`}>{row.name}</Link>
                  ) : (
                    row.name
                  )}
                </td>
                {(row.scores ?? []).map((s, i) => (
                  <td key={i} className="no">
                    {s ?? ''}
                  </td>
                ))}
                  <td className="no total">{row.total ?? ''}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="legend">順位はファーストラウンドの得点順。優勝は最終決戦の得票で決定します。</p>
      {finals.finalRound && finals.finalRound.length > 0 && (
        <>
          <h2 className="section-title">最終決戦</h2>
          <ol className="rank-list">
            {[...finals.finalRound]
              .sort((a, b) => (b.votes ?? -1) - (a.votes ?? -1))
              .map((row) => (
              <li key={row.name}>
                <span className={`rank-pos ${row.champion ? 'champion' : ''}`}>
                  {row.champion ? '★' : ''}
                </span>
                {row.combiId != null ? (
                  <Link className="rank-name" to={`/combi/${row.combiId}`}>
                    {row.name}
                  </Link>
                ) : (
                  <span className="rank-name">{row.name}</span>
                )}
                <span className="rank-value">
                  {row.votes != null ? row.votes : ''}
                  <small>{row.votes != null ? '票' : ''}</small>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="legend">
        出典:{' '}
        <a href={finals.source} target="_blank" rel="noreferrer">
          Wikipedia
        </a>
      </p>
    </>
  )
}
