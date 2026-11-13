import { useId, type ReactNode } from 'react'

/**
 * 記録・統計の表の枠。表に名前(caption)を付け、横にスクロールする枠をキーボードでも動かせるようにする
 * (role=region + aria-labelledby + tabIndex=0)。見た目は styles/components/history.css。
 * 名前は直前の見出しと同じことが多いので、画面からは隠して読み上げにだけ渡す。
 */
export default function HistoryTable({
  caption,
  className,
  children,
}: {
  caption: string
  className?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="history-wrap" role="region" aria-labelledby={id} tabIndex={0}>
      <table className={`history${className ? ` ${className}` : ''}`}>
        <caption id={id} className="sr-only">
          {caption}
        </caption>
        {children}
      </table>
    </div>
  )
}
