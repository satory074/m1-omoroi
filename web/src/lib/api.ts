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
  PeopleStats,
  Popularity,
  Rankings,
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

/** enabled=false で取得を抑止できる(ヘッダー常駐の検索が未使用のページで無駄に取らないため) */
export function usePopularity(enabled = true) {
  return useQuery({
    queryKey: ['popularity'],
    queryFn: () => fetchJsonOrNull<Popularity>('popularity.json'),
    enabled,
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
      const detail = shard[String(id)]
      if (!detail) throw new Error('このコンビのデータが見つかりません')
      return detail
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
