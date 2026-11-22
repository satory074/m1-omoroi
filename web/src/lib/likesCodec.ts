// いいねのキーと、バックアップ用リンク(URL の # 以降)の符号化。
// ここは import を持たない純関数だけにしている(node --experimental-strip-types でそのまま試せるように。
// 試験は web/scripts/test-likes.mjs)。
//
// いいね1件 = 1本のネタ = 「年:回戦:コンビID」(例 "2026:third:39447")。
// リンクの形: "v1." + 年と回戦ごとのまとまりを "-" でつなぐ + "." + 検査値。
//   まとまり = 年4桁 + 回戦コード1桁 + "~" + IDを36進で "_" 区切り。例: v1.20263~u8f_1d4-20264~ab.1x3k9q
// 検査値(本文の FNV-1a を36進)は、メモや LINE へ貼るときにリンクが途中で切れたのを見分けるため。
// 切れると最後のIDが別の数字に化けて、黙って違う組を取り込んでしまう。
// 使う文字は URL の非予約文字(英数字 . _ ~ -)だけ。LINE やメモの自動リンクが途中で切らないようにするため。
// 回戦コードは M-1 公式の回戦番号と同じ固定の表。画面の回戦の並び(ROUND_ORDER)が変わってもリンクは読める。

export const ROUND_CODES = {
  first: '1',
  second: '2',
  third: '3',
  quarterfinal: '4',
  semifinal: '5',
  playoff: '6',
  final: '7',
} as const

export type LikeRound = keyof typeof ROUND_CODES

const CODE_ROUND: Record<string, LikeRound> = Object.fromEntries(
  Object.entries(ROUND_CODES).map(([round, code]) => [code, round as LikeRound]),
)

/** 版の印。形を変えるときは v2 を足し、v1 も読めるように残す */
export const LINK_PREFIX = 'v1.'

/** 1本のリンクから読む上限。手で作った巨大なリンクで固まらないように */
const MAX_LINK_KEYS = 20000

const KEY_RE = /^(\d{4}):(first|second|third|quarterfinal|semifinal|playoff|final):([1-9]\d{0,8})$/
const GROUP_RE = /^(\d{4})([1-7])~([0-9a-z]+(?:_[0-9a-z]+)*)$/

export interface LikeRef {
  year: number
  round: LikeRound
  id: number
}

export function likeKey(year: number, round: LikeRound, id: number): string {
  return `${year}:${round}:${id}`
}

/** 形式に合わないキーは null(保存データが壊れていても、読めるものだけ拾うため) */
export function parseLikeKey(key: string): LikeRef | null {
  const m = KEY_RE.exec(key)
  if (!m) return null
  return { year: Number(m[1]), round: m[2] as LikeRound, id: Number(m[3]) }
}

/** キーの列を、重複なし・形式どおりのものだけにする(順は最初に出た順) */
export function normalizeKeys(keys: readonly unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const k of keys) {
    if (typeof k !== 'string' || seen.has(k) || !parseLikeKey(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** 本文の検査値(FNV-1a 32bit を36進) */
function checksum(body: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** バックアップ用リンクの # 以降(先頭の # は付けない)。同じ集合なら並びによらず同じ文字列になる */
export function encodeLikes(keys: readonly string[]): string {
  const groups = new Map<string, number[]>()
  for (const k of keys) {
    const ref = parseLikeKey(k)
    if (!ref) continue
    const g = `${ref.year}${ROUND_CODES[ref.round]}`
    const ids = groups.get(g)
    if (ids) ids.push(ref.id)
    else groups.set(g, [ref.id])
  }
  const parts = [...groups.keys()].sort().map((g) => {
    const ids = [...new Set(groups.get(g))].sort((a, b) => a - b)
    return `${g}~${ids.map((id) => id.toString(36)).join('_')}`
  })
  const body = parts.join('-')
  return `${LINK_PREFIX}${body}.${checksum(body)}`
}

export interface DecodedLikes {
  keys: string[]
  /** 検査値が合ったか。false ならリンクが途中で切れている(または書き換えられている)ので取り込まない */
  intact: boolean
}

/**
 * # 以降(先頭の # はあってもなくてもよい)からキーの列を読む。
 * いいねのリンクでなければ null。決して throw しない。形の崩れたまとまりは読み飛ばす
 */
export function decodeLikes(hash: string): DecodedLikes | null {
  let s = hash.startsWith('#') ? hash.slice(1) : hash
  try {
    s = decodeURIComponent(s)
  } catch {
    // % の壊れたリンク。そのまま読んでみる
  }
  if (!s.startsWith(LINK_PREFIX)) return null
  const rest = s.slice(LINK_PREFIX.length)
  const dot = rest.lastIndexOf('.')
  const body = dot >= 0 ? rest.slice(0, dot) : rest
  const intact = dot >= 0 && rest.slice(dot + 1) === checksum(body)
  const keys: string[] = []
  if (body !== '') {
    for (const part of body.split('-')) {
      const m = GROUP_RE.exec(part)
      if (!m) continue
      const round = CODE_ROUND[m[2]]
      for (const id36 of m[3].split('_')) {
        const id = parseInt(id36, 36)
        if (!Number.isSafeInteger(id) || id <= 0) continue
        keys.push(likeKey(Number(m[1]), round, id))
        if (keys.length >= MAX_LINK_KEYS) return { keys: normalizeKeys(keys), intact: false }
      }
    }
  }
  return { keys: normalizeKeys(keys), intact }
}

/** 足し合わせ。今あるもの(base)は1件も減らさず、順も変えない。新しいものは後ろへ */
export function mergeLikes(base: readonly string[], incoming: readonly string[]): string[] {
  return normalizeKeys([...base, ...incoming])
}
