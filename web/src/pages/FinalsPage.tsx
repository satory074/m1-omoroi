import { Link, useParams } from 'react-router-dom'

import FinalsScoreTable from '../components/FinalsScoreTable'
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
      <FinalsScoreTable key={finals.year} finals={finals} />
      <p className="legend">
        順位はファーストラウンドの得点順。優勝は最終決戦の得票で決定します。審査員のヘッダをクリックで並べ替え、チェックを外すとその審査員を除いた合計・順位に再集計されます。
      </p>
      <p className="legend">
        点数の色: <span className="medal-gold">90点以上=金</span> / <span className="medal-silver">80〜89点=銀</span>{' '}
        / <span className="medal-bronze">79点以下=銅</span>
      </p>
      <p className="legend">
        <span className="finalist-swatch" />背景が淡い赤の行 = 最終決戦へ進出した組(1本目の上位2〜3組)。
      </p>
      {finals.year === 2001 && (
        <p className="legend">
          第1回のみ「大阪・札幌・福岡」3会場の一般客各100人(1人1点・計300点)＋審査員7名×各100点＝満点1000点。会場別内訳の出典:{' '}
          <a href="http://www.hanjoan.com/project/m1.htm" target="_blank" rel="noreferrer">
            半帖庵
          </a>
          (3会場合計は公式の会場票と一致)。
        </p>
      )}
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
