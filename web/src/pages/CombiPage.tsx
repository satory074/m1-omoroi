import { Link, useParams } from 'react-router-dom'

import BestChip from '../components/BestChip'
import CombiPhoto from '../components/CombiPhoto'
import FormedChip from '../components/FormedChip'
import { VideoLinks } from '../components/OfficialVideo'
import { ErrorState, Loading, NotFound } from '../components/PageState'
import { useCombiDetail, useMeta, useOfficialVideos, usePopularity } from '../lib/api'
import { combiVideos } from '../lib/officialVideos'
import { parseId } from '../lib/params'
import {
  RESULT_DISPLAY,
  ROUND_LABEL,
  ROUND_ORDER,
  bestResultOfHistory,
  formatHits,
  furthestRound,
} from '../lib/rounds'
import type { ResultKey } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'

export default function CombiPage() {
  const { id: idParam } = useParams()
  const parsed = parseId(idParam)
  const { data: combi, isError } = useCombiDetail(parsed)
  const { data: popularity } = usePopularity()
  const { data: official } = useOfficialVideos()
  const { data: meta } = useMeta()
  useDocumentTitle(combi ? `${combi.name}のM-1戦績` : null)

  if (parsed === null || combi === null) {
    return (
      <NotFound title="コンビが見つかりません">
        <p>このコンビは記録にありません。名前で探すときは、上の検索欄を使ってください。</p>
      </NotFound>
    )
  }
  if (isError) return <ErrorState message="このコンビのデータを読み込めませんでした。" />
  if (!combi) return <Loading />
  const id = parsed
  const finalsYears = new Set(meta?.finalsYears ?? [])

  const hits = popularity?.hits[String(id)]
  const years = Object.keys(combi.history)
    .map(Number)
    .sort((a, b) => b - a)
  const hasVideos = years.some((y) => ROUND_ORDER.some((rk) => combiVideos(official, y, id, rk).length > 0))

  return (
    <>
      <div className="combi-header">
        {combi.photo && (
          <figure className="combi-photo-wrap" data-photo-scope>
            <CombiPhoto photo={combi.photo} alt={combi.name} className="combi-photo" eager />
            <figcaption className="photo-credit">写真: M-1グランプリ公式サイト</figcaption>
          </figure>
        )}
        <div>
          <h1 className="page-title combi-name">
            {combi.name}
            {/* 年の文脈が無いページなので通算(全出場年)の最高戦績 */}
            <BestChip level={bestResultOfHistory(combi.history)} />
            {combi.kana && combi.kana !== combi.name && (
              <span className="combi-kana">{combi.kana}</span>
            )}
          </h1>
          <p className="page-lede">
            {[
              combi.belong,
              combi.formedRaw && `結成 ${combi.formedRaw}`,
              hits &&
                `YouTube関連動画再生数 ${formatHits(hits.n)}回` +
                  (hits.m ? ` (うちメンバー名義 ${formatHits(hits.m)}回)` : '') +
                  ` (${hits.at}時点)`,
            ]
              .filter(Boolean)
              .join(' ・ ')}
          </p>
        </div>
      </div>

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
      {combi.legacy && (
        <p className="section-note">
          ※ 2001〜2010の公式アーカイブに基づく記録(1回戦敗退の年は公式記録が残っていないため含まれません)
        </p>
      )}
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
                    {/* その年の一覧の、この組が最後に出た回戦を開き、この組の行へ移る(?focus) */}
                    <Link
                      to={`/years/${y}?round=${furthestRound(h.results) ?? 'first'}&focus=${id}`}
                      aria-label={`${y}年の一覧でこのコンビを見る`}
                    >
                      {y}
                    </Link>
                    <FormedChip year={y} formed={combi.formed} />
                  </td>
                  <td className="no">{h.no ?? '—'}</td>
                  {ROUND_ORDER.map((rk) => {
                    const res = h.results[rk] as ResultKey | undefined
                    if (!res) return <td key={rk} className="none" />
                    const disp = RESULT_DISPLAY[res]
                    // 決勝に出た年は、記号からその年の得点表へ移れる
                    const toFinals = rk === 'final' && finalsYears.has(y)
                    return (
                      <td key={rk} className={`cell ${res}`}>
                        {toFinals ? (
                          <Link to={`/finals/${y}`} className="cell-link">
                            <span aria-hidden>{disp.sym}</span>
                            <span className="sr-only">
                              {disp.label}({y}年 決勝の得点表へ)
                            </span>
                          </Link>
                        ) : (
                          <>
                            <span aria-hidden>{disp.sym}</span>
                            <span className="sr-only">{disp.label}</span>
                          </>
                        )}
                        <VideoLinks links={combiVideos(official, y, id, rk)} name={combi.name} />
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
        {hasVideos && (
          <>
            {' / '}
            <span className="yt-icon" aria-hidden /> M-1公式YouTubeの動画
          </>
        )}
      </p>

      {combi.legacy
        ? combi.wikipedia && (
            <p>
              <a className="official-link" href={combi.wikipedia} target="_blank" rel="noreferrer">
                Wikipediaでコンビ情報を見る →
              </a>
            </p>
          )
        : combi.officialUrl && (
            <p>
              <a className="official-link" href={combi.officialUrl} target="_blank" rel="noreferrer">
                公式サイトのコンビ情報を見る →
              </a>
            </p>
          )}
    </>
  )
}
