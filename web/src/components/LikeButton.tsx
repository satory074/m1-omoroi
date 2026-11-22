import { toggleLike, useLikes } from '../lib/likes'

/** ハート。塗り=いいね済み・白抜き=まだ(色だけに頼らず形でも状態を示す。WCAG 1.4.1) */
export function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M12 20.3 4.6 13.2a4.9 4.9 0 0 1 0-7 4.8 4.8 0 0 1 6.9 0l.5.5.5-.5a4.8 4.8 0 0 1 6.9 0 4.9 4.9 0 0 1 0 7Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 1本のネタへのいいね。押すたびに切り替わる(確認は出さない。もう一度押せば取り消し)。
 * 読み上げは「〇〇(2026年 3回戦)をいいね」+ 押されているか(aria-pressed)。名前は状態で変えない。
 * 行全体がリンクになる狭い画面でも押せるよう、CSS で行のリンクより前に出している(.like-btn)。
 */
export default function LikeButton({ likeKey, label }: { likeKey: string; label: string }) {
  const likes = useLikes()
  const on = likes.has(likeKey)
  return (
    <button
      type="button"
      className={`like-btn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      onClick={() => toggleLike(likeKey)}
    >
      <HeartIcon filled={on} />
    </button>
  )
}
