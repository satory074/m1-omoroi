import { Navigate, NavLink, Outlet, ScrollRestoration } from 'react-router-dom'

import CombiSearch from './components/CombiSearch'
import { useMeta } from './lib/api'

export function HomeRedirect() {
  const { data: meta, isError } = useMeta()
  if (isError) return <div className="error-box">データを読み込めませんでした。再読み込みしてください。</div>
  if (!meta) return <div className="loading">読み込み中…</div>
  return <Navigate to={`/years/${meta.latestYear}`} replace />
}

/** 全ページ共通の枠(ヘッダー・フッター)。中身は <Outlet /> に入る */
export default function App() {
  return (
    <div className="app">
      <header className="site-header">
        <div className="site-header-inner">
          <div className="site-header-top">
            <NavLink className="brand" to="/">
              <span className="brand-m1">M-1</span>
              <span className="brand-name">オモロイ</span>
              <span className="brand-sub">通過・敗退 全記録(非公式)</span>
            </NavLink>
            <CombiSearch />
          </div>
          <nav className="site-nav">
            <NavLink to="/" end>
              年度別 結果
            </NavLink>
            <NavLink to="/stats">記録・統計</NavLink>
            <NavLink to="/finals">決勝の得点</NavLink>
          </nav>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>
      {/* 戻る/進むでは離れたときの位置へ、新しいページへ進んだときは先頭へ。
          同じページ内でURLだけ変える操作(絞り込み・検索パネル)は preventScrollReset で除外している。
          年度一覧の内側スクロールはこれが扱わないので YearPage が自前で戻す(lib/scrollMemory.ts) */}
      <ScrollRestoration />

      <footer className="site-footer">
        <div className="site-footer-inner">
          <p>
            M-1オモロイは非公式のファンサイトです。出場・結果データは
            <a href="https://www.m-1gp.com/" target="_blank" rel="noreferrer">
              M-1グランプリ公式サイト
            </a>
            、決勝の得点はWikipediaを出典としています。注目度はコンビ名とメンバー名でYouTube検索した上位動画のうちコンビ名またはメンバー名を単語として含むものの再生数合計です。
          </p>
        </div>
      </footer>

      {/* サイト間ナビ: 画面下端に常駐する控えめな逆リンクバー（→ satory074.com/apps）。
          正準仕様: basecamp/docs/app-backlink.md */}
      <nav className="app-backlink-bar" aria-label="サイト間ナビゲーション">
        <a
          href="https://satory074.com/apps/"
          target="_blank"
          rel="noopener"
          aria-label="satory074 のほかのアプリ一覧を新しいタブで開く"
        >
          satory074 のほかのアプリ <span aria-hidden="true">↗</span>
        </a>
      </nav>
    </div>
  )
}
