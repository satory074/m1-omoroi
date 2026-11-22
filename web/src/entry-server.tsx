/* oxlint-disable react/only-export-components -- 画面の部品ではなくサーバー側の入口(開発中の Fast Refresh とは無関係) */
// 事前描画の入口(サーバー側)。`vite build --ssr src/entry-server.tsx --outDir dist-ssr` でビルドし、
// scripts/prerender.mjs が読み込んでページごとの HTML を書き出す。ブラウザ用の JS には入らない
// (react-dom/server をブラウザに読ませないため、main.tsx からは import しない)。
//
// 何を事前描画するか: トップ、年度 /years/{年}/、決勝 /finals/{年}/、記録・統計 /stats/{テーマ}/。
// 画面と同じ部品をそのまま描くので、HTML の中身とブラウザの最初の画面は一致する(main.tsx が hydrate で引き継ぐ)。
// HTML に埋め込むデータは小さいものだけ(meta、年度の要約、決勝1年分、記録統計のそのテーマの JSON = 最大約70KB)。
// 年度ファイル(最大1.7MB)・注目度・日程は埋め込まず、HTML では「読み込み中」の形になる(ブラウザが後から取る)。
import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider, dehydrate, type DehydratedState } from '@tanstack/react-query'
import { StaticRouterProvider, createStaticHandler, createStaticRouter } from 'react-router-dom'

import { QUERY } from './lib/api'
import { finalsPath, statsPath, yearPath } from './lib/paths'
import {
  SITE_DESCRIPTION,
  STATS_SECTIONS,
  finalsDescription,
  finalsSpan,
  finalsTitle,
  fullTitle,
  jsonLd,
  yearDescription,
  yearTitle,
} from './lib/seo'
import type { Champions, FinalsFile, MetaFile, YearSummary } from './lib/types'
import { routes } from './routes'

export { SITE_URL, pageUrl } from './lib/seo'

/** main.tsx と同じ('/m1-omoroi/'。末尾の / を残す) */
const BASENAME = import.meta.env.BASE_URL

type Key = readonly unknown[]

export interface Page {
  /** サイト内のパス(末尾 /、basename なし)。'/years/2025/' */
  path: string
  /** <title> の全文 */
  title: string
  description: string
  jsonLd: Record<string, unknown>
  /** HTML に埋め込み、ブラウザの react-query にそのまま入れるデータ */
  data: [Key, unknown][]
  /** サイトマップの lastmod(データの更新日。分かるページだけ) */
  lastmod?: string
  /** 遅延読み込みの画面部品(src からのパス)。HTML で先読みさせる */
  lazy?: string
}

/** data/ のファイルを読む(prerender.mjs が渡す)。無ければ null */
export type ReadData = (file: string) => unknown

function page(path: string, title: string, description: string, data: [Key, unknown][], extra: Partial<Page> = {}): Page {
  return { path, title: fullTitle(title), description, jsonLd: jsonLd(path, title || fullTitle(''), description), data, ...extra }
}

/** 事前描画するページの一覧。データを読んで、タイトル・説明文・埋め込むデータを決める */
export function listPages(read: ReadData): Page[] {
  const need = <T,>(file: string): T => {
    const v = read(file)
    if (v == null) throw new Error(`[prerender] ${file} がありません`)
    return v as T
  }
  const meta = need<MetaFile>(QUERY.meta.file)
  const metaData: [Key, unknown] = [QUERY.meta.key, meta]
  // データ(年度ファイル)を作り直した日時。シーズン中に変わるページ(トップと最新の年)だけに付ける。
  // 過去の年・決勝・記録統計は作り直しても中身がほぼ同じなので、毎回の日時を付けると更新日として不正確になる
  const updated = meta.generatedAt
  const pages: Page[] = []

  // トップ: meta・大会の集計・王者・最新王者の決勝(合計約17KB)
  const champions = read(QUERY.champions.file) as Champions | null
  const lastChampion = champions?.champions.at(-1)
  const homeData: [Key, unknown][] = [metaData, [QUERY.stats.key, need(QUERY.stats.file)], [QUERY.champions.key, champions]]
  if (lastChampion) {
    const q = QUERY.finals(lastChampion.year)
    homeData.push([q.key, read(q.file)])
  }
  pages.push(page('/', '', SITE_DESCRIPTION, homeData, { lastmod: updated }))

  for (const y of meta.years) {
    const q = QUERY.yearSummary(y)
    const summary = need<YearSummary>(q.file)
    pages.push(
      page(yearPath(y), yearTitle(y, null), yearDescription(summary), [metaData, [q.key, summary]], {
        lastmod: y === meta.latestYear ? updated : undefined,
      }),
    )
  }

  for (const y of meta.finalsYears) {
    const q = QUERY.finals(y)
    const finals = need<FinalsFile>(q.file)
    pages.push(
      page(finalsPath(y), finalsTitle(y), finalsDescription(finals), [metaData, [q.key, finals]], {
        lazy: 'src/pages/FinalsPage.tsx',
      }),
    )
  }

  // 記録・統計はそのテーマの JSON だけ。注目度は名前の索引(約770KB gz)が要るので埋め込まない
  const statsData: Record<string, { key: Key; file: string } | null> = {
    '': QUERY.stats,
    combi: QUERY.rankings,
    finals: QUERY.finalsStats,
    judges: QUERY.judgesStats,
    people: QUERY.peopleStats,
    popularity: null,
  }
  const span = finalsSpan(meta)
  for (const s of STATS_SECTIONS) {
    const q = statsData[s.key]
    const data: [Key, unknown][] = [metaData]
    if (q) data.push([q.key, read(q.file)])
    pages.push(page(statsPath(s.key), s.title, s.description(span), data, { lazy: 'src/pages/StatsPage.tsx' }))
  }
  return pages
}

/** 1ページ分を描く。#root の中身の HTML と、埋め込むデータ(react-query の dehydrate) */
export async function render(p: Page): Promise<{ html: string; state: DehydratedState }> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  for (const [key, value] of p.data) queryClient.setQueryData(key, value)

  // データルーターの静的版。遅延読み込みのルート(決勝・記録統計)もここで読み込まれる
  const handler = createStaticHandler(routes, { basename: BASENAME })
  const url = new URL(`${BASENAME}${p.path.slice(1)}`, 'https://prerender.invalid')
  const context = await handler.query(new Request(url))
  if (context instanceof Response) throw new Error(`[prerender] ${p.path} が転送になった(${context.status})`)
  if (context.statusCode !== 200 || context.errors) {
    throw new Error(`[prerender] ${p.path} を描けない(${context.statusCode}): ${JSON.stringify(context.errors)}`)
  }
  const router = createStaticRouter(handler.dataRoutes, context)
  // ルーターにローダーは無いので、ルーター側の hydrate 用データ(window.__staticRouterHydrationData)は要らない
  const html = renderToString(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <StaticRouterProvider router={router} context={context} hydrate={false} />
      </QueryClientProvider>
    </StrictMode>,
  )
  return { html, state: dehydrate(queryClient) }
}
