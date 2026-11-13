/**
 * 「どれか1つを選ぶ」切り替えボタン(絞り込みなど)。押されている状態を aria-pressed で伝える。
 * 以前は class="active" の見た目だけで、読み上げでは選択中が分からなかった。
 */
export default function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string; count?: number }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count != null && <span className="segmented-count">{o.count.toLocaleString('ja-JP')}</span>}
        </button>
      ))}
    </div>
  )
}
