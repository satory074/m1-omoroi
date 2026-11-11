import { bestResultLabel } from '../lib/rounds'

/**
 * コンビ名の横に置く「最高 準決勝」等のバッジ。
 * 「最高」を付けるのは、年度一覧で隣に並ぶ「選択中の回戦の結果」と読み違えないため。
 * 色は段階で変える(index.css の .best-chip.lv-N)。
 */
export default function BestChip({ level, until }: { level: number | undefined; until?: number }) {
  const label = level ? bestResultLabel(level) : null
  if (!label) return null
  const scope = until != null ? `${until}年までの最高戦績` : '最高戦績'
  return (
    <span className={`best-chip lv-${level}`} title={`${scope}: ${label}`}>
      <span className="best-chip-prefix">最高</span>
      {label}
      <span className="sr-only">({scope})</span>
    </span>
  )
}
