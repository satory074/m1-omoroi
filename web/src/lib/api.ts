import { useQuery } from '@tanstack/react-query'

import type {
  Advancers,
  Champions,
  CombiDetail,
  CombiIndexRow,
  CombiMemberIndexRow,
  FinalsFile,
  FinalsStats,
  JudgesStats,
  MetaFile,
  OfficialVideos,
  PeopleStats,
  Popularity,
  Rankings,
  ScheduleFile,
  Stats,
  YearFile,
  YearSummary,
} from './types'
import { buildMemberKeys } from './search'

const BASE = import.meta.env.BASE_URL

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}data/${path}`)
  if (!res.ok) throw new Error(`データの取得に失敗しました: ${path} (${res.status})`)
  return res.json()
}

async function fetchJsonOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}data/${path}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`データの取得に失敗しました: ${path} (${res.status})`)
  return res.json()
}

const STATIC = { staleTime: Infinity, gcTime: Infinity } as const

/**
 * 事前描画(src/entry-server.tsx)が HTML に埋め込むデータのキー。サーバーで同じキーにデータを入れておくと、
 * ブラウザは取りに行かずにそのデータで最初の画面を描く(hydrate)。キーとファイルの対応はここだけに書く。
 */
export const QUERY = {
  meta: { key: ['meta'], file: 'meta.json' },
  stats: { key: ['stats'], file: 'stats.json' },
  champions: { key: ['champions'], file: 'champions.json' },
  rankings: { key: ['rankings'], file: 'rankings.json' },
  finalsStats: { key: ['finals-stats'], file: 'finals_stats.json' },
  judgesStats: { key: ['judges-stats'], file: 'judges_stats.json' },
  peopleStats: { key: ['people-stats'], file: 'people_stats.json' },
  finals: (year: number) => ({ key: ['finals', year], file: `finals/${year}.json` }),
  yearSummary: (year: number) => ({ key: ['year-summary', year], file: `years/${year}.summary.json` }),
} as const

export function useMeta() {
  return useQuery({ queryKey: QUERY.meta.key, queryFn: () => fetchJson<MetaFile>(QUERY.meta.file), ...STATIC })
}

/** 年度の要約(数KB)。年度ファイル(最大1.7MB)より先に届き、事前描画した HTML にも入る。無い年は null */
export function useYearSummary(year: number | null) {
  const q = QUERY.yearSummary(year ?? 0)
  return useQuery({
    queryKey: q.key,
    queryFn: () => fetchJsonOrNull<YearSummary>(q.file),
    enabled: year !== null,
    ...STATIC,
  })
}

export function useYear(year: number | null) {
  return useQuery({
    queryKey: ['year', year],
    queryFn: () => fetchJson<YearFile>(`years/${year}.json`),
    enabled: year !== null,
    ...STATIC,
  })
}

/** enabled=false で取得を抑止できる(ヘッダー常駐の検索が未使用のページで無駄に取らないため) */
export function usePopularity(enabled = true) {
  return useQuery({
    queryKey: ['popularity'],
    queryFn: () => fetchJsonOrNull<Popularity>('popularity.json'),
    enabled,
    ...STATIC,
  })
}

/** M-1公式YouTubeの回戦別プレイリストとコンビごとの動画(約8KB gz)。
 *  ファイルが無い(CIの初回取得前など)ときは null で、リンクを出さないだけになる */
export function useOfficialVideos() {
  return useQuery({
    queryKey: ['official-videos'],
    queryFn: () => fetchJsonOrNull<OfficialVideos>('official_videos.json'),
    ...STATIC,
  })
}

/** M-1公式サイトの準々決勝以降の日程(約1KB gz)。無いときは null で、日程を出さないだけになる */
export function useSchedule() {
  return useQuery({
    queryKey: ['schedule'],
    queryFn: () => fetchJsonOrNull<ScheduleFile>('schedule.json'),
    ...STATIC,
  })
}

export function useCombiIndex(enabled: boolean) {
  return useQuery({
    queryKey: ['combi-index'],
    queryFn: () => fetchJson<CombiIndexRow[]>('combi/index.json'),
    enabled,
    ...STATIC,
  })
}

/**
 * 芸人名検索用のメンバー索引(約1.07MB gz)。combi/index.json と位置対応。
 * enabled は検索ボックスのフォーカスで立ち、index.json と並行に取りに行く。
 * 取得後そのまま正規化済み構造へ展開して返す(react-query がキャッシュするので1回だけ)。
 * 旧デプロイのキャッシュ等で members.json が無い場合は null になり、
 * 芸人名セクションを出さずコンビ名検索だけに自然劣化する。
 */
export function useCombiMembers(enabled: boolean) {
  return useQuery({
    queryKey: ['combi-members'],
    queryFn: async () => {
      const rows = await fetchJsonOrNull<CombiMemberIndexRow[]>('combi/members.json')
      return rows ? await buildMemberKeys(rows) : null
    },
    enabled,
    ...STATIC,
  })
}

export function useCombiDetail(id: number | null) {
  return useQuery({
    queryKey: ['combi', id],
    queryFn: async () => {
      const shard = await fetchJson<Record<string, CombiDetail>>(`combi/${id! % 100}.json`)
      // 該当が無い ID は「見つからない」(null)。通信の失敗(例外)とは分けて見せる
      return shard[String(id)] ?? null
    },
    enabled: id !== null,
    ...STATIC,
  })
}

export function useRankings() {
  return useQuery({
    queryKey: QUERY.rankings.key,
    queryFn: () => fetchJson<Rankings>(QUERY.rankings.file),
    ...STATIC,
  })
}

export function useStats() {
  return useQuery({ queryKey: QUERY.stats.key, queryFn: () => fetchJson<Stats>(QUERY.stats.file), ...STATIC })
}

export function useChampions() {
  return useQuery({
    queryKey: QUERY.champions.key,
    queryFn: () => fetchJsonOrNull<Champions>(QUERY.champions.file),
    ...STATIC,
  })
}

export function useAdvancers() {
  return useQuery({
    queryKey: ['advancers'],
    queryFn: () => fetchJsonOrNull<Advancers>('advancers.json'),
    ...STATIC,
  })
}

export function useFinalsStats() {
  return useQuery({
    queryKey: QUERY.finalsStats.key,
    queryFn: () => fetchJsonOrNull<FinalsStats>(QUERY.finalsStats.file),
    ...STATIC,
  })
}

export function useJudgesStats() {
  return useQuery({
    queryKey: QUERY.judgesStats.key,
    queryFn: () => fetchJsonOrNull<JudgesStats>(QUERY.judgesStats.file),
    ...STATIC,
  })
}

export function usePeopleStats() {
  return useQuery({
    queryKey: QUERY.peopleStats.key,
    queryFn: () => fetchJsonOrNull<PeopleStats>(QUERY.peopleStats.file),
    ...STATIC,
  })
}

export function useFinals(year: number | null) {
  const q = QUERY.finals(year ?? 0)
  return useQuery({
    queryKey: q.key,
    queryFn: () => fetchJsonOrNull<FinalsFile>(q.file),
    enabled: year !== null,
    ...STATIC,
  })
}
