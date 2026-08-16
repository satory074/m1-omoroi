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
        コンビ名横の(N回目) = その年時点で通算N回目の決勝進出。点数横の(N) = その審査員がつけた点数の中での順位。
      </p>
      {finals.firstRound.some((r) => r.order != null) && (
        <p className="legend">出番 = ファーストラウンドのネタ披露順。</p>
      )}
      {finals.firstRound.some((r) => r.revival) && (
        <p className="legend">
          <span className="revival-chip">敗者復活</span> = 敗者復活戦を勝ち上がって決勝へ進出した組。
        </p>
      )}
      <p className="legend">
        点数の色(本家テロップ準拠): <span className="score-legend gold">90点以上=金</span>{' '}
        <span className="score-legend">89点以下=白</span>
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
          <ol className="rank-list vote-list">
            {[...finals.finalRound]
              .sort((a, b) => (b.votes ?? -1) - (a.votes ?? -1))
              .map((row) => (
              <li key={row.name}>
                <div className="rank-main">
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
                  {row.order != null && <span className="vote-order">{row.order}番手</span>}
                  <span className="rank-value">
                    {row.votes != null ? row.votes : ''}
                    <small>{row.votes != null ? '票' : ''}</small>
                  </span>
                </div>
                {row.voters && row.voters.length > 0 && (
                  <div className="rank-voters">{row.voters.join('・')}</div>
                )}
              </li>
            ))}
          </ol>
          {finals.finalRound.some((r) => r.order != null) && (
            <p className="legend">N番手 = 最終決戦のネタ披露順(並びは得票順)。</p>
          )}
          {finals.finalRound.some((r) => r.voters && r.voters.length > 0) && (
            <p className="legend">コンビ名の下の審査員名 = 最終決戦でその組に投票した審査員。</p>
          )}
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
