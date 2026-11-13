// スタイルの書き方の決まりを確かめる(依存なし)。
//   1. 色はトークン経由: src/styles/ の CSS(tokens/ と legacy.css を除く)に #hex / rgb() / hsl() を直書きしない
//   2. 文字サイズもトークン経由: 同じ範囲で font-size に px を直書きしない
//   3. 読み込んでいない太さを使わない: CSS(legacy 含む)と TSX の font-weight は index.html の Google Fonts の太さだけ
//   4. TSX に色を直書きしない(移行待ちのファイルは警告だけ。移行したら LEGACY_TSX から外す)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'src')

// 移行待ちのファイル(ここにあるものは警告だけ。2026-11 の第6段階で空になった)
const LEGACY_TSX = new Set([])

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const html = readFileSync(join(root, 'index.html'), 'utf8')
const loaded = new Set(
  [...html.matchAll(/family=[^"&]*?:wght@([\d;]+)/g)].flatMap(([, w]) => w.split(';').map(Number)),
)
if (loaded.size === 0) {
  console.error('[check-css] index.html から読み込んでいる太さを読み取れませんでした')
  process.exit(1)
}

const errors = []
const warnings = []
const lineOf = (text, index) => text.slice(0, index).split('\n').length

for (const file of walk(src)) {
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  // コメントは検査しない(位置がずれないよう同じ長さの空白に置き換える)
  const code = file.endsWith('.css')
    ? text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    : text.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))

  if (file.endsWith('.css')) {
    const strict = rel.startsWith('src/styles/') && !rel.startsWith('src/styles/tokens/') && rel !== 'src/styles/legacy.css'
    if (strict) {
      for (const m of code.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)) {
        errors.push(`${rel}:${lineOf(code, m.index)} 色の直書き ${m[0]} → tokens/theme.css の変数を使う`)
      }
      for (const m of code.matchAll(/font-size\s*:\s*[\d.]+px/g)) {
        errors.push(`${rel}:${lineOf(code, m.index)} 文字サイズの px 直書き → --fs-* を使う`)
      }
    }
    for (const m of code.matchAll(/font-weight\s*:\s*(\d+)/g)) {
      if (!loaded.has(Number(m[1]))) {
        errors.push(`${rel}:${lineOf(code, m.index)} 読み込んでいない太さ ${m[1]}(読み込み済み: ${[...loaded].join('/')})`)
      }
    }
  } else if (/\.tsx?$/.test(file)) {
    for (const m of code.matchAll(/fontWeight\s*:\s*(\d+)/g)) {
      if (!loaded.has(Number(m[1]))) errors.push(`${rel}:${lineOf(code, m.index)} 読み込んでいない太さ ${m[1]}`)
    }
    for (const m of code.matchAll(/['"`]#[0-9a-fA-F]{3,8}['"`]/g)) {
      const msg = `${rel}:${lineOf(code, m.index)} 色の直書き ${m[0]} → CSS 変数(useTokens)を使う`
      ;(LEGACY_TSX.has(rel) ? warnings : errors).push(msg)
    }
  }
}

for (const w of warnings) console.warn(`[check-css] 移行待ち: ${w}`)
for (const e of errors) console.error(`[check-css] ${e}`)
console.log(`[check-css] エラー ${errors.length}件 / 移行待ちの警告 ${warnings.length}件`)
process.exit(errors.length ? 1 : 0)
