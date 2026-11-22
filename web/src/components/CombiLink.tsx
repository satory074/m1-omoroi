import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { combiPath, hasCombiPage } from '../lib/paths'
import { useHydrated } from '../lib/useHydrated'

/**
 * コンビ詳細へのリンク。ID が無い組(公式DBに無いアーカイブの組など)は文字だけにする。
 * 以前は `id != null ? <Link> : name` を各部品で手書きしていた。
 *
 * コンビ詳細を事前描画しているのは最高到達が準々決勝以上の組だけ(lib/paths.ts の hasCombiPage)。
 * その組は事前描画した HTML でも本当のリンク(/combi/{id}/)にする。それ以外の組はページが無く、直接開くと
 * HTTP 404(404.html から画面を描く)なので、HTML(と hydrate の最初の描画)では文字だけにし、
 * 画面を引き継いだ直後にリンクにする(検索エンジンに 404 へのリンクを見せないため)。
 */
export default function CombiLink({
  id,
  children,
  className,
}: {
  id: number | null | undefined
  children: ReactNode
  className?: string
}) {
  const hydrated = useHydrated()
  if (id == null || (!hydrated && !hasCombiPage(id))) return <span className={className}>{children}</span>
  return (
    <Link className={className} to={combiPath(id)}>
      {children}
    </Link>
  )
}
