import { Navigate, type RouteObject } from 'react-router-dom'

import App from './App'
import LatestRedirect from './components/LatestRedirect'
import { NotFound } from './components/PageState'
import RouteError from './components/RouteError'
import CombiPage from './pages/CombiPage'
import HomePage from './pages/HomePage'
import YearPage from './pages/YearPage'

/**
 * ルート定義。main.tsx が createBrowserRouter(データルーター)に渡す。
 * データルーターにしているのは <ScrollRestoration /> を使うため(BrowserRouter では使えない)。
 *
 * 決勝と記録・統計は遅延読み込みにして、最初に読む JS から外す(記録・統計のグラフ部品 recharts が大きい)。
 * シーズン中にいちばん開かれる年度一覧・コンビ詳細・トップは最初の JS に含める。
 */
export const routes: RouteObject[] = [
  {
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'years', element: <LatestRedirect kind="years" /> },
      { path: 'years/:year', element: <YearPage /> },
      { path: 'combi/:id', element: <CombiPage /> },
      { path: 'finals', element: <LatestRedirect kind="finals" /> },
      {
        path: 'finals/:year',
        lazy: () => import('./pages/FinalsPage').then((m) => ({ Component: m.default })),
      },
      {
        path: 'stats/:section?',
        lazy: () => import('./pages/StatsPage').then((m) => ({ Component: m.default })),
      },
      // 旧「記録ランキング」は記録・統計のコンビタブへ統合した(共有済みのリンク用)
      { path: 'rankings', element: <Navigate to="/stats/combi" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]
