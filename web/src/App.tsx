import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router-dom'

import CombiSearch from './components/CombiSearch'

/**
 * ヘッダーは上端に貼り付け、下へスクロールしている間は隠して、上へ戻すとすぐ出す
 * (Chrome Modern Web Guidance: content-first-noise-reduction)。transform で動かすのでレイアウトは揺れない。
 * 中にフォーカスがある間(検索の入力中など)は CSS 側で隠さない。
 */
function useHideOnScroll(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let lastY = window.scrollY
    const onScroll = () => {
      // ゴム紐のような行き過ぎスクロールで向きが反転しないよう範囲に収める
      const max = document.documentElement.scrollHeight - window.innerHeight
      const y = Math.max(0, Math.min(window.scrollY, max))
      if (y === lastY) return
      // ヘッダーの高さぶん下がるまでは隠さない(先頭付近でちらつかないため)
      el.dataset.hidden = String(y > lastY && y > el.offsetHeight)
      lastY = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    // ヘッダーの高さを CSS に渡す(一覧の上に貼り付く帯を、ヘッダーが出ている間はその下に置くため)
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
    })
    ro.observe(el)
    return () => {
      window.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [ref])
}

const NAV = [
  { to: '/years', label: '年度別' },
  { to: '/finals', label: '決勝' },
  { to: '/stats', label: '記録・統計' },
] as const

/** 全ページ共通の枠(ヘッダー・フッター)。中身は <Outlet /> に入る */
export default function App() {
  const headerRef = useRef<HTMLElement>(null)
  useHideOnScroll(headerRef)

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        本文へ移動
      </a>
      {/* 戻る/進むでは離れたときの位置へ、新しいページへ進んだときは先頭へ。
          同じページ内でURLだけ変える操作(絞り込み・検索パネル)は preventScrollReset で除外している。
          <main> より前に置くこと: 同じ階層の副作用は前から順に走るので、年度一覧が行単位で位置を
          合わせ直す処理(YearPage)がこの後に走り、そちらが勝つ */}
      <ScrollRestoration />

      <header className="site-header" ref={headerRef}>
        <div className="site-header-inner">
          <Link className="brand" to="/" aria-label="M-1オモロイ トップページ">
            <span className="brand-m1" aria-hidden="true">
              M-1
            </span>
            <span className="brand-name" aria-hidden="true">
              オモロイ
            </span>
          </Link>
          <nav className="site-nav" aria-label="サイト内">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <CombiSearch />
        </div>
      </header>

      <main className="app-main" id="main" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <nav aria-label="フッター">
            <ul className="footer-links">
              <li>
                <Link to="/">トップ</Link>
              </li>
              {NAV.map((n) => (
                <li key={n.to}>
                  <Link to={n.to}>{n.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <p>
            M-1オモロイは非公式のファンサイトです。出場・結果データは
            <a href="https://www.m-1gp.com/" target="_blank" rel="noreferrer">
              M-1グランプリ公式サイト
            </a>
            、決勝の得点はWikipediaを出典としています。
          </p>
          <p>
            注目度は、コンビ名とメンバー名で YouTube を検索した上位動画のうち、コンビ名またはメンバー名を単語として含むものの再生数の合計です。
          </p>
        </div>
      </footer>

      {/* サイト間ナビ: 画面下端に常駐する控えめな逆リンクバー（→ satory074.com/apps）。
          正準仕様: basecamp/docs/app-backlink.md(このサイトだけ見た目を変えない) */}
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
