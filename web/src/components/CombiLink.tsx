import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * コンビ詳細へのリンク。ID が無い組(公式DBに無いアーカイブの組など)は文字だけにする。
 * 以前は `id != null ? <Link> : name` を各部品で手書きしていた。
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
  if (id == null) return <span className={className}>{children}</span>
  return (
    <Link className={className} to={`/combi/${id}`}>
      {children}
    </Link>
  )
}
