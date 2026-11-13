import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'

import CombiLink from '../components/CombiLink'
import FinalsScoreTable from '../components/FinalsScoreTable'
import { ErrorState, Loading, NotFound } from '../components/PageState'
import ScrollNav, { type ScrollNavItem } from '../components/ScrollNav'
import { useFinals, useMeta } from '../lib/api'
import { parseYear } from '../lib/params'
import { competitionRanksOf } from '../lib/rank'
import type { FinalsFile } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/** 王者と最終決戦の票。いちばん知りたい「誰が勝ったか」を表より先に出す */
function Champion({ finals }: { finals: FinalsFile }) {
  const final = useMemo(
    () => [...(finals.finalRound ?? [])].sort((a, b) => (b.votes ?? -1) - (a.votes ?? -1)),
    [finals.finalRound],
  )
  const champion = final.find((r) => r.champion)
  // 1本目の公式順位(合計の高い順)
  const firstRound = finals.firstRound
  const ranks = competitionRanksOf(firstRound.map((r) => r.total))
  const champIndex = champion ? firstRound.findIndex((r) => r.name === champion.name) : -1
  const totalVotes = final.reduce((sum, r) => sum + (r.votes ?? 0), 0)

  if (!champion) return null
  return (
    <div className="finals-champion">
      <div className="finals-champion-main">
        <span className="finals-champion-label">優勝</span>
        <CombiLink id={champion.combiId} className="finals-champion-name">
          {champion.name}
        </CombiLink>
        <span className="finals-champion-sub">
          {champion.votes != null && totalVotes > 0 && `最終決戦 ${totalVotes}票中${champion.votes}票`}
          {champIndex >= 0 && firstRound[champIndex].total != null && (
            <>
              {' '}
              ／ 1本目 {ranks[champIndex]}位 {firstRound[champIndex].total}点
            </>
          )}
        </span>
      </div>
      <div>
        <h2 className="finals-sub-heading">最終決戦</h2>
        <ol className="finals-votes">
          {final.map((r) => (
            <li key={r.name} className={r.champion ? 'is-champion' : undefined}>
              <span className="finals-votes-order">{r.order != null ? `${r.order}番手` : ''}</span>
              <span className="finals-votes-name">
                <CombiLink id={r.combiId}>{r.name}</CombiLink>
                {r.champion && <span className="sr-only">(優勝)</span>}
                {r.voters && (
                  <span className="finals-votes-voters">
                    {r.voters.length > 0 ? r.voters.join('・') : '投票なし'}
                  </span>
                )}
              </span>
              <span className="finals-votes-count">
                {r.votes ?? '—'}
                <small>票</small>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export default function FinalsPage() {
  const { year: yearParam } = useParams()
  const { data: meta, isError: metaError } = useMeta()
  const finalsYears = useMemo(() => meta?.finalsYears ?? [], [meta])
  const year = parseYear(yearParam)
  const hasFinals = year !== null && finalsYears.includes(year)
  const { data: finals, isError } = useFinals(hasFinals ? year : null)
  useDocumentTitle(finals ? `M-1グランプリ${finals.year} 決勝の得点` : null)

  const yearItems = useMemo<ScrollNavItem[]>(
    () =>
      [...finalsYears]
        .sort((a, b) => b - a)
        .flatMap((y, i, arr): ScrollNavItem[] => [
          ...(i > 0 && arr[i - 1] - y > 1 ? [{ key: `gap-${y}`, separator: '休止' }] : []),
          { key: String(y), to: `/finals/${y}`, label: y, current: y === year },
        ]),
    [finalsYears, year],
  )

  if (metaError || isError) return <ErrorState message="決勝のデータを読み込めませんでした。" />
  if (!meta) return <Loading />
  if (year === null || !hasFinals) {
    // 大会はあるが決勝がまだ(シーズン中)の年は、その年の一覧へ案内する
    const inSeason = year !== null && meta.years.includes(year)
    return (
      <NotFound title={year ? `${year}年の決勝の得点はありません` : 'ページが見つかりません'}>
        {inSeason ? (
          <p>
            {year}年の決勝はまだ行われていません。<Link to={`/years/${year}`}>{year}年の結果一覧</Link>
            で、いまの勝ち上がりを見られます。
          </p>
        ) : (
          <p>この年の決勝の記録はありません(2011〜2014年は大会が開かれていません)。</p>
        )}
      </NotFound>
    )
  }
  if (!finals) return <Loading />

  const hasOrder = finals.firstRound.some((r) => r.order != null)
  const hasRevival = finals.firstRound.some((r) => r.revival)

  return (
    <div className="finals-page">
      {/* 舞台色の帯(案C で大胆にする2か所のうちの1つ)。王者 → 最終決戦 → 1本目の得点表 の順 */}
      <section className="finals-stage on-stage" aria-labelledby="finals-title">
        <div className="finals-head">
          <h1 id="finals-title" className="page-title">
            M-1グランプリ {finals.year} 決勝
          </h1>
          <Link className="finals-year-link" to={`/years/${finals.year}?round=final`}>
            {finals.year}年の全回戦の結果
          </Link>
        </div>
        <ScrollNav label="年" variant="pills" items={yearItems} className="on-stage-nav" />

        <Champion finals={finals} />

        <h2 className="finals-sub-heading">1本目(ファーストラウンド)の得点</h2>
        <details className="note finals-help">
          <summary>
            <span className="note-label">表の見方・使い方</span>
          </summary>
          <ul>
            <li>順位は1本目の合計点の順。優勝は最終決戦の票で決まります。</li>
            <li>点数の横の (N) は、その審査員がつけた点の中での順位です。点数の色は本家のテロップと同じく、90点以上が金、89点以下が白。</li>
            <li>コンビ名の下の「N回目」は、その年の時点で何回目の決勝か。「最終決戦」の印は最終決戦に進んだ組です。</li>
            {hasRevival && <li>「敗者復活」は敗者復活戦を勝ち上がって決勝に進んだ組です。</li>}
            {hasOrder && <li>出番は1本目のネタの順番です。</li>}
            <li>列の見出し(審査員名・出番・合計)を押すと並べ替えます。審査員の □ を外すと、その人を除いた合計と順位になります(見出しが「合計*」になります)。</li>
            <li>
              「あなた」の列に 0〜100 の点を入れると、あなたを審査員に加えた合計と順位になります。↑↓で1点ずつ、Enter で出番順の次の組へ、Esc でその組を消します。点数はこの端末のブラウザに年ごとに残ります。審査員を「全員を外す」と、あなたの採点だけの順位になります。
            </li>
          </ul>
        </details>
        <FinalsScoreTable key={finals.year} finals={finals} />
      </section>

      {finals.year === 2001 && (
        <p className="legend">
          第1回のみ「大阪・札幌・福岡」3会場の一般客各100人(1人1点・計300点)＋審査員7名×各100点＝満点1000点。会場別の内訳の出典:{' '}
          <a href="http://www.hanjoan.com/project/m1.htm" target="_blank" rel="noreferrer">
            半帖庵
          </a>
          (3会場の合計は公式の会場票と一致)。
        </p>
      )}
      <p className="legend">
        出典:{' '}
        <a href={finals.source} target="_blank" rel="noreferrer">
          Wikipedia
        </a>
      </p>
    </div>
  )
}
