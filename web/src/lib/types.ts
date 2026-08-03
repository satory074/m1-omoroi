export type RoundKey =
  | 'first'
  | 'second'
  | 'third'
  | 'quarterfinal'
  | 'semifinal'
  | 'playoff'
  | 'final'

export type ResultKey =
  | 'pass'
  | 'fail'
  | 'seed_pass'
  | 'champion'
  | 'fail_inferred'
  | 'absent'
  | 'scheduled'
  | 'unknown'

export interface YearEntry {
  id: number | null
  no: number | null
  name: string
  kana: string | null
  formed?: number | null
  results: Partial<Record<RoundKey, ResultKey>>
  raw?: Partial<Record<RoundKey, string>>
  agency?: string
  photo?: string
}

export interface YearFile {
  year: number
  source: 'official-db' | 'official-archive'
  rounds: RoundKey[]
  entries: YearEntry[]
  notes?: string
}

export interface MetaFile {
  schemaVersion: number
  generatedAt: string
  years: number[]
  latestYear: number
  finalsYears: number[]
}

/** [id, 名前, かな, 出場年リスト] */
export type CombiIndexRow = [number, string, string | null, number[]]

export interface CombiMember {
  name?: string
  kana?: string
  birth?: string
  from?: string
  job?: string
}

export interface CombiDetail {
  name: string
  kana: string | null
  formed: number | null
  formedRaw: string | null
  belong: string | null
  members: CombiMember[]
  photo?: string | null
  history: Record<
    string,
    { no: number | null; results: Partial<Record<RoundKey, ResultKey>>; raw?: Record<string, string> }
  >
  officialUrl: string
}

export interface Popularity {
  hits: Record<string, { n: number; at: string; v?: number }>
}

export interface RankingItem {
  id: number
  name: string
  value: number
}

export interface Rankings {
  mostAppearances: RankingItem[]
  mostSemifinalFails: RankingItem[]
  mostQuarterfinals: RankingItem[]
  mostFinals: RankingItem[]
  mostFirstRoundFails: RankingItem[]
}

export interface YearStats {
  year: number
  source: string
  entries: number
  byRound: Partial<Record<RoundKey, { appeared: number; passed: number }>>
}

export interface Stats {
  byYear: YearStats[]
}

export interface FinalsScore {
  order?: number
  combiId?: number | null
  name: string
  scores?: (number | null)[]
  total?: number | null
  rank?: number | null
}

export interface FinalsFile {
  year: number
  judges: string[]
  firstRound: FinalsScore[]
  finalRound?: { combiId?: number | null; name: string; votes?: number | null; champion?: boolean }[]
  source: string
}
