import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAdvancers, useChampions, usePopularity } from '../lib/api'
import { formationInfo, isEligible, m1LimitYears } from '../lib/eligibility'
import { ROUND_LABEL, formatHits } from '../lib/rounds'
import type { RoundKey } from '../lib/types'

const SHOWN = 20 // 注目度上位この件数までを最初に見せ、残りは details で展開
const TIERS: RoundKey[] = ['final', 'semifinal', 'quarterfinal']

/** 未エントリーの内訳。解散データが無いので断定せず、前後の出場から機械的に分ける */
type Kind = 'skip' | 'gone' | 'predebut'

interface Row {
  id: number
  name: string
  tier: RoundKey
  span: number
  isLastYear: boolean
  kind: Kind
  prev: number | null
  next: number | null
  champYears: number[]
  hits: number | null
}

const KIND_LABEL: Record<Kind, string> = {
  skip: '見送り',
  gone: '以降エントリーなし',
  predebut: '初出場前',
}

/**
 * その年「出場資格(結成N年以内)があるのにエントリー記録が無い」準々決勝以上経験組の一覧。
 * 母集団は advancers.json の3tier(相互排他)の和集合578組、エントリー有無は
 * 年度JSONのidで判定し、前後の出場年(entryYears)で見送り/以降なし/初出場前に分ける。
 */
export default function AbsentAdvancers({
  year,
  enteredIds,
  isArchive,
}: {
  year: number
  enteredIds: Set<number>
  isArchive: boolean
}) {
  const { data: advancers } = useAdvancers()
  const { data: champions } = useChampions()
  const { data: pop } = usePopularity()
  const [tier, setTier] = useState<RoundKey | 'all'>('all')

  const rows = useMemo<Row[]>(() => {
    if (!advancers) return []
    // その年より前に優勝している組(優勝後も資格がある間は再エントリーできるので除外はしない)
    const champs = new Map<number, number[]>()
    for (const c of champions?.champions ?? []) {
      if (c.id == null || c.year >= year) continue
      champs.set(c.id, [...(champs.get(c.id) ?? []), c.year])
    }
    const out: Row[] = []
    for (const t of advancers.tiers) {
      for (const c of t.combis) {
        if (!isEligible(year, c.formed) || enteredIds.has(c.id)) continue
        const prev = c.entryYears.filter((y) => y < year).pop() ?? null
        const next = c.entryYears.find((y) => y > year) ?? null
        const fi = formationInfo(year, c.formed)!
        out.push({
          id: c.id,
          name: c.name,
          tier: t.round,
          span: fi.years,
          isLastYear: fi.isLastYear,
          kind: prev == null ? 'predebut' : next == null ? 'gone' : 'skip',
          prev,
          next,
          champYears: champs.get(c.id) ?? [],
          hits: pop?.hits[String(c.id)]?.n ?? null,
        })
      }
    }
    // 年度ページの既定ソートと同じく注目度順(データが無い組は五十音順で後ろ)
    return out.sort(
      (a, b) =>
        (b.hits ?? -1) - (a.hits ?? -1) || a.name.localeCompare(b.name, 'ja'),
    )
  }, [advancers, champions, pop, year, enteredIds])

  if (rows.length === 0) return null

  const shownRows = tier === 'all' ? rows : rows.filter((r) => r.tier === tier)
  const head = shownRows.slice(0, SHOWN)
  const rest = shownRows.slice(SHOWN)

  const table = (list: Row[]) => (
    <div className="history-wrap">
      <table className="history">
        <thead>
          <tr>
            <th>コンビ</th>
            <th>最高到達</th>
            <th>直近の出場</th>
            <th>状況</th>
            <th>注目度</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td>
                <span className="absent-name">
                  {r.champYears.length > 0 && (
                    <span title={`${r.champYears.join('・')}年優勝`}>👑</span>
                  )}
                  <Link to={`/combi/${r.id}`}>{r.name}</Link>
                  <span
                    className={`formed-chip${r.isLastYear ? ' lastyear' : ''}`}
                    title={r.isLastYear ? 'ラストイヤー(出場資格の最終年)' : undefined}
                  >
                    {r.isLastYear && '⚡'}
                    {r.span}年目
                  </span>
                </span>
              </td>
              <td>{ROUND_LABEL[r.tier]}</td>
              <td className="no">{r.prev != null ? r.prev : '—'}</td>
              <td>
                <span className={`kind-chip ${r.kind}`}>{KIND_LABEL[r.kind]}</span>
                {r.kind === 'skip' && <span className="absent-detail">{r.next}年に復帰</span>}
                {r.kind === 'predebut' && r.next != null && (
                  <span className="absent-detail">初出場は{r.next}年</span>
                )}
              </td>
              <td className="no">{r.hits != null ? formatHits(r.hits) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <section className="absent-section">
      <h2 className="section-title">資格がありながら未エントリー({rows.length}組)</h2>
      <p className="section-note">
        準々決勝以上に進んだ経験のあるコンビのうち、{year}年の出場資格(結成
        {m1LimitYears(year)}年以内)を満たしながらエントリー記録が無い組。結成年が不明な組は対象外。
        「見送り」は前後の年に出場していてこの年だけ出ていない組。
      </p>
      <p className="section-note">
        解散・活動休止のデータは持っていないため、「以降エントリーなし」には解散した組も含まれます。
        優勝経験のある組(👑)も資格がある間は再エントリーできるため一覧に残しています。
      </p>
      {isArchive && (
        <p className="section-note">
          2001〜2010は公式アーカイブ由来で1回戦敗退の記録が残らないため、実際には出場していた組が含まれる可能性があります。
        </p>
      )}

      <div className="toolbar">
        <div className="seg" role="group" aria-label="最高到達ラウンドの絞り込み">
          {([['all', 'すべて'], ...TIERS.map((t) => [t, ROUND_LABEL[t]] as const)] as const).map(
            ([key, label]) => {
              const n = key === 'all' ? rows.length : rows.filter((r) => r.tier === key).length
              return (
                <button
                  key={key}
                  className={tier === key ? 'active' : ''}
                  onClick={() => setTier(key as RoundKey | 'all')}
                >
                  {label}({n})
                </button>
              )
            },
          )}
        </div>
      </div>

      {shownRows.length === 0 ? (
        <div className="board-empty">該当するコンビがいません</div>
      ) : (
        <>
          {table(head)}
          {rest.length > 0 && (
            <details className="streak-details absent-rest">
              <summary>残り{rest.length}組を表示</summary>
              {table(rest)}
            </details>
          )}
        </>
      )}
    </section>
  )
}
