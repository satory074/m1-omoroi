import { useId, type ReactNode } from 'react'

/**
 * 表を包む枠。狭い画面で横にスクロールする表を、キーボードでも動かせて(tabIndex=0)、
 * 読み上げで「何の表か」が分かるようにする(role=region + 表の caption を名前に)。
 * Chrome Modern Web Guidance の responsive-table / sortable-table に合わせている。
 * caption は見出しと重複するなら visuallyHidden で画面からは隠す。
 */
export default function TableRegion({
  caption,
  captionHidden = false,
  className,
  children,
}: {
  caption: ReactNode
  captionHidden?: boolean
  className?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="table-region" role="region" aria-labelledby={id} tabIndex={0}>
      <table className={`data-table${className ? ` ${className}` : ''}`}>
        <caption id={id} className={captionHidden ? 'sr-only' : undefined}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  )
}
