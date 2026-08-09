import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useAdvancers, useChampions, useStats } from '../lib/api'
import { ROUND_LABEL, ROUND_ORDER } from '../lib/rounds'
import type { RoundKey, YearStats } from '../lib/types'

// datavizスキルで検証済みのカテゴリカルパレット(赤=1回戦, 金=2回戦, 青=3回戦)
const SERIES = [
  { key: 'first', label: '1回戦', color: '#c8102e' },
  { key: 'second', label: '2回戦', color: '#d99f23' },
  { key: 'third', label: '3回戦', color: '#3468c0' },
] as const

const MUTED = '#8a8378'
const GRID = '#e2dcd0'

function passRate(y: YearStats, rk: (typeof SERIES)[number]['key']): number | null {
  const r = y.byRound[rk]
  // 合格者しか記録が残っていない年(通過=出場)は通過率を計算できない
  if (!r || r.appeared <= r.passed) return null
  return Math.round((r.passed / r.appeared) * 1000) / 10
}

const tooltipStyle = {
  background: '#fff',
  border: `1px solid ${GRID}`,
  borderRadius: 4,
  fontSize: 12.5,
  fontFamily: 'inherit',
}

export default function StatsPage() {
  const { data, isLoading, isError } = useStats()
  const champions = useChampions()
  if (isError) return <div className="error-box">統計を読み込めませんでした。</div>
  if (isLoading || !data) return <div className="loading">読み込み中…</div>

  const byYear = [...data.byYear].sort((a, b) => a.year - b.year)
  const entriesData = byYear.map((y) => ({ year: String(y.year), entries: y.entries }))
  const rateData = byYear.map((y) => ({
    year: String(y.year),
    first: passRate(y, 'first'),
    second: passRate(y, 'second'),
    third: passRate(y, 'third'),
  }))

  const lastIndex = (key: (typeof SERIES)[number]['key']) => {
    for (let i = rateData.length - 1; i >= 0; i--) if (rateData[i][key] != null) return i
    return -1
  }
  const endLabel =
    (name: string, color: string, targetIndex: number) =>
    (props: { x?: number | string; y?: number | string; index?: number }) => {
      if (props.index !== targetIndex || props.x == null || props.y == null) return <g />
      return (
        <text x={Number(props.x) + 8} y={Number(props.y) + 4} fill={color} fontSize={12} fontWeight={700}>
          {name}
        </text>
      )
    }

  // ---- 歴代王者(優勝者)の集計。champions.json が無い環境ではこのブロックは描画しない ----
  const champs = champions.data?.champions ?? []
  const champMemberTotal = champs.reduce((sum, c) => sum + c.members.length, 0)

  // A. 都道府県別(メンバー単位。同郷コンビは同じ県に2人分、連覇は各回を計上)
  const prefMap = new Map<string, { count: number; names: string[] }>()
  for (const c of champs) {
    for (const m of c.members) {
      if (!m.from) continue
      const e = prefMap.get(m.from) ?? { count: 0, names: [] }
      e.count += 1
      if (!e.names.includes(c.name)) e.names.push(c.name)
      prefMap.set(m.from, e)
    }
  }
  const prefRows = [...prefMap.entries()]
    .map(([pref, e]) => ({ pref, count: e.count, names: e.names }))
    .sort((a, b) => b.count - a.count || a.pref.localeCompare(b.pref, 'ja'))

  // B. 結成年別(新しい順)。1タイトル=1行
  const formedRows = champs
    .filter((c) => c.formed != null)
    .map((c) => ({ name: c.name, formed: c.formed as number, year: c.year, span: c.year - (c.formed as number) }))
    .sort((a, b) => b.formed - a.formed || b.year - a.year)

  // C. 優勝時の年齢(メンバー単位。若い順)
  const ageRows = champs
    .flatMap((c) => c.members.map((m) => ({ name: m.name ?? '', combi: c.name, year: c.year, age: m.age })))
    .filter((r): r is { name: string; combi: string; year: number; age: number } => r.age != null)
    .sort((a, b) => a.age - b.age || a.year - b.year)
  const minAge = ageRows.length ? ageRows[0].age : null
  const maxAge = ageRows.length ? ageRows[ageRows.length - 1].age : null

  return (
    <>
      <h1 className="page-title">統計</h1>
      <p className="page-lede">
        収録データからの集計。2001〜2010年は公式アーカイブに残っている範囲のみです。
      </p>

      <section className="chart-card">
        <h2 className="section-title">エントリー数の推移</h2>
        <p className="section-note">2011〜2014年は大会休止。2001〜2010年は記録に残るコンビ数</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={entriesData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 11, fill: MUTED }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              interval={2}
            />
            <YAxis
              tick={{ fontSize: 11, fill: MUTED }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => v.toLocaleString('ja-JP')}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => [`${Number(v).toLocaleString('ja-JP')}組`, 'エントリー']}
              cursor={{ fill: 'rgba(34, 30, 26, 0.06)' }}
            />
            <Bar dataKey="entries" fill="#c8102e" radius={[3, 3, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="chart-card">
        <h2 className="section-title">回戦別 通過率の推移</h2>
        <div className="chart-legend">
          {SERIES.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={rateData} margin={{ top: 8, right: 64, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 11, fill: MUTED }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              interval={2}
            />
            <YAxis
              tick={{ fontSize: 11, fill: MUTED }}
              tickLine={false}
              axisLine={false}
              width={40}
              unit="%"
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) => [`${v}%`, SERIES.find((s) => s.key === name)?.label ?? name]}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
                label={endLabel(s.label, s.color, lastIndex(s.key))}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p className="legend">通過率 = 通過数 ÷ 出場数。合格者しか記録がない年は除外</p>
      </section>

      <h2 className="section-title">年度別の出場・通過数</h2>
      <div className="history-wrap">
        <table className="history stats-table">
          <thead>
            <tr>
              <th>年</th>
              <th>エントリー</th>
              {ROUND_ORDER.map((rk) => (
                <th key={rk}>{ROUND_LABEL[rk]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...byYear].reverse().map((y) => (
              <tr key={y.year}>
                <td className="year">{y.year}</td>
                <td className="no">{y.entries.toLocaleString('ja-JP')}</td>
                {ROUND_ORDER.map((rk) => {
                  const r = y.byRound[rk]
                  return (
                    <td key={rk} className="no">
                      {r
                        ? `${r.passed.toLocaleString('ja-JP')}/${r.appeared.toLocaleString('ja-JP')}`
                        : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legend">各セルは「通過数/出場数」</p>

      {champs.length > 0 && (
        <>
          <h1 className="page-title" style={{ marginTop: 40 }}>
            歴代王者の記録
          </h1>
          <p className="page-lede">
            2001〜2025年の全21回。出身地・結成年・生年月日から集計(2001〜2010の王者は公開情報で補完)。
          </p>

          <h2 className="section-title">都道府県別の王者</h2>
          <p className="section-note">王者メンバーの出身地を都道府県ごとに集計(2人組なので延べ人数)</p>
          <div className="history-wrap">
            <table className="history">
              <thead>
                <tr>
                  <th>都道府県</th>
                  <th>王者(のべ人数)</th>
                  <th>該当王者</th>
                </tr>
              </thead>
              <tbody>
                {prefRows.map((r) => (
                  <tr key={r.pref}>
                    <td className="year" style={{ fontSize: 14 }}>
                      {r.pref}
                    </td>
                    <td className="no total">{r.count}</td>
                    <td style={{ whiteSpace: 'normal' }}>
                      {r.names.slice(0, NAME_CAP).join('、')}
                      {r.names.length > NAME_CAP ? ` 他${r.names.length - NAME_CAP}組` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="legend">
            同郷コンビは同じ県に2人分、連覇(令和ロマン)は各回を計上。合計 {champMemberTotal} 人
          </p>

          <h2 className="section-title">結成年別の王者(新しい順)</h2>
          <p className="section-note">結成年が新しい(＝コンビ歴の浅い)王者から順に表示</p>
          <div className="history-wrap">
            <table className="history">
              <thead>
                <tr>
                  <th>コンビ</th>
                  <th>結成年</th>
                  <th>優勝年</th>
                  <th>結成→優勝</th>
                </tr>
              </thead>
              <tbody>
                {formedRows.map((r) => (
                  <tr key={`${r.name}-${r.year}`}>
                    <td className="year" style={{ fontSize: 14 }}>
                      {r.name}
                    </td>
                    <td className="no">{r.formed}</td>
                    <td className="no">{r.year}</td>
                    <td className="no total">{r.span}年</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="legend">「結成→優勝」は優勝年−結成年。同一コンビの連覇は各回を掲載</p>

          <h2 className="section-title">優勝時の年齢(若い順)</h2>
          {minAge != null && maxAge != null && (
            <p className="section-note">
              最年少 {ageRows[0].age}歳({ageRows[0].name}・{ageRows[0].combi}／{ageRows[0].year}年) ／
              最年長 {ageRows[ageRows.length - 1].age}歳({ageRows[ageRows.length - 1].name}・
              {ageRows[ageRows.length - 1].combi}／{ageRows[ageRows.length - 1].year}年)
            </p>
          )}
          <div className="history-wrap">
            <table className="history">
              <thead>
                <tr>
                  <th>メンバー</th>
                  <th>コンビ</th>
                  <th>優勝年</th>
                  <th>優勝時の年齢</th>
                </tr>
              </thead>
              <tbody>
                {ageRows.map((r) => {
                  const hot = r.age === minAge || r.age === maxAge
                  return (
                    <tr key={`${r.combi}-${r.name}-${r.year}`}>
                      <td className="year" style={{ fontSize: 14 }}>
                        {r.name}
                      </td>
                      <td>{r.combi}</td>
                      <td className="no">{r.year}</td>
                      <td className={hot ? 'cell champion' : 'no'}>{r.age}歳</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="legend">年齢は決勝(12月)時点の満年齢。2人組なので延べ {champMemberTotal} 人</p>
        </>
      )}

      <AdvancerRecords />
    </>
  )
}

const NAME_CAP = 6 // 都道府県別の「該当コンビ」列で名前を並べる上限
const ROW_CAP = 30 // 長い表(結成年別/年齢別/到達回数)の表示件数上限

/** 準々決勝以上に到達したコンビを最高到達ラウンド別に集計して表示する。
 *  advancers.json が無い環境では何も描画しない。 */
function AdvancerRecords() {
  const { data } = useAdvancers()
  const [round, setRound] = useState<RoundKey>('final')
  const tiers = data?.tiers ?? []
  if (tiers.length === 0) return null

  const tier = tiers.find((t) => t.round === round) ?? tiers[0]
  const combis = tier.combis
  const label = ROUND_LABEL[tier.round]

  // A. 都道府県別(メンバー単位。出身地が判明する組のみ)
  const prefMap = new Map<string, { count: number; names: string[] }>()
  for (const c of combis) {
    for (const m of c.members) {
      if (!m.from) continue
      const e = prefMap.get(m.from) ?? { count: 0, names: [] }
      e.count += 1
      if (!e.names.includes(c.name)) e.names.push(c.name)
      prefMap.set(m.from, e)
    }
  }
  const prefRows = [...prefMap.entries()]
    .map(([pref, e]) => ({ pref, count: e.count, names: e.names }))
    .sort((a, b) => b.count - a.count || a.pref.localeCompare(b.pref, 'ja'))
  const prefMemberTotal = prefRows.reduce((s, r) => s + r.count, 0)

  // B. 結成年別(新しい順)。結成年が判明する組のみ、上位 ROW_CAP 件
  const formedAll = combis
    .filter((c) => c.formed != null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      formed: c.formed as number,
      firstYear: c.firstYear,
      span: c.firstYear - (c.formed as number),
    }))
    .sort((a, b) => b.formed - a.formed || b.firstYear - a.firstYear)
  const formedRows = formedAll.slice(0, ROW_CAP)

  // C. 初到達時の年齢(メンバー単位。若い順)。生年が判明する組のみ、上位 ROW_CAP 件
  const ageAll = combis
    .flatMap((c) =>
      c.members.map((m) => ({ id: c.id, name: m.name ?? '', combi: c.name, firstYear: c.firstYear, age: m.age })),
    )
    .filter((r): r is { id: number; name: string; combi: string; firstYear: number; age: number } => r.age != null)
    .sort((a, b) => a.age - b.age || a.firstYear - b.firstYear)
  const minAge = ageAll.length ? ageAll[0].age : null
  const maxAge = ageAll.length ? ageAll[ageAll.length - 1].age : null
  const ageRows = ageAll.slice(0, ROW_CAP)

  // D. 到達回数ランキング(最高到達ラウンドに届いた年数。多い順)
  const reachRows = [...combis]
    .sort((a, b) => b.reachCount - a.reachCount || a.name.localeCompare(b.name, 'ja'))
    .slice(0, ROW_CAP)

  return (
    <>
      <h1 className="page-title" style={{ marginTop: 40 }}>
        準々決勝以上の記録
      </h1>
      <p className="page-lede">
        コンビを最高到達ラウンド(決勝／準決勝／準々決勝)で分けて集計。2001〜2010は出身地・生年が揃わない組が多く、集計は判明分のみです。
      </p>

      <div style={{ margin: '4px 0 20px' }}>
        <div className="seg" role="group" aria-label="最高到達ラウンドの切り替え">
          {tiers.map((t) => (
            <button key={t.round} className={t.round === round ? 'active' : ''} onClick={() => setRound(t.round)}>
              {ROUND_LABEL[t.round]}（{t.combis.length}）
            </button>
          ))}
        </div>
      </div>

      <h2 className="section-title">都道府県別({label}到達コンビ)</h2>
      <p className="section-note">メンバーの出身地を都道府県ごとに集計(2人組なので延べ人数)</p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>都道府県</th>
              <th>コンビ(のべ人数)</th>
              <th>該当コンビ</th>
            </tr>
          </thead>
          <tbody>
            {prefRows.map((r) => (
              <tr key={r.pref}>
                <td className="year" style={{ fontSize: 14 }}>
                  {r.pref}
                </td>
                <td className="no total">{r.count}</td>
                <td style={{ whiteSpace: 'normal' }}>
                  {r.names.slice(0, NAME_CAP).join('、')}
                  {r.names.length > NAME_CAP ? ` 他${r.names.length - NAME_CAP}組` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legend">出身地の判明する延べ {prefMemberTotal} 人を集計(不明の組は除外)</p>

      <h2 className="section-title">結成年別({label}到達・新しい順)</h2>
      <p className="section-note">結成年が新しい組から順に表示</p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>コンビ</th>
              <th>結成年</th>
              <th>{label}初到達</th>
              <th>結成→到達</th>
            </tr>
          </thead>
          <tbody>
            {formedRows.map((r) => (
              <tr key={`${r.id}-${r.firstYear}`}>
                <td className="year" style={{ fontSize: 14 }}>
                  <Link to={`/combi/${r.id}`}>{r.name}</Link>
                </td>
                <td className="no">{r.formed}</td>
                <td className="no">{r.firstYear}</td>
                <td className="no total">{r.span}年</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legend">
        「結成→到達」は初到達年−結成年。結成年の判明する {formedAll.length} 組のうち新しい順に上位 {formedRows.length} 組を表示
      </p>

      <h2 className="section-title">{label}初到達時の年齢(若い順)</h2>
      {minAge != null && maxAge != null && (
        <p className="section-note">
          最年少 {ageAll[0].age}歳({ageAll[0].name}・{ageAll[0].combi}／{ageAll[0].firstYear}年) ／ 最年長{' '}
          {ageAll[ageAll.length - 1].age}歳({ageAll[ageAll.length - 1].name}・{ageAll[ageAll.length - 1].combi}／
          {ageAll[ageAll.length - 1].firstYear}年)
        </p>
      )}
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>メンバー</th>
              <th>コンビ</th>
              <th>{label}初到達</th>
              <th>到達時の年齢</th>
            </tr>
          </thead>
          <tbody>
            {ageRows.map((r) => {
              const hot = r.age === minAge || r.age === maxAge
              return (
                <tr key={`${r.id}-${r.name}-${r.firstYear}`}>
                  <td className="year" style={{ fontSize: 14 }}>
                    {r.name}
                  </td>
                  <td>
                    <Link to={`/combi/${r.id}`}>{r.combi}</Link>
                  </td>
                  <td className="no">{r.firstYear}</td>
                  <td className={hot ? 'cell champion' : 'no'}>{r.age}歳</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="legend">
        年齢は初到達年時点の満年齢の概算。生年の判明する延べ {ageAll.length} 人のうち若い順に上位 {ageRows.length} 人を表示
      </p>

      <h2 className="section-title">{label}到達回数ランキング</h2>
      <p className="section-note">
        {label}に到達した年数(2001年からの全期間)。最高到達が{label}の組のみ＝さらに上へ進んだ組は上位ラウンドで集計
      </p>
      <div className="history-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>順位</th>
              <th>コンビ</th>
              <th>{label}到達回数</th>
            </tr>
          </thead>
          <tbody>
            {reachRows.map((r, i) => (
              <tr key={r.id}>
                <td className="no">{i + 1}</td>
                <td className="year" style={{ fontSize: 14 }}>
                  <Link to={`/combi/${r.id}`}>{r.name}</Link>
                </td>
                <td className="no total">{r.reachCount}回</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legend">
        最高到達が{label}のコンビ 全{combis.length}組のうち上位 {reachRows.length} 組を表示
      </p>
    </>
  )
}
