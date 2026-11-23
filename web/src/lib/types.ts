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
  /** その年まで(その年を含む)の最高戦績。1..6=回戦、7=優勝(rounds.ts の BEST_CHAMPION)。結果が無い組は無し */
  best?: number
}

export interface YearFile {
  year: number
  source: 'official-db' | 'official-archive'
  rounds: RoundKey[]
  entries: YearEntry[]
  notes?: string
}

/**
 * 年度の要約 years/{year}.summary.json(数KB)。web/scripts/year-summaries.mjs が年度ファイルから作る。
 * 年度ページの「この年のまとめ」と、事前描画した HTML(1.7MB の年度ファイルは埋め込めない)が使う。
 */
export interface YearSummary {
  year: number
  source: YearFile['source']
  entries: number
  /** 出場者のいる回戦(ROUND_ORDER の順)。appeared=その回戦に結果がある組、passed=通過(シード・優勝を含む) */
  rounds: { round: RoundKey; appeared: number; passed: number }[]
  champion: { id: number | null; name: string } | null
  /** 決勝・準決勝・準々決勝に出た組(上の回戦から、五十音順) */
  reached: { round: RoundKey; combis: { id: number | null; name: string }[] }[]
}

export interface MetaFile {
  schemaVersion: number
  generatedAt: string
  years: number[]
  latestYear: number
  finalsYears: number[]
}

/** [id, 名前, かな, 出場年リスト, 最高到達ラウンド]。
 *  最高到達は 0=不明 / 1..6 = BEST_ROUND_KEYS(1回戦〜決勝、敗者復活戦は含まない)。 */
export type CombiIndexRow = [number, string, string | null, number[], number]

/**
 * combi/members.json の1行 = [名前, かな, 名前, かな, ...] のフラット配列(かな欠損は空文字)。
 * 配列全体は combi/index.json と**同じ並び・同じ行数**で、行 i は index[i] と同じコンビを指す
 * (id を持たないのは gzip 後に +11% になるため。参照は同じ添字で引く)。
 */
export type CombiMemberIndexRow = string[]

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
  // n=採用動画の再生数合計, v=採用本数, m=うちメンバー名だけで採用した動画の再生数(m ≤ n。旧形式のエントリには無い)
  hits: Record<string, { n: number; at: string; v?: number; m?: number }>
}

/** M-1公式YouTubeの動画1本へのリンク(official_videos.json の combis 側) */
export interface OfficialVideoLink {
  /** YouTube の動画ID */
  v: string
  /** 種類(プレイリスト名から年を除いたもの): 3回戦ネタ / 1回戦TOP3 / ナイスアマチュア賞 / 直撃！インタビュー */
  k: string
  /** 出番・順位: 2組目 / 1位通過(説明文に記載がある動画のみ) */
  p?: string
  /** 開催日と会場: 11/3(火) 東京 KANDA SQUARE HALL */
  at?: string
}

export interface OfficialPlaylist {
  id: string
  title: string
  /** 公開中の動画本数 */
  count: number
}

/** data/official_videos.json。いま公開中のものだけ(ネタ動画はシーズン後に消えるので過去年は少ない) */
export interface OfficialVideos {
  channel: string
  fetchedAt: string | null
  years: Record<
    string,
    {
      playlists: Partial<Record<RoundKey, OfficialPlaylist[]>>
      /** コンビID → 回戦 → 動画 */
      combis: Record<string, Partial<Record<RoundKey, OfficialVideoLink[]>>>
    }
  >
}

/** 公式日程の1会場(data/schedule.json)。決まっていない項目は null */
export interface ScheduleVenue {
  /** 公式の会場ID */
  id: string
  /** YYYY-MM-DD */
  date: string
  /** 曜日1文字(日付から計算済み) */
  wd: string
  /** 開場・開演 "18:30" */
  open: string | null
  start: string | null
  /** 地域「東京」と会場名 */
  area: string | null
  place: string | null
  mc: string | null
  /** 公式に載っている出場者の数(未発表は0) */
  entrants: number
}

/** data/schedule.json。M-1公式サイトの1回戦〜決勝の日程(その時のシーズンの1年分だけ)。
 *  会場の一覧と人数だけ。組ごとの出番は回戦ごとの別ファイル(ScheduleRoundFile) */
export interface ScheduleFile {
  year: number
  url: string
  fetchedAt: string
  rounds: Partial<Record<RoundKey, ScheduleVenue[]>>
}

/** data/schedule/{回戦}.json。会場ID → その会場のコンビIDの列(公式の並び=出番順。欠席は含まない)。
 *  1回戦は再エントリーがあるので、同じ組が2会場に居ることがある */
export type ScheduleRoundFile = Record<string, number[]>

export interface RankingItem {
  id: number
  name: string
  value: number
  /** 該当年リスト(通算出場回数など) */
  years?: number[]
}

/** 集計は公式コンビDBの2015年以降(決勝の全期間版は FinalsStats 側) */
export interface Rankings {
  mostSemifinalFails: RankingItem[]
  /** 準決勝に進んだ回数(合否は問わない) */
  mostSemifinals: RankingItem[]
  mostQuarterfinals: RankingItem[]
  /** 最新の年がラストイヤー(結成 year − limit 年)の組。year のデータが無ければ null */
  lastYearEntrants: LastYearEntrants | null
}

export interface LastYearEntrant {
  id: number
  name: string
  formed: number
  /** その年に到達した本線の回戦(敗者復活戦は数えない)。結果がまだ無ければ null */
  round: RoundKey | null
  result: ResultKey | null
  /** 通算最高(年度JSONの best と同じ: 1..6=回戦、7=優勝、0=結果なし) */
  best: number
}

export interface LastYearEntrants {
  year: number
  limit: number
  formed: number
  /** 到達の深い順、次に名前順 */
  combis: LastYearEntrant[]
}

export interface YearStats {
  year: number
  source: string
  entries: number
  byRound: Partial<Record<RoundKey, { appeared: number; passed: number }>>
}

export interface Stats {
  byYear: YearStats[]
  formationReach: FormationReach
}

/** 結成年数(大会年 − 結成年)別の到達数。reached は「その回戦かそれより先」まで進んだ延べ組数 */
export interface FormationReachRow {
  years: number
  entries: number
  reached: { third: number; quarterfinal: number; semifinal: number; final: number }
  /** 準決勝以降・決勝まで進んだ組(数と同じ件数。3回戦・準々決勝は延べ数千組あるので持たない) */
  names: { semifinal: FinalsStatsWinner[]; final: FinalsStatsWinner[] }
}

export interface FormationReach {
  fromYear: number | null
  toYear: number | null
  /** 終わっていない大会(王者が決まっていない年) */
  excludedYears: number[]
  rows: FormationReachRow[]
  excluded: { scheduled: number; noResult: number; unknownFormed: number; outOfRange: number }
}

export interface PassCount {
  appeared: number
  passed: number
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
  /** 最高ラウンドに関係ない全出場年(昇順)。年度ページの未エントリー判定に使う */
  entryYears: number[]
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

/** 名簿(roster)の添字の配列。決勝の行を、集計ごとに名前を繰り返さずに指す(数字を押すと出る一覧) */
export type RosterRows = number[]

/** 決勝1本目の出番順別成績(分母は出番順が判明している年のみ) */
export interface OrderStat {
  order: number
  appearances: number
  finalists?: number
  wins: number
  winners: FinalsStatsWinner[]
  /** 1本目の年内偏差値の平均(ファーストラウンドのみ) */
  meanDeviation?: number
  /** 出場した組 */
  rows: RosterRows
  /** 最終決戦へ進んだ組(ファーストラウンドのみ) */
  finalRoundRows?: RosterRows
}

export interface ChampionRankStat {
  rank: number
  count: number
  winners: FinalsStatsWinner[]
}

export interface FormationYearStat {
  years: number
  count: number
  /** 優勝の系列だけ */
  combis?: FinalsStatsWinner[]
  /** 決勝の系列だけ */
  rows?: RosterRows
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
  /** その事務所の組と決勝進出の回数(回数の多い順) */
  names: { name: string; combiId: number | null; n: number }[]
}

interface RevivalBucket {
  appearances: number
  finalists: number
  wins: number
  rows: RosterRows
  finalRoundRows: RosterRows
  winRows: RosterRows
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

/** 各年の1本目1位と2位の点差 */
export interface FirstRoundMargin {
  year: number
  first: { name: string; combiId: number | null; total: number }
  second: { name: string; combiId: number | null; total: number }
  margin: number
}

/** 審査員の通算記録(overrides/judges.json の正規名で名寄せ) */
export interface JudgeCareer {
  name: string
  years: number[]
  yearCount: number
  /** 採点した組数(延べ) */
  scored: number
  /** 平均点差 = 自分の点 − その組への個人審査員平均 の平均。負=辛口 */
  avgDiff: number | null
  /** 行内最高点/最低点を付けた回数(タイは全員に計上) */
  topCount: number
  lowCount: number
  /** 最終決戦の投票数(votersが記録されている年のみ)と、うち優勝者への投票 */
  votes: number
  champVotes: number
  /** 行内最高点/最低点を付けた組・優勝者へ入れた票の組 */
  topRows: RosterRows
  lowRows: RosterRows
  champVoteRows: RosterRows
}

/** その審査員がその年に最高点/最低点をつけた組(同点は全件、出番順) */
export interface JudgePickCombi {
  name: string
  /** 名寄せできなかった組(主に2001〜2010)は null */
  combiId: number | null
}

export interface JudgeYearRow {
  name: string
  canonical: string
  mean: number
  diff: number
  top: number
  low: number
  max: number
  min: number
  /** 採点の幅(母標準偏差) */
  sd: number
  /** max/min を付けた組(同点は全件) */
  maxCombis: JudgePickCombi[]
  minCombis: JudgePickCombi[]
  /** 行内の最高点/最低点を付けた組(top/low と同じ件数) */
  topRows: RosterRows
  lowRows: RosterRows
}

export interface JudgesYear {
  year: number
  /** その年の個人審査員全採点の平均 */
  judgeMean: number
  judges: JudgeYearRow[]
}

/** 最終決戦の得票(満場一致/接戦)。votes は得票の降順 */
export interface FinalVoteYear {
  year: number
  champion: string
  championCombiId: number | null
  votes: number[]
  /** votes と同じ並びの組 */
  names: JudgePickCombi[]
  unanimous: boolean
  margin: number
}

export interface JudgesStats {
  /** 決勝1本目の全行(年の順)。*Rows の添字が指す */
  roster: FinalsStatsWinner[]
  career: JudgeCareer[]
  byYear: JudgesYear[]
  finalVotes: FinalVoteYear[]
  /** 個人審査員ではない会場票の列(2001年の大阪/札幌/福岡) */
  venueColumns: Record<string, string[]>
  /** 審査員ごとに点数を標準化して足した場合の最終決戦進出組との比較(年ごと) */
  standardized: StandardizedYear[]
  /** 個人審査員の1点ずつの最高/最低(5件+境界の同点。会場票は含まない) */
  scoreExtremes: { highest: SingleScore[]; lowest: SingleScore[] }
  /** 審査員(列)を1人ずつ外して残りの合計で上位N組を選び直した結果 */
  leaveOneOut: { skipped: number[]; rows: LeaveOneOutYear[] }
  /** 審査員の評価が割れた/揃った組(割れ具合の大きい順10件・小さい順5件+境界の同点) */
  splitScores: { mean: number | null; count: number; highest: SplitScore[]; lowest: SplitScore[] }
  /** トップバッター(出番1番)への点 − その審査員のその年の平均点(全員。回数の多い順) */
  firstPerformer: { name: string; n: number; meanDiff: number; rows: RosterRows }[]
}

export interface LeaveOneOutChange {
  /** 得点表の表記 */
  judge: string
  /** 名寄せ後の名前(会場票は表記のまま) */
  canonical: string
  venue: boolean
  /** 選び直すと入る組 / 外れる組 */
  added: JudgePickCombi[]
  dropped: JudgePickCombi[]
  /** 選び直すとN位とN+1位が同点になり、どちらが残るか決まらない */
  tie: boolean
  tied: JudgePickCombi[]
}

export interface LeaveOneOutYear {
  year: number
  n: number
  /** N位とN+1位の点差(全員の合計) */
  cutMargin: number | null
  changes: LeaveOneOutChange[]
}

export interface SplitScore {
  year: number
  name: string
  combiId: number | null
  rank: number | null
  /** 審査員ごとに平均0・幅1にそろえた点の、審査員の間の標準偏差 */
  spread: number
  maxScore: number
  maxJudges: string[]
  minScore: number
  minJudges: string[]
}

export interface StandardizedYear {
  year: number
  /** 最終決戦に進む組数(2001年は2、ほかは3) */
  n: number
  /** 実際に最終決戦へ進んだ組(1本目の合計点順) */
  actual: JudgePickCombi[]
  /** 標準化した点の上位 n 組 */
  standardized: JudgePickCombi[]
  /** 顔ぶれが変わる */
  setChanged: boolean
  /** 顔ぶれか並びが変わる */
  orderChanged: boolean
}

export interface SingleScore {
  year: number
  /** 正規名 */
  judge: string
  score: number
  name: string
  combiId: number | null
}

/** 年齢記録の1行(人物単位の極値) */
export interface AgeRecordRow {
  age: number
  member: string | null
  combi: string
  combiId: number | null
  year: number
}

export interface AgeGapRow {
  id: number
  name: string
  /** 年下メンバーが生まれた時点での年上メンバーの満年齢 */
  gapYears: number
  older: string | null
  younger: string | null
  bestRound: RoundKey
}

/** 最高到達ラウンドの記録(アマチュア・トリオ) */
export interface ReachRow {
  id: number
  name: string
  bestRound: RoundKey
  years: number[]
}

export interface JobStat {
  job: string
  bestRound: RoundKey
  count: number
  combis: { id: number; name: string; year: number }[]
}

export interface PeopleStats {
  ageRecords: {
    /** 決勝・優勝: 決勝開催日時点の厳密な満年齢 */
    final: { youngest: AgeRecordRow[]; oldest: AgeRecordRow[] }
    champion: { youngest: AgeRecordRow[]; oldest: AgeRecordRow[] }
  }
  /** サニティ範囲(10〜90歳)外として除外した人数 */
  ageExcluded: number
  ageGap: AgeGapRow[]
  amateur: ReachRow[]
  jobs: JobStat[]
  trio: ReachRow[]
}

export interface FinalsStats {
  /** 決勝1本目の全行(年の順)。*Rows・rows の添字が指す */
  roster: FinalsStatsWinner[]
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
  /** 何度目の準決勝で初めて決勝に届いたか。attempts = 決勝経験の無い組の n 回目の準決勝の数 */
  semifinalsBeforeFirstFinal: {
    sinceYear: number | null
    combis: number
    dist: { n: number; attempts: number; count: number; combis: FinalsStatsWinner[] }[]
  }
  revivalStats: RevivalStats
  firstRoundMargins: FirstRoundMargin[]
  /** コンビ名の文字数(NFKC・空白除去)別のエントリー/決勝進出/優勝組数 */
  nameLengthStats: {
    length: number
    entrants: number
    finalists: number
    champions: number
    finalCombis: JudgePickCombi[]
    championCombis: JudgePickCombi[]
  }[]
  agencyFinals: AgencyFinals[]
  agencyFinalsExcluded: number
  /** 決勝の連続進出(大会連続。休止の2011〜2014は飛ばして数える)。2大会以上 */
  finalStreaks: FinalStreak[]
  /** 隣り合う大会どうしで、前の大会の決勝進出者が次の大会も決勝に来た数 */
  repeatFinalists: { pairs: number; back: number; rows: RosterRows }
  lastYearFinalists: {
    rows: LastYearFinalist[]
    /** 比べる相手: 決勝進出の延べ組数と優勝数(全体) */
    finalists: number
    champions: number
    unknownFormed: number
  }
  /** 1本目の1人あたり平均点の上位(20件+境界の同点) */
  perJudgeTop: PerJudgeScore[]
  finalistsByYear: FinalistsYear[]
}

export interface FinalStreak {
  id: number | null
  name: string
  value: number
  start: number
  end: number
  /** 最新の決勝の年で終わっている(今年も決勝に来れば伸びる) */
  ongoing: boolean
}

export interface LastYearFinalist {
  year: number
  name: string
  combiId: number | null
  formed: number
  /** 1本目の順位(合計点から数える。同点は同順位) */
  rank: number
  finalRound: boolean
  champion: boolean
}

export interface PerJudgeScore {
  rank: number
  year: number
  name: string
  combiId: number | null
  total: number
  /** 平均に使った審査員の人数(2001年は会場票を除く7人) */
  judges: number
  perJudge: number
}

export interface FinalistsYear {
  year: number
  n: number
  /** メンバーの決勝開催日時点の満年齢の平均 */
  meanAge: number | null
  ageN: number
  /** 結成年数(大会年 − 結成年)の平均 */
  meanFormedYears: number | null
  formedN: number
  /** 出身地: 全員が関西(2府4県) / 一部 / いない / 不明 */
  kansai: { all: number; some: number; none: number; unknown: number }
  /** 吉本(公式DBの現在の所属) */
  yoshimoto: { yes: number; no: number; unknown: number }
  kansaiRows: { all: RosterRows; some: RosterRows; none: RosterRows; unknown: RosterRows }
  yoshimotoRows: { yes: RosterRows; no: RosterRows; unknown: RosterRows }
}
