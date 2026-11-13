import { useMemo } from 'react'

import { useAdvancers, useChampions, usePopularity } from './api'
import { formationInfo, isEligible } from './eligibility'
import type { RoundKey } from './types'

export const TIERS = ['final', 'semifinal', 'quarterfinal'] as const satisfies readonly RoundKey[]
export type Tier = (typeof TIERS)[number]

/** 未エントリーの内訳。解散データが無いので断定せず、前後の出場から機械的に分ける */
export type Kind = 'skip' | 'gone' | 'predebut'

export interface AbsentRow {
  id: number
  name: string
  formed: number | null
  tier: Tier
  kind: Kind
  prev: number | null
  next: number | null
  champYears: number[]
  hits: number | null
}

export const KIND_LABEL: Record<Kind, string> = {
  skip: '見送り',
  gone: '以降エントリーなし',
  predebut: '初出場前',
}

/**
 * その年「出場資格(結成N年以内)があるのにエントリー記録が無い」準々決勝以上経験組。
 * 母集団は advancers.json の3段階(相互排他)の和集合、エントリー有無は年度JSONのidで判定し、
 * 前後の出場年(entryYears)で 見送り/以降なし/初出場前 に分ける。
 * 年度ページの回戦ナビに件数を出すため、行の計算だけを切り出してある。
 */
export function useAbsentRows(year: number, enteredIds: Set<number>): AbsentRow[] {
  const { data: advancers } = useAdvancers()
  const { data: champions } = useChampions()
  const { data: pop } = usePopularity()
  return useMemo<AbsentRow[]>(() => {
    if (!advancers || enteredIds.size === 0) return []
    // その年より前に優勝している組(優勝後も資格がある間は再エントリーできるので除外はしない)
    const champs = new Map<number, number[]>()
    for (const c of champions?.champions ?? []) {
      if (c.id == null || c.year >= year) continue
      champs.set(c.id, [...(champs.get(c.id) ?? []), c.year])
    }
    const out: AbsentRow[] = []
    for (const t of advancers.tiers) {
      if (!(TIERS as readonly string[]).includes(t.round)) continue
      for (const c of t.combis) {
        if (!isEligible(year, c.formed) || enteredIds.has(c.id) || !formationInfo(year, c.formed)) continue
        const prev = c.entryYears.filter((y) => y < year).pop() ?? null
        const next = c.entryYears.find((y) => y > year) ?? null
        out.push({
          id: c.id,
          name: c.name,
          formed: c.formed,
          tier: t.round as Tier,
          kind: prev == null ? 'predebut' : next == null ? 'gone' : 'skip',
          prev,
          next,
          champYears: champs.get(c.id) ?? [],
          hits: pop?.hits[String(c.id)]?.n ?? null,
        })
      }
    }
    // 年度ページの既定ソートと同じく注目度順(データが無い組は五十音順で後ろ)
    return out.sort((a, b) => (b.hits ?? -1) - (a.hits ?? -1) || a.name.localeCompare(b.name, 'ja'))
  }, [advancers, champions, pop, year, enteredIds])
}
