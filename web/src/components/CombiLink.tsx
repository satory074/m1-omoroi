import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { combiPath } from '../lib/paths'
import { useHydrated } from '../lib/useHydrated'

/**
 * コンビ詳細へのリンク。ID が無い組(公式DBに無いアーカイブの組など)は文字だけにする。
 * 以前は `id != null ? <Link> : name` を各部品で手書きしていた。
 *
 * コンビ詳細はまだ事前描画していない(直接開くと HTTP 404 で、404.html から画面を描く)。
 * 事前描画した HTML にそのリンクを入れると検索エンジンには 404 へのリンクに見えるので、
 * HTML(と hydrate の最初の描画)では文字だけにし、画面を引き継いだ直後にリンクにする。
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
  if (id == null || !hydrated) return <span className={className}>{children}</span>
  return (
    <Link className={className} to={combiPath(id)}>
      {children}
    </Link>
  )
}
