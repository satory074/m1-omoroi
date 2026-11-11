import type { ReactNode } from 'react'
import { Navigate, NavLink, useParams } from 'react-router-dom'

import CareerRecords from '../components/CareerRecords'
import CombiRecords from '../components/CombiRecords'
import FinalsRecords from '../components/FinalsRecords'
import FinalsTrends from '../components/FinalsTrends'
import { JudgeCareerSection, JudgesYearlySection } from '../components/JudgesRecords'
import PopularityRanking from '../components/PopularityRanking'
import RecordsExplorer from '../components/RecordsExplorer'
import TournamentStats from '../components/TournamentStats'
import {
  useFinalsStats,
  useJudgesStats,
  usePeopleStats,
  useRankings,
  useStats,
} from '../lib/api'

/**
 * 記録・統計(旧「記録ランキング」と「統計」を統合)。テーマ別のタブをパス(/stats/:section)で分け、
 * 各タブは自分の JSON だけを取りに行く。ランキング(順位付け)と傾向(分布)を同じテーマの中に並べる。
 * タブをクエリにしないのは、ヘッダーの検索パネルが ?tab= を使っていて衝突するため。
 */
const SECTIONS = [
  { key: '', label: '大会' },
  { key: 'combi', label: 'コンビ' },
  { key: 'finals', label: '決勝' },
  { key: 'judges', label: '審査員' },
  { key: 'people', label: '人物' },
  { key: 'popularity', label: '注目度' },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

/** 読み込み中・失敗・ファイル無し(fetchJsonOrNull が null)を各タブで同じ見せ方にする */
function Loaded<T>({
  q,
  children,
}: {
  q: { data: T | null | undefined; isError: boolean }
  children: (data: T) => ReactNode
}) {
  if (q.isError) return <div className="error-box">データを読み込めませんでした。再読み込みしてください。</div>
  if (q.data === undefined) return <div className="loading">読み込み中…</div>
  if (q.data === null) return <div className="board-empty">このデータはまだありません。</div>
  return <>{children(q.data)}</>
}

function TournamentTab() {
  const q = useStats()
  return (
    <>
      <p className="page-lede">
        エントリー数と回戦ごとの通過の推移。2001〜2010年は公式アーカイブに残っている範囲のみです。
      </p>
      <Loaded q={q}>{(data) => <TournamentStats data={data} />}</Loaded>
    </>
  )
}

function CombiTab() {
  const q = useRankings()
  return (
    <>
      <p className="page-lede">
        公式コンビ情報(2015年以降)から集計したコンビの通算記録。各ランキング上位15組(同点は全組表示)。
        決勝の記録は「決勝」タブ、人の記録は「人物」タブへ。
      </p>
      <Loaded q={q}>{(data) => <CombiRecords data={data} />}</Loaded>
    </>
  )
}

function FinalsTab() {
  const q = useFinalsStats()
  return (
    <>
      <p className="page-lede">全21大会(2001〜2025)の決勝得点表・最終決戦データから集計。</p>
      <Loaded q={q}>
        {(fs) => (
          <>
            <h2 className="page-title stats-group">決勝の記録</h2>
            <FinalsRecords fs={fs} />
            <h2 className="page-title stats-group">決勝の傾向</h2>
            <FinalsTrends fs={fs} />
          </>
        )}
      </Loaded>
    </>
  )
}

function JudgesTab() {
  const q = useJudgesStats()
  return (
    <>
      <p className="page-lede">全21大会の決勝得点表と最終決戦の投票から集計した審査員の記録と傾向。</p>
      <Loaded q={q}>
        {(js) => (
          <>
            <JudgeCareerSection js={js} />
            <JudgesYearlySection js={js} />
          </>
        )}
      </Loaded>
    </>
  )
}

function PeopleTab() {
  const q = usePeopleStats()
  return (
    <>
      <p className="page-lede">
        公式コンビ情報のプロフィール(生年月日・出身地・所属・職業・人数)から集計した人の記録。
      </p>
      <Loaded q={q}>
        {(ps) => (
          <>
            <h2 className="page-title stats-group">キャリア・人物の記録</h2>
            <CareerRecords ps={ps} />
          </>
        )}
      </Loaded>
      <RecordsExplorer />
    </>
  )
}

const TABS: Record<SectionKey, () => ReactNode> = {
  '': TournamentTab,
  combi: CombiTab,
  finals: FinalsTab,
  judges: JudgesTab,
  people: PeopleTab,
  popularity: PopularityRanking,
}

export default function StatsPage() {
  const { section = '' } = useParams()
  const current = SECTIONS.find((s) => s.key === section)
  if (!current) return <Navigate to="/stats" replace />
  const Tab = TABS[current.key]

  return (
    <>
      <h1 className="page-title">記録・統計</h1>
      <nav className="stats-tabs" aria-label="記録・統計のテーマ">
        {SECTIONS.map((s) => (
          <NavLink key={s.key} to={s.key ? `/stats/${s.key}` : '/stats'} end>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Tab />
    </>
  )
}
