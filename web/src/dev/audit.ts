// 開発時だけ動く画面の監査(本番ビルドには含まれない。main.tsx が import.meta.env.DEV のときだけ読む)。
// テストの件数を増やす代わりに「壊れたら困る条件」を画面を移るたびに確かめ、破っている所を console.warn に出す。
//   1. 名前の無い表(<caption> も、表を包む role="region" の aria-labelledby/aria-label も無い)
//   2. scope の無い <th>
//   3. 24px 未満の押せる要素(WCAG 2.2 の 2.5.8。文中のリンクは対象外)
//   4. title 属性だけの説明(スマホでは見られない)
//   5. 見出しの段飛ばし・h1 が1つでない
// 対象はページの中身(#root)。警告ゼロが各段階の完了条件。

type Finding = { rule: string; el: Element; note?: string }

const MIN_TARGET = 24

function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : ''
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
  return `<${el.tagName.toLowerCase()}${id}${cls}> ${text}`
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return false
  // 閉じた <details> の中身は Chrome では寸法を持ったまま隠れているので、checkVisibility で除く
  if ('checkVisibility' in el && !el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: false })) {
    return false
  }
  const s = getComputedStyle(el)
  return s.visibility !== 'hidden' && s.display !== 'none'
}

function tableNamed(table: HTMLTableElement): boolean {
  if (table.caption && table.caption.textContent?.trim()) return true
  if (table.getAttribute('aria-label') || table.getAttribute('aria-labelledby')) return true
  const region = table.closest('[role="region"]')
  return !!region && !!(region.getAttribute('aria-label') || region.getAttribute('aria-labelledby'))
}

// 文中のリンク(段落・表のセル・リスト項目の中で、周りに文字がある inline のリンク)は 2.5.8 の例外
function isInlineTextLink(el: Element): boolean {
  if (el.tagName !== 'A') return false
  if (getComputedStyle(el).display !== 'inline') return false
  const parentText = (el.parentElement?.textContent ?? '').trim()
  const ownText = (el.textContent ?? '').trim()
  return parentText.length > ownText.length
}

export function audit(root: ParentNode = document.getElementById('root') ?? document): Finding[] {
  const found: Finding[] = []

  for (const t of root.querySelectorAll('table')) {
    if (!tableNamed(t)) found.push({ rule: '名前の無い表', el: t })
  }
  for (const th of root.querySelectorAll('th')) {
    if (!th.hasAttribute('scope')) found.push({ rule: 'scope の無い th', el: th })
  }

  const interactive = root.querySelectorAll(
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])',
  )
  // WCAG 2.5.8 の「間隔」の例外: 小さくても、中心から直径24pxの円(ここでは24px四方で近似)が
  // ほかの押せる要素に重ならなければ合格。並んだリンクの縦リストなどを誤検出しないため。
  const targets = [...interactive].filter((el) => isVisible(el) && !isInlineTextLink(el))
  const rects = targets.map((el) => el.getBoundingClientRect())
  targets.forEach((el, i) => {
    const r = rects[i]
    if (r.width >= MIN_TARGET && r.height >= MIN_TARGET) return
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const h = MIN_TARGET / 2
    const crowded = rects.some((o, j) => {
      if (j === i || targets[j].contains(el) || el.contains(targets[j])) return false
      const otherSmall = o.width < MIN_TARGET || o.height < MIN_TARGET
      if (otherSmall) {
        // 小さい要素どうしは、互いの24pxの円が重なる(中心間が24px未満)と不合格
        const ox = o.left + o.width / 2
        const oy = o.top + o.height / 2
        return Math.hypot(ox - cx, oy - cy) < MIN_TARGET
      }
      return o.left < cx + h && o.right > cx - h && o.top < cy + h && o.bottom > cy - h
    })
    if (crowded) {
      found.push({ rule: '24px 未満で隣と近すぎる押せる要素', el, note: `${Math.round(r.width)}×${Math.round(r.height)}` })
    }
  })

  for (const el of root.querySelectorAll('[title]')) {
    found.push({ rule: 'title だけの説明', el, note: el.getAttribute('title') ?? '' })
  }

  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(isVisible)
  const h1s = headings.filter((h) => h.tagName === 'H1')
  if (h1s.length !== 1) {
    found.push({ rule: 'h1 が1つでない', el: h1s[0] ?? document.body, note: `${h1s.length}個` })
  }
  let prev = 0
  for (const h of headings) {
    const level = Number(h.tagName[1])
    if (prev && level > prev + 1) found.push({ rule: '見出しの段飛ばし', el: h, note: `h${prev}→h${level}` })
    prev = level
  }

  return found
}

let lastSummary = ''

function report(force = false) {
  const found = audit()
  const path = location.pathname + location.search
  // スクロールで仮想リストの行が入れ替わるたびに同じ結果を出さないよう、前回と同じなら黙る
  const summary = path + '|' + found.map((f) => f.rule + describe(f.el)).join('|')
  if (!force && summary === lastSummary) return
  lastSummary = summary
  if (found.length === 0) {
    console.info(`[audit] ${path}: 警告なし`)
    return
  }
  const byRule = new Map<string, Finding[]>()
  for (const f of found) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f])
  console.groupCollapsed(`[audit] ${path}: ${found.length}件`)
  for (const [rule, list] of byRule) {
    console.warn(`${rule}: ${list.length}件`)
    for (const f of list.slice(0, 8)) console.warn('  ', describe(f.el), f.note ?? '', f.el)
    if (list.length > 8) console.warn(`   ほか ${list.length - 8}件`)
  }
  console.groupEnd()
}

// 画面を移ってデータが描画し終わるまで待ってから監査する(DOM の変化が 800ms 止まったら実行)
export function installAudit() {
  let timer: number | undefined
  const schedule = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => report(), 800)
  }
  const target = document.getElementById('root')
  if (!target) return
  new MutationObserver(schedule).observe(target, { childList: true, subtree: true })
  schedule()
  // 手動でも呼べるようにする(コンソールで __audit())
  ;(window as unknown as { __audit: () => Finding[] }).__audit = () => {
    report(true)
    return audit()
  }
}
