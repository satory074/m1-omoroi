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
  officialUrl?: string
  /** 合成コンビ(2001〜2010・公式コンビDB未収録)は officialUrl の代わりに Wikipedia を持つ */
  wikipedia?: string | null
  legacy?: boolean
}

export interface Popularity {
  hits: Record<string, { n: number; at: string; v?: number }>
}

export interface RankingItem {
  id: number
  name: string
  value: number
  /** 該当年リスト(通算出場回数など) */
  years?: number[]
}

/** 連続出場: value=連続年数、start〜end がその区間 */
export interface StreakItem {
  id: number
  name: string
  value: number
  start: number
  end: number
}

/** 集計は公式コンビDBの2015年以降(決勝の全期間版は FinalsStats 側) */
export interface Rankings {
  mostSemifinalFails: RankingItem[]
  mostQuarterfinals: RankingItem[]
  mostFirstRoundFails: RankingItem[]
  longestStreaks: StreakItem[]
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

export interface ChampionMember {
  name: string | null
  from: string | null
  age: number | null
}

export interface Champion {
  year: number
  name: string
  /** コンビID(build時に決勝データから名寄せ。全21王者が解決済みだがnullable) */
  id: number | null
  formed: number | null
  members: ChampionMember[]
}

export interface Champions {
  champions: Champion[]
}

export interface AdvancerMember {
  name: string | null
  from: string | null
  age: number | null
}

/** 準々決勝以上に到達したコンビ。age は最高ラウンド初到達年 − 生年 */
export interface Advancer {
  id: number
  name: string
  formed: number | null
  firstYear: number
  reachCount: number
  members: AdvancerMember[]
}

export interface AdvancerTier {
  round: RoundKey
  combis: Advancer[]
}

export interface Advancers {
  tiers: AdvancerTier[]
}

export interface FinalsScore {
  order?: number | null
  combiId?: number | null
  name: string
  scores?: (number | null)[]
  total?: number | null
  rank?: number | null
  /** その年時点で通算何回目の決勝進出か */
  finalAppearance?: number
  /** 敗者復活戦からの決勝進出組 */
  revival?: boolean
}

export interface FinalsFile {
  year: number
  judges: string[]
  firstRound: FinalsScore[]
  finalRound?: {
    /** 最終決戦の出番順 */
    order?: number | null
    combiId?: number | null
    name: string
    votes?: number | null
    champion?: boolean
    /** その組に投票した審査員名(judges配列の並び順) */
    voters?: string[]
  }[]
  source: string
}

export interface FinalsStatsWinner {
  year: number
  name: string
  combiId: number | null
}

/** 決勝1本目の出番順別成績(分母は出番順が判明している年のみ) */
export interface OrderStat {
  order: number
  appearances: number
  finalists?: number
  wins: number
  winners: FinalsStatsWinner[]
}

export interface ChampionRankStat {
  rank: number
  count: number
  winners: FinalsStatsWinner[]
}

export interface FormationYearStat {
  years: number
  count: number
  combis?: { year: number; name: string }[]
}

export interface DeviationScore {
  rank: number
  year: number
  name: string
  combiId: number | null
  total: number
  deviation: number
  firstRoundRank: number | null
}

export interface FinalRoundAppearance {
  id: number | null
  name: string
  value: number
  years: number[]
}

/** 全期間(2001〜)の決勝(ファーストラウンド)進出回数。wins=うち優勝回数 */
export interface FinalAppearanceRank {
  id: number | null
  name: string
  value: number
  years: number[]
  wins: number
}

export interface AgencyFinals {
  agency: string
  value: number
  combis: number
}

interface RevivalBucket {
  appearances: number
  finalists: number
  wins: number
}

/** 敗者復活組 vs ストレート組の成績(制度のある2002年以降が分母) */
export interface RevivalStats {
  sinceYear: number
  /** 敗者復活からの優勝 */
  winners: FinalsStatsWinner[]
  revival: RevivalBucket
  straight: RevivalBucket
}

/** 通算N回目の決勝で優勝した回数の分布 */
export interface ChampionNthFinal {
  n: number
  count: number
  winners: FinalsStatsWinner[]
}

/** 初出場(初エントリー年)で決勝進出。recordedOnly=記録に残る範囲での判定(2001〜2010に出場しえた組) */
export interface DebutFinalist {
  year: number
  name: string
  combiId: number | null
  recordedOnly: boolean
}

export interface FinalsStats {
  firstRoundOrderStats: OrderStat[]
  finalOrderStats: OrderStat[]
  championFirstRoundRank: ChampionRankStat[]
  formationYears: {
    champion: FormationYearStat[]
    final: FormationYearStat[]
    semifinal: FormationYearStat[]
    quarterfinal: FormationYearStat[]
    unknownFormed: { final: number; semifinal: number; quarterfinal: number }
  }
  /** 全大会・全決勝進出組の得点偏差値(偏差値降順、同点は順位共有) */
  deviationScores: DeviationScore[]
  /** 最終決戦(1本目上位2〜3組)の進出回数 */
  mostFinalRoundAppearances: FinalRoundAppearance[]
  /** 決勝(ファーストラウンド)の進出回数。全期間 */
  mostFinalAppearances: FinalAppearanceRank[]
  /** 無冠の帝王: 決勝2回以上進出かつ優勝なし */
  uncrownedKings: FinalAppearanceRank[]
  championNthFinal: ChampionNthFinal[]
  revivalStats: RevivalStats
  debutFinalists: DebutFinalist[]
  agencyFinals: AgencyFinals[]
  agencyFinalsExcluded: number
}
