import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'

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
  RoundKey,
  ScheduleFile,
  ScheduleRoundFile,
  Stats,
  YearFile,
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

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => fetchJson<MetaFile>('meta.json'), ...STATIC })
}

export function useYear(year: number | null) {
  return useQuery({
    queryKey: ['year', year],
    queryFn: () => fetchJson<YearFile>(`years/${year}.json`),
    enabled: year !== null,
    ...STATIC,
  })
}

/**
 * 複数の年の年度ファイル(いいねの一覧用)。useYear と同じキーなので、年度ページで読んだものはそのまま使う。
 * combine は部品の外で定義した関数を渡すこと(結果が変わらない限り同じ値が返り、useMemo の依存にできる)
 */
export function useYears<T>(years: readonly number[], combine: (results: UseQueryResult<YearFile>[]) => T) {
  return useQueries({
    queries: years.map((year) => ({
      queryKey: ['year', year],
      queryFn: () => fetchJson<YearFile>(`years/${year}.json`),
      ...STATIC,
    })),
    combine,
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

/** その回戦の会場ごとの出番順(data/schedule/{回戦}.json)。1回戦は約30KB(gzip)あるので、その回戦を開いたときだけ */
export function useScheduleRound(round: RoundKey | null) {
  return useQuery({
    queryKey: ['schedule-round', round],
    queryFn: () => fetchJsonOrNull<ScheduleRoundFile>(`schedule/${round}.json`),
    enabled: round !== null,
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
    queryKey: ['rankings'],
    queryFn: () => fetchJson<Rankings>('rankings.json'),
    ...STATIC,
  })
}

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: () => fetchJson<Stats>('stats.json'), ...STATIC })
}

export function useChampions() {
  return useQuery({
    queryKey: ['champions'],
    queryFn: () => fetchJsonOrNull<Champions>('champions.json'),
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
    queryKey: ['finals-stats'],
    queryFn: () => fetchJsonOrNull<FinalsStats>('finals_stats.json'),
    ...STATIC,
  })
}

export function useJudgesStats() {
  return useQuery({
    queryKey: ['judges-stats'],
    queryFn: () => fetchJsonOrNull<JudgesStats>('judges_stats.json'),
    ...STATIC,
  })
}

export function usePeopleStats() {
  return useQuery({
    queryKey: ['people-stats'],
    queryFn: () => fetchJsonOrNull<PeopleStats>('people_stats.json'),
    ...STATIC,
  })
}

export function useFinals(year: number | null) {
  return useQuery({
    queryKey: ['finals', year],
    queryFn: () => fetchJsonOrNull<FinalsFile>(`finals/${year}.json`),
    enabled: year !== null,
    ...STATIC,
  })
}
