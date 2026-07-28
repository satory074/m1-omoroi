import { Navigate, NavLink, Route, Routes } from 'react-router-dom'

import { useMeta } from './lib/api'
import CombiPage from './pages/CombiPage'
import FinalsPage from './pages/FinalsPage'
import RankingsPage from './pages/RankingsPage'
import StatsPage from './pages/StatsPage'
import YearPage from './pages/YearPage'

function HomeRedirect() {
  const { data: meta, isError } = useMeta()
  if (isError) return <div className="error-box">データを読み込めませんでした。再読み込みしてください。</div>
  if (!meta) return <div className="loading">読み込み中…</div>
  return <Navigate to={`/years/${meta.latestYear}`} replace />
}

export default function App() {
  return (
    <div className="app">
      <header className="site-header">
        <div className="site-header-inner">
          <NavLink className="brand" to="/">
            <span className="brand-m1">M-1</span>
            <span className="brand-name">オモロイ</span>
            <span className="brand-sub">通過・敗退 全記録(非公式)</span>
          </NavLink>
          <nav className="site-nav">
            <NavLink to="/" end>
              年度別 結果
            </NavLink>
            <NavLink to="/rankings">記録ランキング</NavLink>
            <NavLink to="/stats">統計</NavLink>
            <NavLink to="/finals">決勝の得点</NavLink>
          </nav>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/years/:year" element={<YearPage />} />
          <Route path="/combi/:id" element={<CombiPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/finals" element={<FinalsPage />} />
          <Route path="/finals/:year" element={<FinalsPage />} />
          <Route path="*" element={<div className="error-box">ページが見つかりません</div>} />
        </Routes>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <p>
            M-1オモロイは非公式のファンサイトです。出場・結果データは
            <a href="https://www.m-1gp.com/" target="_blank" rel="noreferrer">
              M-1グランプリ公式サイト
            </a>
            、決勝の得点はWikipediaを出典としています。検索ヒット件数はGoogle検索の参考値です。
          </p>
        </div>
      </footer>
    </div>
  )
}
