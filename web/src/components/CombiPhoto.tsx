// 公式サイトの宣材写真。画像は複製せず公式サーバーへの直リンクで表示する。
// 公式側で削除済みの場合はonErrorで非表示にする(data-photo-scope祖先があればそこごと隠す)
const PHOTO_BASE = 'https://www.m-1gp.com/combi/'

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
  if (!photo) return null
  return (
    <img
      className={className}
      src={PHOTO_BASE + photo}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      onError={(e) => {
        const scope = e.currentTarget.closest<HTMLElement>('[data-photo-scope]')
        ;(scope ?? e.currentTarget).style.display = 'none'
      }}
    />
  )
}
