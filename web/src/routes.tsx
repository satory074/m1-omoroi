import { Navigate, type RouteObject } from 'react-router-dom'

import App, { HomeRedirect } from './App'
import CombiPage from './pages/CombiPage'
import FinalsPage from './pages/FinalsPage'
import StatsPage from './pages/StatsPage'
import YearPage from './pages/YearPage'

/**
 * ルート定義。main.tsx が createBrowserRouter(データルーター)に渡す。
 * データルーターにしているのは <ScrollRestoration /> を使うため(BrowserRouter では使えない)。
 */
export const routes: RouteObject[] = [
  {
    element: <App />,
    children: [
      { path: '/', element: <HomeRedirect /> },
      { path: '/years/:year', element: <YearPage /> },
      { path: '/combi/:id', element: <CombiPage /> },
      { path: '/stats/:section?', element: <StatsPage /> },
      // 旧「記録ランキング」は記録・統計のコンビタブへ統合した(共有済みのリンク用)
      { path: '/rankings', element: <Navigate to="/stats/combi" replace /> },
      { path: '/finals', element: <FinalsPage /> },
      { path: '/finals/:year', element: <FinalsPage /> },
      { path: '*', element: <div className="error-box">ページが見つかりません</div> },
    ],
  },
]
