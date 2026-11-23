import { useId, useState } from 'react'

import type { FinalsStatsWinner, RosterRows } from './types'

// 数字を押すと名前の一覧が開く部品(components/RevealCount.tsx)の状態と、一覧の形

export interface RevealItem {
  name: string
  combiId: number | null
  /** あれば名前の後ろに(年)。年は決勝ページ(yearTo で変えられる)へのリンク */
  year?: number
  /** 名前の後ろに足す補足(「3回」など) */
  note?: string
}

export interface RevealContent {
  /** 一覧の見出し(「1番の出場」)。後ろに件数が付く */
  title: string
  items: RevealItem[]
  /** 件数の単位(既定は「組」) */
  unit?: string
  /** 年のリンク先。省略時はその年の決勝ページ */
  yearTo?: (item: RevealItem) => string
}

/** 名簿(finals_stats / judges_stats の roster)の添字 → 名前の一覧 */
export function fromRoster(roster: FinalsStatsWinner[], rows: RosterRows | undefined): RevealItem[] {
  return (rows ?? []).map((i) => roster[i])
}

export const revealKey = (row: string, col: string) => `${row}::${col}`

/** 表(または段落)ごとに1つ。開いている「行::列」を1つだけ覚える */
export function useReveal() {
  const [open, setOpen] = useState<string | null>(null)
  const base = useId()
  return {
    open,
    toggle: (key: string) => setOpen((cur) => (cur === key ? null : key)),
    panelId: (row: string) => `${base}-${row}`,
  }
}

export type Reveal = ReturnType<typeof useReveal>
