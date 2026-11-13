import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link, type To } from 'react-router-dom'

export type ScrollNavItem =
  | {
      key: string
      to: To
      label: ReactNode
      current: boolean
      /** 同じページの中の切り替え(回戦など)は履歴を増やさず、先頭へも飛ばさない */
      inPage?: boolean
      /** 読み上げ用の名前(label が数字を含む場合など) */
      ariaLabel?: string
    }
  | { key: string; separator: ReactNode }

/**
 * 1段に並べるナビ(年・回戦・記録統計のテーマ)。収まらない分は横にスクロールし、端をぼかして
 * 「続きがある」ことを示す。複数段に折り返さない(NN/g・Chrome Modern Web Guidance の tabs: 折り返すと
 * 位置の記憶が壊れる)。選択中の項目は最初から見える位置へ寄せる。
 * ページを移るリンクなので ARIA のタブ(role=tab)にはせず、選択中は aria-current で示す。
 */
export default function ScrollNav({
  label,
  items,
  variant,
  className,
}: {
  label: string
  items: ScrollNavItem[]
  variant: 'pills' | 'tabs' | 'steps'
  className?: string
}) {
  const ref = useRef<HTMLUListElement>(null)

  // 選択中の項目を見える位置へ。scrollIntoView はページ全体も動かしてしまうので、この並びの中だけ動かす
  const currentKey = items.find((i) => 'current' in i && i.current)?.key
  useLayoutEffect(() => {
    const list = ref.current
    const el = list?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!list || !el) return
    const left = el.offsetLeft - list.offsetLeft
    if (left < list.scrollLeft || left + el.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = Math.max(0, left - (list.clientWidth - el.offsetWidth) / 2)
    }
  }, [currentKey])

  // 端のぼかしは、その方向にまだ続きがあるときだけ出す
  useEffect(() => {
    const list = ref.current
    if (!list) return
    const update = () => {
      list.dataset.start = String(list.scrollLeft > 2)
      list.dataset.end = String(list.scrollLeft + list.clientWidth < list.scrollWidth - 2)
    }
    update()
    list.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(list)
    return () => {
      list.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [items.length])

  return (
    <nav aria-label={label} className={`scroll-nav scroll-nav-${variant}${className ? ` ${className}` : ''}`}>
      <ul ref={ref}>
        {items.map((item) =>
          'separator' in item ? (
            <li key={item.key} className="scroll-nav-sep" aria-hidden="true">
              {item.separator}
            </li>
          ) : (
            <li key={item.key}>
              <Link
                to={item.to}
                aria-current={item.current ? 'page' : undefined}
                aria-label={item.ariaLabel}
                replace={item.inPage}
                preventScrollReset={item.inPage}
              >
                {item.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  )
}
