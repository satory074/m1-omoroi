import { useQuery } from '@tanstack/react-query'

import type {
  CombiDetail,
  CombiIndexRow,
  FinalsFile,
  MetaFile,
  Popularity,
  Rankings,
  Stats,
  YearFile,
} from './types'

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

export function usePopularity() {
  return useQuery({
    queryKey: ['popularity'],
    queryFn: () => fetchJsonOrNull<Popularity>('popularity.json'),
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

export function useFinals(year: number | null) {
  return useQuery({
    queryKey: ['finals', year],
    queryFn: () => fetchJsonOrNull<FinalsFile>(`finals/${year}.json`),
    enabled: year !== null,
    ...STATIC,
  })
}
