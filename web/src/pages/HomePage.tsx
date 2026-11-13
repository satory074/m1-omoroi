import { Link } from 'react-router-dom'

import CombiLink from '../components/CombiLink'
import { useChampions, useFinals, useMeta, useStats } from '../lib/api'
import { ROUND_LABEL } from '../lib/rounds'
import type { RoundKey, YearStats } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/** 進み具合に並べる回戦(敗者復活戦は本線の段階に数えない) */
const STEPS: RoundKey[] = ['first', 'second', 'third', 'quarterfinal', 'semifinal', 'final']

type StepState = 'done' | 'waiting' | 'upcoming'

function stepsOf(stats: YearStats | undefined) {
  return STEPS.map((rk) => {
    const r = stats?.byRound[rk]
    // 出場者がいて通過者がまだ0 = 結果待ち。出場者が居なければ未実施
    const state: StepState = !r || r.appeared === 0 ? 'upcoming' : r.passed > 0 ? 'done' : 'waiting'
    return { rk, appeared: r?.appeared ?? 0, passed: r?.passed ?? 0, state }
  })
}

const STATS_LINKS = [
  { to: '/stats', name: '大会', desc: 'エントリー数と、回戦ごとの通過率の推移' },
  { to: '/stats/combi', name: 'コンビ', desc: '準々決勝の最多進出、連続出場などの通算記録' },
  { to: '/stats/finals', name: '決勝', desc: '最多進出・出番順の有利不利・得点偏差値' },
  { to: '/stats/judges', name: '審査員', desc: '辛口・甘口と、年ごとの採点の傾向' },
  { to: '/stats/people', name: '人物', desc: '最年少・最年長の記録と出身地の地図' },
  { to: '/stats/popularity', name: '注目度', desc: 'YouTube の再生数で見る人気ランキング' },
] as const

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * トップページ。初めて来た人に「何のサイトか」を伝え、2つの使い方の入口を同じ重さで並べる:
 *   シーズン中の結果確認(今年の大会の進み具合 → 各回戦の一覧)と、記録・統計を読むこと。
 * 読むのは小さなファイルだけ(meta・stats・champions・最新の決勝 = 合計約12KB)。年度ファイル(数百KB)は読まない。
 */
export default function HomePage() {
  useDocumentTitle('')
  const { data: meta } = useMeta()
  const { data: stats } = useStats()
  const { data: championsFile } = useChampions()
  const champion = championsFile?.champions.at(-1)
  const { data: finals } = useFinals(champion?.year ?? null)

  const latest = meta?.latestYear
  const steps = stepsOf(stats?.byYear.find((y) => y.year === latest))
  const waiting = steps.find((s) => s.state === 'waiting')
  const votes = finals?.finalRound?.find((r) => r.champion)?.votes
  const totalVotes = finals?.finalRound?.reduce((sum, r) => sum + (r.votes ?? 0), 0)
  const years = meta ? [...meta.years].sort((a, b) => b - a) : []

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-text">
          <h1 className="home-title">
            M-1グランプリの全回戦を、
            <br />
            全コンビ分。
          </h1>
          <p className="home-lede">
            2001年から{latest ?? ''}年まで、1回戦から決勝までの通過と敗退をたどれる非公式の記録サイトです。
          </p>
          {/* ヘッダーの検索欄の label。押すとそのまま検索欄に入力できる(検索の仕組みは1つだけにする) */}
          <label htmlFor="site-search" className="home-search">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <span>コンビ名・芸人名で探す（例: たくろう）</span>
          </label>
          {meta && <p className="home-updated">データ更新 {formatDate(meta.generatedAt)}</p>}
        </div>

        {champion && (
          <figure className="home-champion">
            <figcaption>{champion.year}年 王者</figcaption>
            <CombiLink id={champion.id} className="home-champion-name">
              {champion.name}
            </CombiLink>
            {votes != null && totalVotes ? (
              <p>
                最終決戦 {totalVotes}票中{votes}票
              </p>
            ) : null}
            <Link to={`/finals/${champion.year}`} className="home-champion-link">
              {champion.year}年 決勝の得点表を見る
            </Link>
          </figure>
        )}
      </section>

      {latest && (
        <section className="home-season on-stage" aria-labelledby="home-season-title">
          <div className="home-season-inner">
            <div className="home-season-head">
              <h2 id="home-season-title">{latest}年大会</h2>
              {waiting && <p>{ROUND_LABEL[waiting.rk]}の結果待ち</p>}
              <Link to={`/years/${latest}`} className="home-season-all">
                {latest}年の一覧へ
              </Link>
            </div>
            <ol className="home-steps">
              {steps.map((s) => (
                <li key={s.rk} className={`home-step ${s.state}`}>
                  {s.state === 'upcoming' ? (
                    <div className="home-step-body">
                      <span className="home-step-round">{ROUND_LABEL[s.rk]}</span>
                      <span className="home-step-count">—</span>
                      <span className="home-step-note">未実施</span>
                    </div>
                  ) : (
                    <Link className="home-step-body" to={`/years/${latest}?round=${s.rk}`}>
                      <span className="home-step-round">{ROUND_LABEL[s.rk]}</span>
                      <span className="home-step-count">
                        {s.appeared.toLocaleString('ja-JP')}
                        <small>組</small>
                      </span>
                      <span className="home-step-note">
                        {s.state === 'waiting' ? '結果待ち' : `通過 ${s.passed.toLocaleString('ja-JP')}組`}
                      </span>
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <section className="home-section" aria-labelledby="home-stats-title">
        <h2 id="home-stats-title">記録・統計</h2>
        <ul className="home-stats">
          {STATS_LINKS.map((s) => (
            <li key={s.to}>
              <Link to={s.to}>
                <span className="home-stats-name">{s.name}</span>
                <span className="home-stats-desc">{s.desc}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {years.length > 0 && (
        <section className="home-section" aria-labelledby="home-years-title">
          <h2 id="home-years-title">年度別の結果</h2>
          <p className="home-note">2011〜2014年は大会が開かれていません。</p>
          <ul className="home-years">
            {years.map((y) => (
              <li key={y}>
                <Link to={`/years/${y}`}>{y}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
