import type { CombiIndexRow, CombiMemberIndexRow } from './types'

/* ============ 正規化 ============ */

const HIRAGANA = /[ぁ-ゖ]/g
const SMALL_KANA = /[ァィゥェォッャュョヮヵヶ]/g
const SMALL_KANA_MAP: Record<string, string> = {
  ァ: 'ア',
  ィ: 'イ',
  ゥ: 'ウ',
  ェ: 'エ',
  ォ: 'オ',
  ッ: 'ツ',
  ャ: 'ヤ',
  ュ: 'ユ',
  ョ: 'ヨ',
  ヮ: 'ワ',
  ヵ: 'カ',
  ヶ: 'ケ',
}
/** 空白・約物・記号・長音符を落とす。ー(U+30FC) は Lm なので \p{P}\p{S} に入らず明示が要る */
const NOISE = /[\p{White_Space}\p{P}\p{S}ー]/gu

/**
 * 検索用の正規化キーを作る。針(クエリ)と藁(データ)の両方に同じ関数を通すので
 * 畳み込みは常に対称になる。ライブラリを足さずハンドロールなのは依存を増やさないため。
 *
 *   NFKC          ｱｲｳ/ＡＢＣ/（） → アイウ/ABC/() 、半角濁点 ｶﾞ → ガ を合成
 *   ひらがな→カタカナ  かな表記が公式DB=カタカナ / legacy_combis=ひらがな で不統一なため必須
 *   小書き仮名畳み  サンドウィッチマン ⇄ サンドウイッチマン、ジャルジャル ⇄ ジヤルジヤル
 *   小文字化       ＭＩＬＫ → milk
 *   記号除去       ・。！～☆-() / 「M-1」⇄「M1」/ 空白の有無を吸収
 *
 * 注意: 記号だけの入力は空文字になる。呼び出し側は結果が空文字なら検索しないこと
 * (String.includes('') は常に true なので全件ヒットしてしまう)。
 */
export function normalize(s: string): string {
  if (!s) return ''
  return s
    .normalize('NFKC')
    .replace(HIRAGANA, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(SMALL_KANA, (c) => SMALL_KANA_MAP[c])
    .toLowerCase()
    .replace(NOISE, '')
}

/* ============ 一致の質(ランキング第1段) ============ */

export const TIER_EXACT = 0
export const TIER_PREFIX = 1
export const TIER_SUBSTR = 2
export const TIER_NONE = 9

/** 正規化済みの名前・かなに対する一致の質。includes を先に見て、狭まった分だけ厳密判定する */
export function tierOf(name: string, kana: string, q: string): number {
  const inName = name.includes(q)
  const inKana = kana.length > 0 && kana.includes(q)
  if (!inName && !inKana) return TIER_NONE
  if (name === q || kana === q) return TIER_EXACT
  if (name.startsWith(q) || kana.startsWith(q)) return TIER_PREFIX
  return TIER_SUBSTR
}

/* ============ 上位K件の取り出し ============ */

/**
 * 全件ソートせず上位n件だけ挿入選択で取り出す。
 * 1文字クエリはメンバー側で17,000件以上ヒットし、Array.sort + localeCompare だと
 * 1打鍵あたり40ms超かかる(実測)。この関数なら同条件で1ms台に収まる。
 * 安定ソートではないので、cmp の最終段に決定的なキー(行番号)を入れること。
 */
export function topK<T>(items: T[], n: number, cmp: (a: T, b: T) => number): T[] {
  if (n <= 0) return []
  const out: T[] = []
  for (const x of items) {
    if (out.length === n && cmp(x, out[n - 1]) >= 0) continue
    let j = out.length < n ? out.length : n - 1
    while (j > 0 && cmp(out[j - 1], x) > 0) {
      out[j] = out[j - 1]
      j--
    }
    out[j] = x
    if (out.length > n) out.length = n
  }
  return out
}

/* ============ 正規化済み索引の構築(データごとに1回だけ) ============ */

export interface CombiKeys {
  /** combi/index.json と同順の正規化済みコンビ名 */
  names: string[]
  /** 同順の正規化済みかな */
  kanas: string[]
}

export interface MemberKeys {
  /** 表示用の生メンバー名(全コンビ分をフラットに連結) */
  raw: string[]
  /** 五十音順の並べ替えキー(生のかな。無ければ生の名前) */
  rawSort: string[]
  /** 正規化済みメンバー名 */
  names: string[]
  /** 正規化済みメンバーかな */
  kanas: string[]
  /** コンビ行 i のメンバーは [off[i], off[i + 1]) の範囲 */
  off: Int32Array
}

// react-query の staleTime/gcTime が Infinity なのでフェッチ結果の参照は
// セッション中ずっと同一。参照をキーにしたモジュールキャッシュで StrictMode の
// 二重レンダリングやヘッダーの再マウントを跨いでも1回で済む。
let combiCache: { src: CombiIndexRow[]; out: CombiKeys } | null = null

export function getCombiKeys(index: CombiIndexRow[]): CombiKeys {
  if (combiCache?.src === index) return combiCache.out
  const n = index.length
  const names = new Array<string>(n)
  const kanas = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    names[i] = normalize(index[i][1])
    kanas[i] = normalize(index[i][2] ?? '')
  }
  combiCache = { src: index, out: { names, kanas } }
  return combiCache.out
}

const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0))

/**
 * combi/members.json を正規化済みのフラット構造に展開する。
 * 176,000文字列の正規化に約100ms(実測)かかるので、IME変換中の入力を止めないよう
 * 一定行ごとにメインスレッドへ制御を返す。react-query の queryFn 内で1回だけ走る。
 */
export async function buildMemberKeys(rows: CombiMemberIndexRow[]): Promise<MemberKeys> {
  let total = 0
  for (const r of rows) total += r.length >> 1
  const raw = new Array<string>(total)
  const rawSort = new Array<string>(total)
  const names = new Array<string>(total)
  const kanas = new Array<string>(total)
  const off = new Int32Array(rows.length + 1)
  let p = 0
  for (let i = 0; i < rows.length; i++) {
    off[i] = p
    const r = rows[i]
    for (let k = 0; k < r.length; k += 2) {
      const name = r[k]
      const kana = r[k + 1]
      raw[p] = name
      rawSort[p] = kana || name
      names[p] = normalize(name)
      kanas[p] = normalize(kana)
      p++
    }
    if ((i & 4095) === 0) await yieldToMain()
  }
  off[rows.length] = p
  return { raw, rawSort, names, kanas, off }
}

/* ============ ヒットの探索とランキング ============ */

/** 五十音順の比較。localeCompare より速く、毎回作り直さないようモジュールスコープに置く */
const collator = new Intl.Collator('ja')

export interface Hit {
  /** combi/index.json の行番号 */
  i: number
  /** MemberKeys 内のメンバー番号(コンビ名ヒットは -1) */
  m: number
  tier: number
  pop: number
  nYears: number
  lastYear: number
  /** 五十音の並べ替えキー(生のかな。無ければ生の名前) */
  sortKey: string
}

/** 出場年リストを連続範囲に畳んで表示する。例 [2015,2016,2017,2022,2023] → "2015–2017, 2022–2023" */
export function formatYears(years: number[]): string {
  if (!years || years.length === 0) return ''
  const ys = [...years].sort((a, b) => a - b)
  const parts: string[] = []
  let start = ys[0]
  let prev = ys[0]
  for (let i = 1; i <= ys.length; i++) {
    if (i < ys.length && ys[i] === prev + 1) {
      prev = ys[i]
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`)
    if (i < ys.length) {
      start = ys[i]
      prev = ys[i]
    }
  }
  return parts.join(', ')
}

/**
 * 関連度順: 一致の質 → 注目度 → 出場年数 → 直近出場年 → 五十音 → 行番号。
 * 注目度(YouTube再生数)は3回戦以上の約1,300組にしか無く、残り約41,800組は全て -1 で並ぶ。
 * そのまま五十音へ落とすと「田中」のような多ヒット時の並びが無作為に見えるので、
 * index に元から入っている出場年で「常連ほど上」の弱い信号を足している。
 * 最終段の行番号は決定性のため必須(topK は安定ソートではない)。
 */
export function cmpHit(a: Hit, b: Hit): number {
  if (a.tier !== b.tier) return a.tier - b.tier
  // 「すべて」タブで両種を混ぜたとき、同ティアならコンビ名を先に出す。
  // ドロップダウンはコンビ名セクションが上なので、順序を食い違わせないため。
  // 同一セクション内では m の符号が揃うので何もしないのと同じ
  const ka = a.m < 0 ? 0 : 1
  const kb = b.m < 0 ? 0 : 1
  if (ka !== kb) return ka - kb
  if (a.pop !== b.pop) return b.pop - a.pop
  if (a.nYears !== b.nYears) return b.nYears - a.nYears
  if (a.lastYear !== b.lastYear) return b.lastYear - a.lastYear
  const c = collator.compare(a.sortKey, b.sortKey)
  return c !== 0 ? c : a.i - b.i
}

function makeHit(
  index: CombiIndexRow[],
  i: number,
  m: number,
  tier: number,
  pop: number,
  sortKey: string,
): Hit {
  const yrs = index[i][3]
  return { i, m, tier, pop, nYears: yrs.length, lastYear: yrs.length > 0 ? yrs[yrs.length - 1] : 0, sortKey }
}

export interface Hits {
  combi: Hit[]
  member: Hit[]
}

const NO_HITS: Hits = { combi: [], member: [] }

/**
 * 正規化済みクエリ q に一致する**全ヒット**を返す(件数上限なし・未ソート)。
 * ドロップダウンは topK で20件に絞り、展開パネルは全件を並べ替えて使う —
 * 両者が同じ実装を通ることで、候補と「他 N 件」の中身が食い違わないようにしている。
 *
 * 芸人名側はコンビ名で既にヒットした組を除外し、1組につき最良ティアの1人だけ返す
 * (同じコンビへ飛ぶ行が並んでも情報が増えないため)。
 *
 * 最悪ケース(「ん」)で約27,000個の Hit を確保するが、これは打鍵ごとに走っても
 * 実測3〜8msに収まる。重いのは並べ替えの方なので、そちらは呼び出し側の責務にしてある。
 */
export function findHits(
  q: string,
  index: CombiIndexRow[] | undefined,
  combiKeys: CombiKeys | null,
  memberKeys: MemberKeys | null | undefined,
  popOf: (id: number) => number,
): Hits {
  // 記号や空白だけの入力は正規化すると空文字になる。String.includes('') は常に true なので
  // ここで弾かないと全43,108組 + 全88,315人がヒットする
  if (!q || !index || !combiKeys) return NO_HITS

  const matchedCombi = new Uint8Array(index.length)
  const combi: Hit[] = []
  for (let i = 0; i < index.length; i++) {
    const t = tierOf(combiKeys.names[i], combiKeys.kanas[i], q)
    if (t === TIER_NONE) continue
    matchedCombi[i] = 1
    combi.push(makeHit(index, i, -1, t, popOf(index[i][0]), index[i][2] || index[i][1]))
  }

  const member: Hit[] = []
  if (memberKeys) {
    const { names, kanas, rawSort, off } = memberKeys
    for (let i = 0; i < index.length; i++) {
      if (matchedCombi[i]) continue
      let best = -1
      let bestTier = TIER_NONE
      for (let m = off[i]; m < off[i + 1]; m++) {
        const t = tierOf(names[m], kanas[m], q)
        if (t < bestTier) {
          bestTier = t
          best = m
          if (t === TIER_EXACT) break
        }
      }
      if (best < 0) continue
      member.push(makeHit(index, i, best, bestTier, popOf(index[i][0]), rawSort[best]))
    }
  }

  return { combi, member }
}

/* ============ 展開パネルのタブと並び替え ============ */

export type PanelTab = 'all' | 'combi' | 'member'
export type PanelSort = 'relevance' | 'pop' | 'round' | 'kana' | 'year'

export const PANEL_TABS: PanelTab[] = ['all', 'combi', 'member']
export const PANEL_SORTS: { key: PanelSort; label: string }[] = [
  { key: 'relevance', label: '関連度順' },
  { key: 'pop', label: '注目度順' },
  { key: 'round', label: '最高到達ラウンド順' },
  { key: 'kana', label: '五十音順' },
  { key: 'year', label: '出場年順 (新しい順)' },
]

export function isPanelTab(v: string | null): v is PanelTab {
  return v === 'all' || v === 'combi' || v === 'member'
}

export function isPanelSort(v: string | null): v is PanelSort {
  return PANEL_SORTS.some((s) => s.key === v)
}

/** 並び替えの比較関数。index を参照するのは最高到達ラウンド(5要素目)を見るため。 */
export function comparatorFor(sort: PanelSort, index: CombiIndexRow[]): (a: Hit, b: Hit) => number {
  const kana = (a: Hit, b: Hit) => collator.compare(a.sortKey, b.sortKey) || a.i - b.i
  switch (sort) {
    case 'pop':
      return (a, b) => (b.pop !== a.pop ? b.pop - a.pop : cmpHit(a, b))
    case 'round':
      // 不明(0)は最後に落ちる。同着は注目度 → 五十音で解く
      return (a, b) => {
        // GitHub Pages は max-age=600 なので、新JS × 旧index.json(4要素)の組み合わせが
        // 一時的に起こりうる。undefined のまま引くと NaN になりソートが壊れる
        const ra = index[a.i][4] ?? 0
        const rb = index[b.i][4] ?? 0
        if (ra !== rb) return rb - ra
        if (a.pop !== b.pop) return b.pop - a.pop
        return kana(a, b)
      }
    case 'kana':
      return kana
    case 'year':
      return (a, b) => {
        if (a.lastYear !== b.lastYear) return b.lastYear - a.lastYear
        if (a.nYears !== b.nYears) return b.nYears - a.nYears
        return kana(a, b)
      }
    default:
      return cmpHit
  }
}
