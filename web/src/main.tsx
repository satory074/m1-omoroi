import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import { routes } from './routes'
import './styles/main.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

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

const router = createBrowserRouter(routes, { basename })

// 開発時だけ、画面を移るたびにアクセシビリティの最低条件を監査して console に出す(src/dev/audit.ts)
if (import.meta.env.DEV) {
  void import('./dev/audit').then((m) => m.installAudit())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
