import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, hydrate, type DehydratedState } from '@tanstack/react-query'
import { RouterProvider, createBrowserRouter, matchRoutes } from 'react-router-dom'

import { routes } from './routes'
import './styles/main.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

// 末尾の / を残す('/m1-omoroi/')。外すとトップへのリンク(to="/")が /m1-omoroi になり、GitHub Pages が / 付きへ 301 で転送する
const basename = import.meta.env.BASE_URL

// 直接開いた(URL入力・外部リンク)最初の履歴エントリーは history.state が空で、
// React Router はその location.key を一律 "default" にする。すると ScrollRestoration と
// scrollMemory.ts が、同じタブで以前 "default" として覚えた位置を別のページにも当ててしまう
// (別のページを直接開いたのに途中から表示される)。ルーターが読む前に固有のキーを振っておく。
// history.state に入れるので、再読み込みや他サイトから戻ったときは同じキーのまま復元される
if (!window.history.state?.key) {
  window.history.replaceState(
    { ...window.history.state, key: Math.random().toString(36).slice(2, 10) },
    '',
  )
}

// 開発時だけ、画面を移るたびにアクセシビリティの最低条件を監査して console に出す(src/dev/audit.ts)
if (import.meta.env.DEV) {
  void import('./dev/audit').then((m) => m.installAudit())
}

// 事前描画したページ(scripts/prerender.mjs)は、描いたときのデータを HTML に埋め込んでいる。
// 先に react-query へ入れておくと、取りに行かずにそのデータで最初の画面を描ける(HTML と同じ画面になる)
const embedded = document.getElementById('prerender-data')
if (embedded?.textContent) {
  try {
    hydrate(queryClient, JSON.parse(embedded.textContent) as DehydratedState)
  } catch {
    // 壊れていたら使わない(各画面が普通に取りに行く)
  }
}

/**
 * 今の URL に当たる遅延読み込みのルート(決勝・記録統計)を、ルーターを作る前に読み込んでおく。
 * 読み込み前のルートがあるとルーターは最初に何も描かないので、事前描画した HTML と食い違って hydrate が失敗する。
 * 読み込めなかったとき(デプロイ直後の古いファイル名など)は false。ルーターに任せ、RouteError が案内する
 */
async function preloadLazyRoutes(): Promise<boolean> {
  try {
    const matches = matchRoutes(routes, window.location, basename) ?? []
    await Promise.all(
      matches.map(async ({ route }) => {
        if (typeof route.lazy !== 'function') return
        const loaded = await route.lazy()
        Object.assign(route, { ...loaded, lazy: undefined })
      }),
    )
    return true
  } catch {
    return false
  }
}

async function start() {
  const container = document.getElementById('root')!
  const lazyReady = await preloadLazyRoutes()
  const router = createBrowserRouter(routes, { basename })
  const app = (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  )
  // HTML をそのまま引き継げる(hydrate)のは、事前描画したパスちょうどで、クエリが無いときだけ。
  // ?round= や ?q= は HTML と違う画面になり、404.html から開いたページ(コンビ詳細など)は HTML が空なので、
  // そのときは描き直す(createRoot は最初の描画で中身を置き換える)
  const canHydrate =
    lazyReady &&
    container.dataset.prerendered === window.location.pathname &&
    window.location.search === '' &&
    container.firstElementChild !== null
  if (canHydrate) hydrateRoot(container, app)
  else createRoot(container).render(app)
}

void start()
