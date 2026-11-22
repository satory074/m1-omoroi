// いいねのリンク(src/lib/likesCodec.ts)の不変条件。依存を足さず Node の型の取り除きで .ts をそのまま読む:
//   node --experimental-strip-types --test scripts/test-likes.mjs   (npm run test)
// 壊れたら困るのは「バックアップしたいいねが戻らない」「取り込みで今のいいねが減る」「変なリンクで画面が落ちる」こと。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ROUND_CODES,
  decodeLikes,
  encodeLikes,
  likeKey,
  mergeLikes,
  normalizeKeys,
  parseLikeKey,
} from '../src/lib/likesCodec.ts'

const ROUNDS = Object.keys(ROUND_CODES)
const LINK_HEAD = 'v1.'.length

function randomKeys(n, seed) {
  let x = seed
  const rnd = () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
  const keys = []
  for (let i = 0; i < n; i++) {
    const year = [2001, 2008, 2015, 2025, 2026][Math.floor(rnd() * 5)]
    const round = ROUNDS[Math.floor(rnd() * ROUNDS.length)]
    // 公式DBのID(1〜4万台)と、合成コンビの予約ID(900001〜)
    const id = rnd() < 0.1 ? 900001 + Math.floor(rnd() * 50) : 1 + Math.floor(rnd() * 45000)
    keys.push(likeKey(year, round, id))
  }
  return keys
}

test('リンクにして読み戻すと、同じ集合に戻る(並び・重複によらない)', () => {
  for (const seed of [1, 2, 3, 42]) {
    const keys = randomKeys(500, seed)
    const back = decodeLikes('#' + encodeLikes(keys))
    assert.equal(back.intact, true)
    assert.deepEqual(new Set(back.keys), new Set(keys))
    // 同じ集合なら同じ文字列(並びを変えても)
    assert.equal(encodeLikes([...keys].reverse()), encodeLikes(keys))
  }
})

test('リンクに使う文字は URL の非予約文字だけ(自動リンクで途中が切れない)', () => {
  const hash = encodeLikes(randomKeys(300, 7))
  assert.match(hash, /^[0-9A-Za-z._~-]+$/)
})

test('壊れたリンク・別のハッシュでは落ちない。途中で切れたリンクは intact=false', () => {
  const inputs = ['', '#', '#top', '#v1.', '#v1.%E0%A4%A', '#v1.20263~zz_!!_1-abc-99999~1', '#v2.20263~1', '#v1.' + 'x'.repeat(100000)]
  for (const s of inputs) assert.doesNotThrow(() => decodeLikes(s))
  assert.equal(decodeLikes('#top'), null)
  // 回戦コードは1〜7。形の崩れたまとまりは読み飛ばす
  assert.deepEqual(decodeLikes('#v1.20269~1-20263~1').keys, [likeKey(2026, 'third', 1)])

  const full = encodeLikes(randomKeys(80, 5))
  // どこで切れても、検査値が合って「完全」と判定されることはない(切れて最後のIDが化けた組を取り込まない)
  for (let cut = LINK_HEAD; cut < full.length; cut++) {
    const d = decodeLikes(full.slice(0, cut))
    assert.equal(d.intact, false, `cut=${cut}`)
  }
  assert.equal(decodeLikes(full).intact, true)
  // 空の一覧のリンクも作れて読める
  assert.deepEqual(decodeLikes(encodeLikes([])), { keys: [], intact: true })
})

test('取り込み(足し合わせ)は今のいいねを1件も減らさず、順も変えず、重複を作らない', () => {
  const base = randomKeys(200, 11)
  const incoming = [...randomKeys(150, 12), ...base.slice(0, 30)]
  const merged = mergeLikes(base, incoming)
  const nb = normalizeKeys(base)
  assert.deepEqual(merged.slice(0, nb.length), nb)
  assert.equal(new Set(merged).size, merged.length)
  for (const k of incoming) assert.ok(merged.includes(k))
})

test('キーの形に合わないものは読み込みで捨てる', () => {
  assert.deepEqual(normalizeKeys(['2026:third:39447', '2026:third:39447', '2026:semis:1', 'x', 3, null, '2026:final:0']), [
    '2026:third:39447',
  ])
  assert.deepEqual(parseLikeKey('2026:quarterfinal:648'), { year: 2026, round: 'quarterfinal', id: 648 })
})
