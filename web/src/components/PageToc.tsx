import { useEffect, useState, type RefObject } from 'react'

interface Item {
  id: string
  text: string
  level: number
}

/**
 * ページ内の目次。中身の見出し(.section-title / .stats-group)を読み取って作るので、各タブの部品は
 * 目次のことを知らなくてよい。いま見ている節を強調する(scrollspy。aria-current も付ける)。
 * 広い画面は横に固定、狭い画面は上に折り畳みで置く(CSS)。見出しが少ないページには出さない。
 * NN/g: 長いページのページ内リンクは「このページの内容」の目次として置く / Sports-Reference の 2025 年の刷新も同じ形。
 */
export default function PageToc({ root, deps }: { root: RefObject<HTMLElement | null>; deps: unknown }) {
  const [items, setItems] = useState<Item[]>([])
  const [active, setActive] = useState<string | null>(null)

  // 見出しを集める(データが届いて描画されるのを待つため、中身の変化も見張る)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const collect = () => {
      const heads = [...el.querySelectorAll<HTMLElement>('h2.stats-group, h2.section-title, h3.section-title')]
      const next = heads.map((h, i) => {
        if (!h.id) h.id = `sec-${i + 1}`
        return { id: h.id, text: h.textContent?.trim() ?? '', level: h.tagName === 'H3' ? 3 : 2 }
      })
      setItems((prev) =>
        prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.text === next[i].text) ? prev : next,
      )
    }
    collect()
    const mo = new MutationObserver(collect)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [root, deps])

  // いま見ている節: 画面の上の方(固定ヘッダーの下)に入った最後の見出し
  useEffect(() => {
    if (items.length === 0) return
    const targets = items.map((i) => document.getElementById(i.id)).filter((x): x is HTMLElement => !!x)
    const io = new IntersectionObserver(
      () => {
        const line = 120
        let current: string | null = null
        for (const t of targets) if (t.getBoundingClientRect().top <= line) current = t.id
        setActive(current ?? targets[0]?.id ?? null)
      },
      { rootMargin: '0px 0px -60% 0px', threshold: [0, 1] },
    )
    targets.forEach((t) => io.observe(t))
    return () => io.disconnect()
  }, [items])

  if (items.length < 4) return null

  const list = (
    <ol className="toc-list">
      {items.map((i) => (
        <li key={i.id} className={i.level === 3 ? 'toc-sub' : undefined}>
          <a href={`#${i.id}`} aria-current={active === i.id ? 'true' : undefined}>
            {i.text}
          </a>
        </li>
      ))}
    </ol>
  )

  return (
    <nav className="toc" aria-label="このページの内容">
      {/* 広い画面: 常に開いた縦の目次 / 狭い画面: 折り畳み */}
      <div className="toc-wide">
        <p className="toc-title">このページの内容</p>
        {list}
      </div>
      <details className="toc-narrow">
        <summary>このページの内容({items.length})</summary>
        {list}
      </details>
    </nav>
  )
}
