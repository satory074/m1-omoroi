import { formationInfo } from '../lib/eligibility'

/**
 * 結成年数のチップ「9年目」。出場資格の最終年は「15年目・ラストイヤー」と文字で書く
 * (以前は ⚡ の絵文字だけで、意味はマウスを載せたときの title にしか無かった)。
 * 以前は同じ JSX が年度一覧・コンビ詳細・未エントリー表に3つコピーされていた。
 */
export default function FormedChip({ year, formed }: { year: number; formed: number | null | undefined }) {
  const fi = formationInfo(year, formed)
  if (!fi) return null
  return (
    <span className={`chip chip-formed${fi.isLastYear ? ' is-last' : ''}`}>
      {fi.years}年目{fi.isLastYear && '・ラストイヤー'}
    </span>
  )
}
