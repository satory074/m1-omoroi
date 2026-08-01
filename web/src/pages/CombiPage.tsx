import { Link, useParams } from 'react-router-dom'

import { useCombiDetail, usePopularity } from '../lib/api'
import { RESULT_DISPLAY, ROUND_LABEL, ROUND_ORDER, formatHits } from '../lib/rounds'
import type { ResultKey } from '../lib/types'

export default function CombiPage() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const { data: combi, isLoading, isError } = useCombiDetail(Number.isFinite(id) ? id : null)
  const { data: popularity } = usePopularity()

  if (isError) return <div className="error-box">このコンビのデータを読み込めませんでした。</div>
  if (isLoading || !combi) return <div className="loading">読み込み中…</div>

  const hits = popularity?.hits[String(id)]
  const years = Object.keys(combi.history)
    .map(Number)
    .sort((a, b) => b - a)

  return (
    <>
      <h1 className="page-title combi-name">
        {combi.name}
        {combi.kana && combi.kana !== combi.name && <span className="combi-kana">{combi.kana}</span>}
      </h1>
      <p className="page-lede">
        {[
          combi.belong,
          combi.formedRaw && `結成 ${combi.formedRaw}`,
          hits && `YouTube関連動画再生数 ${formatHits(hits.n)}回 (${hits.at}時点)`,
        ]
          .filter(Boolean)
          .join(' ・ ')}
      </p>

      {combi.members.length > 0 && (
        <div className="member-cards">
          {combi.members.map((m, i) => (
            <div className="member-card" key={i}>
              <div className="member-name">{m.name}</div>
              <div className="member-info">
                {[m.kana, m.birth && `生年月日 ${m.birth}`, m.from && `出身 ${m.from}`]
                  .filter(Boolean)
                  .join(' / ')}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="section-title">出場と結果</h2>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>年</th>
              <th>No.</th>
              {ROUND_ORDER.map((rk) => (
                <th key={rk}>{ROUND_LABEL[rk]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const h = combi.history[String(y)]
              return (
                <tr key={y}>
                  <td className="year">
                    <Link to={`/years/${y}`}>{y}</Link>
                  </td>
                  <td className="no">{h.no ?? '—'}</td>
                  {ROUND_ORDER.map((rk) => {
                    const res = h.results[rk] as ResultKey | undefined
                    if (!res) return <td key={rk} className="none" />
                    const disp = RESULT_DISPLAY[res]
                    return (
                      <td key={rk} className={`cell ${res}`} title={disp.label}>
                        <span aria-hidden>{disp.sym}</span>
                        <span className="sr-only">{disp.label}</span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="legend">
        ◎ シード通過 / ○ 通過 / × 敗退 / ★ 優勝
      </p>

      <p>
        <a className="official-link" href={combi.officialUrl} target="_blank" rel="noreferrer">
          公式サイトのコンビ情報を見る →
        </a>
      </p>
    </>
  )
}
