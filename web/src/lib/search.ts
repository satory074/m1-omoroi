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
