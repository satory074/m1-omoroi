import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAdvancers, useChampions } from '../lib/api'
import { competitionRanks, sliceWithTies } from '../lib/rank'
import { ROUND_LABEL } from '../lib/rounds'
import type { Champion, RoundKey } from '../lib/types'
import JapanGridMap, { type PrefNameGroup, type PrefRow } from './JapanGridMap'

const ROW_CAP = 30 // 長い表(結成年別/年齢別/回数)の表示件数上限(境界の同点はすべて表示)

type TierKey = 'champion' | RoundKey

/** 1コンビ×1到達イベントの行。優勝タブは各回(連覇は2行)、到達タブは初到達の1行 */
interface TierRow {
  id: number | null
  name: string
  formed: number | null
  year: number
  members: { name: string | null; from: string | null; age: number | null }[]
}

interface TierRanking {
  id: number | null
  name: string
  count: number
  /** 優勝タブのみ: 優勝年リスト */
  years?: number[]
}

interface Tier {
  key: TierKey
  label: string
  combiCount: number
  rows: TierRow[]
  ranking: TierRanking[]
  yearLabel: string
  spanLabel: string
  countLabel: string
}

function toChampionTier(champs: Champion[]): Tier {
  const rows: TierRow[] = champs.map((c) => ({
    id: c.id,
    name: c.name,
    formed: c.formed,
    year: c.year,
    members: c.members,
  }))
  const grouped = new Map<string | number, TierRanking>()
  for (const c of champs) {
    const key = c.id ?? c.name
    const entry = grouped.get(key) ?? { id: c.id, name: c.name, count: 0, years: [] }
    entry.count++
    entry.years!.push(c.year)
    grouped.set(key, entry)
  }
  const ranking = [...grouped.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'),
  )
  return {
    key: 'champion',
    label: '優勝',
    combiCount: ranking.length,
    rows,
    ranking,
    yearLabel: '優勝年',
    spanLabel: '結成→優勝',
    countLabel: '優勝回数',
  }
}

/** 選択タブの都道府県別マップ行を組み立てる。決勝タブのみ王者の👑バッジを重ねる */
function buildPrefRows(tier: Tier, champs: Champion[]): PrefRow[] {
  // 優勝タブ用: コンビ名(優勝年・優勝年) 形式のラベル
  const champYears = new Map<string, Map<string, number[]>>() // 県 → コンビ名 → 優勝年[]
  const champCount = new Map<string, number>()
  for (const c of champs) {
    for (const m of c.members) {
      if (!m.from) continue
      champCount.set(m.from, (champCount.get(m.from) ?? 0) + 1)
      const names = champYears.get(m.from) ?? new Map<string, number[]>()
      const years = names.get(c.name) ?? []
      if (!years.includes(c.year)) years.push(c.year)
      names.set(c.name, years)
      champYears.set(m.from, names)
    }
  }
  const champLabel = (pref: string): string[] =>
    [...(champYears.get(pref) ?? new Map<string, number[]>()).entries()].map(
      ([name, years]) => `${name}(${years.sort((a, b) => a - b).join('・')})`,
    )

  const count = new Map<string, number>()
  const namesByPref = new Map<string, string[]>()
  for (const r of tier.rows) {
    for (const m of r.members) {
      if (!m.from) continue
      count.set(m.from, (count.get(m.from) ?? 0) + 1)
      const names = namesByPref.get(m.from) ?? []
      if (!names.includes(r.name)) names.push(r.name)
      namesByPref.set(m.from, names)
    }
  }

  return [...count.keys()]
    .map((pref) => {
      let names = namesByPref.get(pref) ?? []
      let badge = 0
      let groups: PrefNameGroup[] | undefined
      if (tier.key === 'champion') {
        names = champLabel(pref)
      } else if (tier.key === 'final') {
        // 王者は👑行に出すので決勝到達の行からは除いて重複を避ける
        const champSet = new Set([...(champYears.get(pref) ?? new Map()).keys()])
        badge = champCount.get(pref) ?? 0
        groups = [
          { label: '👑 王者:', names: champLabel(pref) },
          { label: '決勝到達:', names: names.filter((n) => !champSet.has(n)) },
        ]
      }
      return { pref, count: count.get(pref) ?? 0, badge, names, groups }
    })
    .sort((a, b) => b.count - a.count || a.pref.localeCompare(b.pref, 'ja'))
}

/** 「歴代王者の記録」と「準々決勝以上の記録」を1つに統合した記録セクション。
 *  優勝(champions.json)/決勝/準決勝/準々決勝(advancers.json)のタブ切替で
 *  都道府県別マップ・結成年別・年齢別・回数ランキングを表示する。
 *  どちらのデータも無い環境では何も描画しない。 */
export default function RecordsExplorer() {
  const champions = useChampions()
  const { data: advancers } = useAdvancers()
  const [tierKey, setTierKey] = useState<TierKey>('champion')

  const champs = champions.data?.champions ?? []
  const tiers: Tier[] = []
  if (champs.length > 0) tiers.push(toChampionTier(champs))
  for (const t of advancers?.tiers ?? []) {
    const label = ROUND_LABEL[t.round]
    tiers.push({
      key: t.round,
      label,
      combiCount: t.combis.length,
      rows: t.combis.map((c) => ({
        id: c.id,
        name: c.name,
        formed: c.formed,
        year: c.firstYear,
        members: c.members,
      })),
      ranking: t.combis
        .map((c) => ({ id: c.id, name: c.name, count: c.reachCount }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja')),
      yearLabel: `${label}初到達`,
      spanLabel: '結成→到達',
      countLabel: `${label}到達回数`,
    })
  }
  if (tiers.length === 0) return null

  const tier = tiers.find((t) => t.key === tierKey) ?? tiers[0]
  const isChampion = tier.key === 'champion'

  // 都道府県別
  const prefRows = buildPrefRows(tier, champs)
  const prefTotal = prefRows.reduce((sum, r) => sum + r.count, 0)

  // 結成年別({spanLabel}が早い順)。結成年が判明する行のみ
  const formedAll = tier.rows
    .filter((r) => r.formed != null)
    .map((r) => ({ ...r, formed: r.formed as number, span: r.year - (r.formed as number) }))
    .sort((a, b) => a.span - b.span || a.year - b.year)
  const formedRows = sliceWithTies(formedAll, ROW_CAP, (r) => r.span)

  // 年齢別(若い順)。生年が判明するメンバーのみ
  const ageAll = tier.rows
    .flatMap((r) =>
      r.members.map((m) => ({ id: r.id, name: m.name ?? '', combi: r.name, year: r.year, age: m.age })),
    )
    .filter((r): r is { id: number | null; name: string; combi: string; year: number; age: number } => r.age != null)
    .sort((a, b) => a.age - b.age || a.year - b.year)
  const minAge = ageAll.length ? ageAll[0].age : null
  const maxAge = ageAll.length ? ageAll[ageAll.length - 1].age : null
  const ageRows = sliceWithTies(ageAll, ROW_CAP, (r) => r.age)

  // 回数ランキング(多い順)
  const rankingRows = sliceWithTies(tier.ranking, ROW_CAP, (r) => r.count)
  const rankingRanks = competitionRanks(rankingRows, (r) => r.count)

  const combiCell = (id: number | null, name: string) =>
    id != null ? <Link to={`/combi/${id}`}>{name}</Link> : name

  return (
    <>
      <h1 className="page-title" style={{ marginTop: 40 }}>
        記録(優勝・準々決勝以上)
      </h1>
      <p className="page-lede">
        歴代王者(2001〜2025年の全21回)と、準々決勝以上に到達したコンビを最高到達ラウンド(決勝／準決勝／準々決勝)別に集計。2001〜2010は出身地・生年が揃わない組が多く、集計は判明分のみです。
      </p>

      <div style={{ margin: '4px 0 20px' }}>
        <div className="seg" role="group" aria-label="集計対象の切り替え">
          {tiers.map((t) => (
            <button key={t.key} className={t.key === tier.key ? 'active' : ''} onClick={() => setTierKey(t.key)}>
              {t.label}（{t.combiCount}）
            </button>
          ))}
        </div>
      </div>
      {isChampion && (
        <p className="section-note">王者は決勝タブにも含まれます(決勝タブは最高到達が決勝の全コンビ)。</p>
      )}

      <h2 className="section-title">都道府県別({tier.label})</h2>
      <p className="section-note">
        {tier.label === '優勝' ? '王者' : `${tier.label}到達コンビ`}
        の出身地。マスの数字は延べ人数。県のマスをタップすると該当コンビを表示します。
        {tier.key === 'final' && ' 👑は王者の輩出数(延べ)。'}
      </p>
      <JapanGridMap
        rows={prefRows}
        unit="人"
        nameLabel={isChampion ? '該当王者' : '該当コンビ'}
        badgeLabel="王者"
      />
      <p className="legend">
        出身地の判明する延べ {prefTotal} 人を集計(同郷コンビは同じ県に2人分、
        {isChampion ? '連覇は各回を計上、' : ''}出身地不明は除外)
      </p>

      <h2 className="section-title">
        結成年別({tier.label}・{tier.spanLabel}が早い順)
      </h2>
      <p className="section-note">
        結成から{isChampion ? '優勝' : `${tier.label}初到達`}までの年数が短い順に表示。同点は全組表示
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>コンビ</th>
              <th>結成年</th>
              <th>{tier.yearLabel}</th>
              <th>{tier.spanLabel}</th>
            </tr>
          </thead>
          <tbody>
            {formedRows.map((r) => (
              <tr key={`${r.id ?? r.name}-${r.year}`}>
                <td className="year" style={{ fontSize: 14 }}>
                  {combiCell(r.id, r.name)}
                </td>
                <td className="no">{r.formed}</td>
                <td className="no">{r.year}</td>
                <td className="no total">{r.span}年</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legend">
        「{tier.spanLabel}」は{tier.yearLabel}−結成年。
        {isChampion ? '連覇は各回を掲載。' : ''}結成年の判明する {formedAll.length} 行のうち上位 {formedRows.length}{' '}
        行を表示
      </p>

      <h2 className="section-title">
        {isChampion ? '優勝時' : `${tier.label}初到達時`}の年齢(若い順)
      </h2>
      {minAge != null && maxAge != null && (
        <p className="section-note">
          最年少 {ageAll[0].age}歳({ageAll[0].name}・{ageAll[0].combi}／{ageAll[0].year}年) ／ 最年長{' '}
          {ageAll[ageAll.length - 1].age}歳({ageAll[ageAll.length - 1].name}・{ageAll[ageAll.length - 1].combi}／
          {ageAll[ageAll.length - 1].year}年)
        </p>
      )}
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>メンバー</th>
              <th>コンビ</th>
              <th>{tier.yearLabel}</th>
              <th>年齢</th>
            </tr>
          </thead>
          <tbody>
            {ageRows.map((r) => {
              const hot = r.age === minAge || r.age === maxAge
              return (
                <tr key={`${r.id ?? r.combi}-${r.name}-${r.year}`}>
                  <td className="year" style={{ fontSize: 14 }}>
                    {r.name}
                  </td>
                  <td>{combiCell(r.id, r.combi)}</td>
                  <td className="no">{r.year}</td>
                  <td className={hot ? 'cell champion' : 'no'}>{r.age}歳</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="legend">
        年齢は{isChampion ? '決勝(12月)時点の満年齢' : '初到達年時点の満年齢の概算'}。生年の判明する延べ{' '}
        {ageAll.length} 人のうち若い順に上位 {ageRows.length} 人を表示(同点は全員表示)
      </p>

      <h2 className="section-title">{tier.countLabel}ランキング</h2>
      <p className="section-note">
        {isChampion
          ? '優勝した回数(2001年からの全期間)。同点は全組表示'
          : `${tier.label}に到達した年数(2001年からの全期間)。最高到達が${tier.label}の組のみ＝さらに上へ進んだ組は上位ラウンドで集計。同点は全組表示`}
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>順位</th>
              <th>コンビ</th>
              <th>{tier.countLabel}</th>
              {isChampion && <th>優勝年</th>}
            </tr>
          </thead>
          <tbody>
            {rankingRows.map((r, i) => (
              <tr key={r.id ?? r.name}>
                <td className="no">{rankingRanks[i]}</td>
                <td className="year" style={{ fontSize: 14 }}>
                  {combiCell(r.id, r.name)}
                </td>
                <td className="no total">{r.count}回</td>
                {isChampion && <td className="no">{r.years?.join('・')}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legend">
        {isChampion ? `歴代王者 全${tier.combiCount}組` : `最高到達が${tier.label}のコンビ 全${tier.combiCount}組`}
        のうち上位 {rankingRows.length} 組を表示
      </p>
    </>
  )
}
