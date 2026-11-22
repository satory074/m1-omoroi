import { useEffect, useRef } from 'react'

// 公式サイトの宣材写真。画像は複製せず公式サーバーへの直リンクで表示する。
// 公式側で削除済みの場合はonErrorで非表示にする(data-photo-scope祖先があればそこごと隠す)
const PHOTO_BASE = 'https://www.m-1gp.com/combi/'

function hide(img: HTMLImageElement) {
  const scope = img.closest<HTMLElement>('[data-photo-scope]')
  ;(scope ?? img).style.display = 'none'
}

export default function CombiPhoto({
  photo,
  alt,
  className,
  eager = false,
}: {
  photo: string | null | undefined
  alt: string
  className: string
  /** Chromeはloading=lazyの読込失敗でerrorイベントを発火しないことがある。
   * onErrorでの非表示化が必須の箇所(詳細ページの枠+クレジット)はeagerにする */
  eager?: boolean
}) {
  const ref = useRef<HTMLImageElement>(null)
  // 事前描画した HTML の画像は、JS が動く前に読み込みに失敗していると onError が届かないので、
  // 画面を引き継いだ時点で壊れていれば隠す(読み込み前の遅延画像は complete が false なので触らない)
  useEffect(() => {
    const img = ref.current
    if (img && img.complete && img.naturalWidth === 0) hide(img)
  }, [photo])
  if (!photo) return null
  return (
    <img
      ref={ref}
      className={className}
      src={PHOTO_BASE + photo}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      onError={(e) => hide(e.currentTarget)}
    />
  )
}
