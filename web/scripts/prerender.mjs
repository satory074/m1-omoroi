// 事前描画: `vite build`(dist)と `vite build --ssr src/entry-server.tsx --outDir dist-ssr` の後に実行する。
//
// なぜ: GitHub Pages ではこれまで深い URL(/years/2025 など)のファイルが無く、404.html(中身が空)を返して
// ブラウザの JavaScript が画面を描いていた。HTTP 404 なので検索エンジンには載らず、JavaScript を実行しない
// AI のクローラーには中身が見えなかった。ここでページごとに「<パス>/index.html」を書き出し、HTTP 200 で本文入りの
// HTML を返す。ブラウザでは main.tsx がその HTML を引き継ぐ(hydrate)。
//
// 書き出すもの:
//   dist/index.html、dist/{years,finals}/{年}/index.html、dist/stats/{テーマ}/index.html … 事前描画したページ
//   dist/years/index.html・dist/finals/index.html … 最新の年へ転送するだけのページ(noindex。ヘッダーのナビの先)
//   dist/404.html … 中身が空の殻(noindex・canonical なし)。コンビ詳細など事前描画していない URL はこれが描く。
//                   トップの HTML を写すと、知らない URL で一瞬トップの中身が出て hydrate も食い違うので必ず殻にする
//   dist/sitemap.xml … 事前描画したページ全部(noindex は載せない)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const ssrEntry = join(root, 'dist-ssr', 'entry-server.js')
if (!existsSync(join(dist, 'index.html')) || !existsSync(ssrEntry)) {
  console.error('[prerender] dist/index.html か dist-ssr/entry-server.js がありません。先に vite build と vite build --ssr を実行してください')
  process.exit(1)
}

const { listPages, render, pageUrl, SITE_URL } = await import(pathToFileURL(ssrEntry).href)
const template = readFileSync(join(dist, 'index.html'), 'utf8')
const manifestPath = join(dist, '.vite', 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** <script> の中に置く JSON。</script> や行区切り文字で途中で切れないようにする */
const scriptJson = (v) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/** テンプレートの1か所を置き換える。見つからない・2か所以上あるならビルドを止める(黙って古い値が残らないように) */
function replaceOnce(html, pattern, replacement, label) {
  const matches = html.match(new RegExp(pattern.source, 'g'))
  if (!matches || matches.length !== 1) throw new Error(`[prerender] テンプレートの ${label} が1か所ではない(${matches?.length ?? 0})`)
  return html.replace(pattern, replacement)
}

const TITLE = /<title>[^<]*<\/title>/
const DESC = /<meta name="description" content="[^"]*" \/>/
const OG_TITLE = /<meta property="og:title" content="[^"]*" \/>/
const OG_DESC = /<meta property="og:description" content="[^"]*" \/>/
const OG_URL = /<meta property="og:url" content="[^"]*" \/>/
const ROOT = /<div id="root"><\/div>/
const HEAD_END = /\n\s*<\/head>/

/** 遅延読み込みの画面部品と、それが読む JS(最初に読む JS は除く)。HTML で先読みさせて hydrate を早める */
function lazyChunks(src) {
  const out = new Set()
  const visit = (key) => {
    const chunk = manifest[key]
    if (!chunk || chunk.isEntry || out.has(chunk.file)) return
    out.add(chunk.file)
    for (const imp of chunk.imports ?? []) visit(imp)
  }
  visit(src)
  if (src && out.size === 0) throw new Error(`[prerender] manifest に ${src} がありません`)
  return [...out]
}

const readData = (file) => {
  const p = join(dist, 'data', file)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

function writePage(path, html) {
  const file = join(dist, path, 'index.html')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
}

// ---------- 事前描画したページ ----------

const pages = listPages(readData)
const base = new URL(SITE_URL).pathname // '/m1-omoroi/'
for (const page of pages) {
  const { html: appHtml, state } = await render(page)
  // 念のための不変条件: 見つからない・エラーの画面を書き出していない / 戻りリンクのバーが HTML にある
  if (/ページが見つかりません|表示できませんでした|の大会はありません/.test(appHtml)) {
    throw new Error(`[prerender] ${page.path} が「見つからない」画面になった`)
  }
  if (!appHtml.includes('app-backlink-bar')) throw new Error(`[prerender] ${page.path} に app-backlink-bar が無い`)

  const url = pageUrl(page.path)
  const preload = lazyChunks(page.lazy)
    .map((f) => `    <link rel="modulepreload" crossorigin href="${base}${f}">\n`)
    .join('')
  let html = template
  html = replaceOnce(html, TITLE, `<title>${escapeText(page.title)}</title>`, '<title>')
  html = replaceOnce(html, DESC, `<meta name="description" content="${escapeAttr(page.description)}" />`, 'description')
  html = replaceOnce(html, OG_TITLE, `<meta property="og:title" content="${escapeAttr(page.title)}" />`, 'og:title')
  html = replaceOnce(html, OG_DESC, `<meta property="og:description" content="${escapeAttr(page.description)}" />`, 'og:description')
  html = replaceOnce(
    html,
    OG_URL,
    `<meta property="og:url" content="${escapeAttr(url)}" />\n    <link rel="canonical" href="${escapeAttr(url)}" />`,
    'og:url',
  )
  html = replaceOnce(
    html,
    HEAD_END,
    `\n${preload}    <script type="application/ld+json">${scriptJson(page.jsonLd)}</script>\n  </head>`,
    '</head>',
  )
  html = replaceOnce(
    html,
    ROOT,
    `<div id="root" data-prerendered="${escapeAttr(new URL(url).pathname)}">${appHtml}</div>\n` +
      `    <script id="prerender-data" type="application/json">${scriptJson(state)}</script>`,
    '#root',
  )
  writePage(page.path, html)
}

// ---------- 404.html(空の殻) ----------

const notFound = replaceOnce(template, OG_URL, '<meta name="robots" content="noindex" />', 'og:url')
writeFileSync(join(dist, '404.html'), notFound)


// ---------- /years/・/finals/(最新の年へ転送) ----------

const meta = readData('meta.json')
const stylesheet = template.match(/<link rel="stylesheet" crossorigin href="[^"]+">/)?.[0] ?? ''
const favicon = template.match(/<link rel="icon"[^>]*>/)?.[0] ?? ''
// 戻りリンクのバーは App.tsx と同じ文言・リンク先(正準仕様: basecamp/docs/app-backlink.md)
const backlink =
  '<nav class="app-backlink-bar" aria-label="サイト間ナビゲーション"><a href="https://satory074.com/apps/" target="_blank" rel="noopener" aria-label="satory074 のほかのアプリ一覧を新しいタブで開く">satory074 のほかのアプリ <span aria-hidden="true">↗</span></a></nav>'
const redirects = [
  { path: '/years/', to: `/years/${meta.latestYear}/`, label: `M-1グランプリ${meta.latestYear}の結果` },
  { path: '/finals/', to: `/finals/${meta.finalsYears.at(-1)}/`, label: `M-1グランプリ${meta.finalsYears.at(-1)}の決勝の得点` },
]
for (const r of redirects) {
  const target = `${base}${r.to.slice(1)}`
  writePage(
    r.path,
    `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <meta http-equiv="refresh" content="0; url=${target}" />
    <title>${escapeText(r.label)}へ移動します | M-1オモロイ</title>
    ${favicon}
    ${stylesheet}
    <script>location.replace(${JSON.stringify(target)} + location.search + location.hash)</script>
  </head>
  <body>
    <main style="padding: 24px 16px">
      <p><a href="${target}">${escapeText(r.label)}</a>へ移動します。</p>
    </main>
    ${backlink}
  </body>
</html>
`,
  )
}

// ---------- /likes/(いいね。中身の無い殻) ----------
// 中身は端末ごとの localStorage なので事前描画しない。ただしヘッダーのナビが全ページから指すので、
// 404 ではなく HTTP 200 で返るよう 404.html と同じ殻を置く(noindex のまま。サイトマップにも載せない)。
// 戻りリンクのバーは #root の中に入れる: 静的 HTML にもバーがあり(seo-check の条件)、ブラウザでは
// main.tsx が createRoot で #root を描き直すときにアプリ自身のバーに置き換わる(二重にならない)
writePage('/likes/', replaceOnce(notFound, ROOT, `<div id="root">${backlink}</div>`, '#root'))

// ---------- sitemap.xml ----------

const urls = pages
  .map((p) => {
    const lastmod = p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''
    return `  <url><loc>${escapeText(pageUrl(p.path))}</loc>${lastmod}</url>`
  })
  .join('\n')
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
)

// どの画面がどの JS を読むかの表は公開しない
rmSync(join(dist, '.vite'), { recursive: true, force: true })
console.log(`[prerender] ${pages.length} ページ + 転送 ${redirects.length} + 404.html + likes/ + sitemap.xml を ${dist} に書きました`)
