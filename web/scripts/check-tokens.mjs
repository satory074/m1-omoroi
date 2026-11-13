// 色トークンの組み合わせが WCAG のコントラスト比を満たすか確かめる(依存なし)。
//   文字に使う組み合わせ: 4.5:1 以上(1.4.3)
//   枠線・フォーカス枠・グラフの線: 3:1 以上(1.4.11)
// 値は src/styles/tokens/theme.css の :root から読む。var() の別名は解決する。
// 組み合わせを増やしたら PAIRS に足す。build の前に走るので、ここで落ちたらビルドも止まる。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const css = readFileSync(join(root, 'src/styles/tokens/theme.css'), 'utf8')
const rootBlock = css.match(/:root\s*{([\s\S]*?)}/)?.[1] ?? ''
const raw = Object.fromEntries(
  [...rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]),
)

function resolve(name, seen = new Set()) {
  const v = raw[name]
  if (v === undefined) throw new Error(`トークン ${name} が theme.css にありません`)
  const m = v.match(/^var\((--[\w-]+)\)$/)
  if (!m) return v
  if (seen.has(name)) throw new Error(`トークン ${name} が循環しています`)
  seen.add(name)
  return resolve(m[1], seen)
}

function luminance(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT = 4.5
const UI = 3
// [前景, 背景, 必要な比, 用途]
const PAIRS = [
  ['--c-text', '--c-bg', TEXT, '本文'],
  ['--c-text', '--c-surface-2', TEXT, '帯の上の本文'],
  ['--c-text-muted', '--c-bg', TEXT, '補助文字'],
  ['--c-text-muted', '--c-surface-2', TEXT, '帯・表見出しの補助文字'],
  ['--c-accent', '--c-bg', TEXT, '通過・強調の文字'],
  ['--c-accent', '--c-surface-2', TEXT, '帯の上の強調文字'],
  ['--c-accent-strong', '--c-gold-bg', TEXT, '金の淡い面の上の濃い赤'],
  ['--c-accent', '--c-accent-tint', TEXT, '赤の淡い面の上の赤'],
  ['--c-text', '--c-accent-tint', TEXT, '赤の淡い面の上の本文'],
  ['--c-on-accent', '--c-accent', TEXT, '赤地の白文字'],
  ['--c-gold', '--c-bg', TEXT, '王者の金'],
  ['--c-gold', '--c-gold-bg', TEXT, '金の淡い面の上の金'],
  ['--c-on-stage', '--c-stage', TEXT, '舞台の文字'],
  ['--c-on-stage', '--c-stage-3', TEXT, '得点チップの文字'],
  ['--c-on-stage-muted', '--c-stage', TEXT, '舞台の補助文字'],
  ['--c-on-stage-muted', '--c-stage-2', TEXT, '舞台の面の補助文字'],
  ['--c-on-stage-muted', '--c-stage-3', TEXT, '得点チップの補助文字'],
  ['--c-stage-gold', '--c-stage', TEXT, '舞台の金'],
  ['--c-stage-gold', '--c-stage-3', TEXT, '得点チップの金'],
  ['--c-stage', '--c-stage-gold', TEXT, '金地の黒文字'],
  ['--c-border-strong', '--c-bg', UI, '入力欄・切替の枠'],
  ['--c-focus', '--c-bg', UI, 'フォーカス枠(白地)'],
  ['--c-focus', '--c-surface-2', UI, 'フォーカス枠(帯)'],
  ['--c-stage-gold', '--c-stage', UI, 'フォーカス枠(舞台)'],
  ['--c-chart-1', '--c-bg', UI, 'グラフ1'],
  ['--c-chart-2', '--c-bg', UI, 'グラフ2'],
  ['--c-chart-3', '--c-bg', UI, 'グラフ3'],
  ['--c-chart-4', '--c-bg', UI, 'グラフ4'],
  ['--c-chart-axis', '--c-bg', TEXT, 'グラフの目盛り文字'],
]

let failed = 0
for (const [fg, bg, need, use] of PAIRS) {
  const r = ratio(resolve(fg), resolve(bg))
  const ok = r >= need
  if (!ok) failed++
  const line = `${ok ? 'OK  ' : 'NG  '}${r.toFixed(2).padStart(5)}:1 (必要 ${need}) ${use}  ${fg} / ${bg}`
  ;(ok ? console.log : console.error)(`[check-tokens] ${line}`)
}
if (failed) {
  console.error(`[check-tokens] ${failed}件がコントラスト不足です`)
  process.exit(1)
}
