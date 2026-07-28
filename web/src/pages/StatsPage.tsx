import { useStats } from '../lib/api'
import { ROUND_LABEL, ROUND_ORDER } from '../lib/rounds'

export default function StatsPage() {
  const { data, isLoading, isError } = useStats()
  if (isError) return <div className="error-box">統計を読み込めませんでした。</div>
  if (isLoading || !data) return <div className="loading">読み込み中…</div>

  return (
    <>
      <h1 className="page-title">統計</h1>
      <p className="page-lede">年度ごとのエントリー数と回戦別の通過数</p>
      <div className="history-wrap">
        <table className="history stats-table">
          <thead>
            <tr>
              <th>年</th>
              <th>エントリー</th>
              {ROUND_ORDER.map((rk) => (
                <th key={rk}>{ROUND_LABEL[rk]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data.byYear]
              .sort((a, b) => b.year - a.year)
              .map((y) => (
                <tr key={y.year}>
                  <td className="year">{y.year}</td>
                  <td className="no">{y.entries.toLocaleString('ja-JP')}</td>
                  {ROUND_ORDER.map((rk) => {
                    const r = y.byRound[rk]
                    return (
                      <td key={rk} className="no">
                        {r ? `${r.passed.toLocaleString('ja-JP')}/${r.appeared.toLocaleString('ja-JP')}` : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="legend">各セルは「通過数/出場数」</p>
    </>
  )
}
