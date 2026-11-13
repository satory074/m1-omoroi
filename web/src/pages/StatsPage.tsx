import { useRef, type ReactNode } from 'react'
import { Navigate, useParams } from 'react-router-dom'

import CareerRecords from '../components/CareerRecords'
import CombiRecords from '../components/CombiRecords'
import FinalsRecords from '../components/FinalsRecords'
import FinalsTrends from '../components/FinalsTrends'
import { JudgeCareerSection, JudgesYearlySection } from '../components/JudgesRecords'
import PageToc from '../components/PageToc'
import { ErrorState, Loading } from '../components/PageState'
import PopularityRanking from '../components/PopularityRanking'
import RecordsExplorer from '../components/RecordsExplorer'
import ScrollNav from '../components/ScrollNav'
import TournamentStats from '../components/TournamentStats'
import {
  useFinalsStats,
  useJudgesStats,
  useMeta,
  usePeopleStats,
  useRankings,
  useStats,
} from '../lib/api'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * 記録・統計(旧「記録ランキング」と「統計」を統合)。テーマ別のタブをパス(/stats/:section)で分け、
 * 各タブは自分の JSON だけを取りに行く。ランキング(順位付け)と傾向(分布)を同じテーマの中に並べる。
 * タブをクエリにしないのは、ヘッダーの検索パネルが ?tab= を使っていて衝突するため。
 * タブはページを移るリンクなので ARIA のタブにはせず、1段の ScrollNav にする(スマホで2段に折り返さない)。
 * 見出しの段: h1 記録・統計 > h2 まとまり(決勝の記録 等)> h3 各記録。まとまりの無いタブは h2 が各記録。
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
  if (q.isError) return <ErrorState />
  if (q.data === undefined) return <Loading />
  if (q.data === null) return <p className="page-state">このデータはまだありません。</p>
  return <>{children(q.data)}</>
}

/** 決勝の大会数と期間(「全21大会(2001〜2025年)」)。以前は文言に直書きしていて年が変わると古くなった */
function useFinalsSpan() {
  const { data: meta } = useMeta()
  const ys = meta?.finalsYears ?? []
  return ys.length ? `全${ys.length}大会(${ys[0]}〜${ys.at(-1)}年)` : ''
}

function TournamentTab() {
  const q = useStats()
  return (
    <>
      <p className="page-lede">
        エントリー数と回戦ごとの通過の推移。2001〜2010年は公式アーカイブに残っている範囲のみです。2011〜2014年は大会が開かれていません。
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
        公式コンビ情報(2015年以降)から集計したコンビの通算記録です。各ランキングは上位15組で、同点の組はすべて出します。
      </p>
      <Loaded q={q}>{(data) => <CombiRecords data={data} />}</Loaded>
    </>
  )
}

function FinalsTab() {
  const q = useFinalsStats()
  const span = useFinalsSpan()
  return (
    <>
      <p className="page-lede">{span}の決勝の得点表と最終決戦の投票から集計しました。</p>
      <Loaded q={q}>
        {(fs) => (
          <>
            <h2 className="stats-group">決勝の記録</h2>
            <FinalsRecords fs={fs} />
            <h2 className="stats-group">決勝の傾向</h2>
            <FinalsTrends fs={fs} />
          </>
        )}
      </Loaded>
    </>
  )
}

function JudgesTab() {
  const q = useJudgesStats()
  const span = useFinalsSpan()
  return (
    <>
      <p className="page-lede">{span}の決勝の得点表と最終決戦の投票から集計した、審査員の記録と傾向です。</p>
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
        公式コンビ情報のプロフィール(生年月日・出身地・所属・職業・人数)から集計した、人の記録です。
      </p>
      <Loaded q={q}>
        {(ps) => (
          <>
            <h2 className="stats-group">キャリア・人物の記録</h2>
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
  useDocumentTitle(current ? `記録・統計 ${current.label}` : null)
  const bodyRef = useRef<HTMLDivElement>(null)
  if (!current) return <Navigate to="/stats" replace />
  const Tab = TABS[current.key]

  return (
    <div className="stats-page">
      <h1 className="page-title stats-title">記録・統計</h1>
      <ScrollNav
        label="記録・統計のテーマ"
        variant="tabs"
        items={SECTIONS.map((s) => ({
          key: s.key || 'tournament',
          to: s.key ? `/stats/${s.key}` : '/stats',
          label: s.label,
          current: s.key === current.key,
        }))}
      />
      <div className="stats-layout">
        <PageToc root={bodyRef} deps={current.key} />
        <div className="stats-body" ref={bodyRef}>
          <Tab />
        </div>
      </div>
    </div>
  )
}
