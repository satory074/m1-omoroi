import { Link, useParams } from 'react-router-dom'

import BestChip from '../components/BestChip'
import CombiPhoto from '../components/CombiPhoto'
import FormedChip from '../components/FormedChip'
import { VideoLinks } from '../components/OfficialVideo'
import { ErrorState, Loading, NotFound } from '../components/PageState'
import TableRegion from '../components/TableRegion'
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
import type { ResultKey, RoundKey } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/** 戦績表の列見出し。狭い画面では略す(読み上げは正式名) */
const SHORT: Record<RoundKey, string> = {
  first: '1回',
  second: '2回',
  third: '3回',
  quarterfinal: '準々',
  semifinal: '準決',
  playoff: '敗復',
  final: '決勝',
}

/** 凡例。表に出てくる記号だけを並べる(以前は ◎○×★ だけで、欠席・出場予定・不明が抜けていた) */
const LEGEND_ORDER: ResultKey[] = ['seed_pass', 'pass', 'fail', 'champion', 'absent', 'scheduled', 'unknown']

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
  // 表に実際に出てくる結果だけを凡例に出す
  const used = new Set<ResultKey>()
  for (const y of years) for (const r of Object.values(combi.history[String(y)].results)) if (r) used.add(r)

  return (
    <div className="combi-page">
      <header className="combi-head">
        {combi.photo && (
          <figure className="combi-photo-wrap" data-photo-scope>
            <CombiPhoto photo={combi.photo} alt={`${combi.name}の宣材写真`} className="combi-photo" eager />
            <figcaption>写真: M-1グランプリ公式サイト</figcaption>
          </figure>
        )}
        <div className="combi-head-text">
          {combi.kana && combi.kana !== combi.name && <p className="combi-kana">{combi.kana}</p>}
          <h1 className="page-title combi-name">{combi.name}</h1>
          <p className="combi-chips">
            {/* 年の文脈が無いページなので通算(全出場年)の最高戦績 */}
            <BestChip level={bestResultOfHistory(combi.history)} />
          </p>
          <dl className="combi-facts">
            {combi.belong && (
              <div>
                <dt>所属</dt>
                <dd>{combi.belong}</dd>
              </div>
            )}
            {combi.formedRaw && (
              <div>
                <dt>結成</dt>
                <dd>{combi.formedRaw}</dd>
              </div>
            )}
            {hits && (
              <div>
                <dt>注目度</dt>
                <dd>
                  YouTube 再生 {formatHits(hits.n)}回{hits.m ? `(うちメンバー名義 ${formatHits(hits.m)}回)` : ''}
                  <span className="combi-facts-note">{hits.at}時点</span>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      {combi.members.length > 0 && (
        <section aria-labelledby="members-title">
          <h2 id="members-title" className="section-heading">
            メンバー
          </h2>
          <ul className="member-list">
            {combi.members.map((m, i) => (
              <li key={i}>
                <span className="member-name">{m.name}</span>
                {m.kana && <span className="member-kana">{m.kana}</span>}
                <span className="member-info">
                  {[m.birth && `${m.birth}生まれ`, m.from && `${m.from}出身`].filter(Boolean).join('　')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="history-title">
        <h2 id="history-title" className="section-heading">
          出場と結果
        </h2>
        <p className="section-lede">
          年を押すと、その年の一覧でこのコンビの行へ移ります。決勝の記号からは、その年の得点表へ移れます。
          {combi.legacy &&
            ' 2001〜2010年は公式アーカイブに基づく記録で、1回戦で敗退した年は記録が残っていないため載っていません。'}
        </p>
        <TableRegion caption={`${combi.name}の出場年ごとの結果(新しい順)`} captionHidden className="history-table">
          <thead>
            <tr>
              <th scope="col">年</th>
              <th scope="col" className="num">
                No.
              </th>
              {ROUND_ORDER.map((rk) => (
                <th key={rk} scope="col" className="cell">
                  <span className="round-full">{ROUND_LABEL[rk]}</span>
                  <span className="round-short" aria-hidden="true">
                    {SHORT[rk]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const h = combi.history[String(y)]
              return (
                <tr key={y}>
                  <th scope="row">
                    {/* その年の一覧の、この組が最後に出た回戦を開き、この組の行へ移る(?focus) */}
                    <Link
                      className="history-year"
                      to={`/years/${y}?round=${furthestRound(h.results) ?? 'first'}&focus=${id}`}
                    >
                      {y}
                      <span className="sr-only">年の一覧でこのコンビを見る</span>
                    </Link>
                    <FormedChip year={y} formed={combi.formed} />
                  </th>
                  <td className="num history-no">{h.no ?? '—'}</td>
                  {ROUND_ORDER.map((rk) => {
                    const res = h.results[rk] as ResultKey | undefined
                    if (!res) return <td key={rk} className="cell" />
                    const disp = RESULT_DISPLAY[res]
                    const label = disp.label || '結果不明'
                    // 決勝に出た年は、記号からその年の得点表へ移れる
                    const toFinals = rk === 'final' && finalsYears.has(y)
                    return (
                      <td key={rk} className={`cell result-${res}`}>
                        {toFinals ? (
                          <Link to={`/finals/${y}`} className="cell-link">
                            <span aria-hidden="true">{disp.sym}</span>
                            <span className="sr-only">
                              {ROUND_LABEL[rk]} {label}({y}年 決勝の得点表へ)
                            </span>
                          </Link>
                        ) : (
                          <>
                            <span aria-hidden="true">{disp.sym}</span>
                            <span className="sr-only">
                              {ROUND_LABEL[rk]} {label}
                            </span>
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
        </TableRegion>
        <ul className="history-legend" aria-label="記号の意味">
          {LEGEND_ORDER.filter((r) => used.has(r)).map((r) => (
            <li key={r}>
              <span className={`result-${r}`} aria-hidden="true">
                {RESULT_DISPLAY[r].sym}
              </span>
              {RESULT_DISPLAY[r].label || '結果不明'}
            </li>
          ))}
          <li>空欄 その回戦に出ていない(その年に回戦が無い場合を含む)</li>
          {hasVideos && (
            <li>
              <span className="yt-icon" aria-hidden /> M-1公式YouTubeの動画
            </li>
          )}
        </ul>
      </section>

      <p className="combi-external">
        {combi.legacy
          ? combi.wikipedia && (
              <a href={combi.wikipedia} target="_blank" rel="noreferrer">
                Wikipedia でコンビ情報を見る
              </a>
            )
          : combi.officialUrl && (
              <a href={combi.officialUrl} target="_blank" rel="noreferrer">
                M-1公式サイトでコンビ情報を見る
              </a>
            )}
      </p>
    </div>
  )
}
