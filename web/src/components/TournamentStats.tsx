import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Link } from 'react-router-dom'

import { ROUND_LABEL, ROUND_ORDER } from '../lib/rounds'
import { useTokens } from '../lib/tokens'
import type { Stats, YearStats } from '../lib/types'
import HistoryTable from './HistoryTable'

// 回戦の色。dataviz スキルの検証スクリプトで確認済み(色覚の違いでの区別 ΔE 19.3 以上・白地で 3:1 以上)。
// 以前の橙(#d99f23)は白地で 2.35:1 しかなかった。色は CSS のトークンから読む(styles/tokens/theme.css)
const SERIES = [
  { key: 'first', label: '1回戦', token: '--c-chart-1' },
  { key: 'second', label: '2回戦', token: '--c-chart-2' },
  { key: 'third', label: '3回戦', token: '--c-chart-3' },
] as const
const TOKENS = ['--c-chart-1', '--c-chart-2', '--c-chart-3', '--c-chart-grid', '--c-chart-axis', '--c-bg', '--c-border', '--c-surface-2'] as const

/** 大会が開かれなかった年(グラフでは空白として描き、年を詰めない) */
const HIATUS = [2011, 2012, 2013, 2014]

function passRate(y: YearStats, rk: (typeof SERIES)[number]['key']): number | null {
  const r = y.byRound[rk]
  // 合格者しか記録が残っていない年(通過=出場)は通過率を計算できない
  if (!r || r.appeared <= r.passed) return null
  return Math.round((r.passed / r.appeared) * 1000) / 10
}

/** 記録・統計「大会」タブ: エントリー数・通過率の推移と年度別の出場/通過数(stats.json) */
export default function TournamentStats({ data }: { data: Stats }) {
  const t = useTokens(TOKENS)
  const tick = { fontSize: 12, fill: t['--c-chart-axis'] }
  const tooltipStyle = {
    background: t['--c-bg'],
    border: `1px solid ${t['--c-border']}`,
    borderRadius: 4,
    fontSize: 13,
    fontFamily: 'inherit',
  }

  const byYear = [...data.byYear].sort((a, b) => a.year - b.year)
  // 休止の年も軸に並べる(値は空)。年を詰めると、2010→2015 が隣り合って時間の幅が歪んで見える
  const years = [...byYear.map((y) => y.year), ...HIATUS].sort((a, b) => a - b)
  const yearOf = new Map(byYear.map((y) => [y.year, y]))
  const entriesData = years.map((yr) => ({ year: String(yr), entries: yearOf.get(yr)?.entries ?? null }))
  const rateData = years.map((yr) => {
    const y = yearOf.get(yr)
    return {
      year: String(yr),
      first: y ? passRate(y, 'first') : null,
      second: y ? passRate(y, 'second') : null,
      third: y ? passRate(y, 'third') : null,
    }
  })
  const rateRows = byYear.filter((y) => SERIES.some((s) => passRate(y, s.key) != null)).reverse()

  const lastIndex = (key: (typeof SERIES)[number]['key']) => {
    for (let i = rateData.length - 1; i >= 0; i--) if (rateData[i][key] != null) return i
    return -1
  }
  // 線の終わりに回戦名を直接書く(凡例と色だけに頼らない)。文字は文字色、線の色は横の短い線で示す
  const endLabel =
    (name: string, targetIndex: number) =>
    (props: { x?: number | string; y?: number | string; index?: number }) => {
      if (props.index !== targetIndex || props.x == null || props.y == null) return <g />
      return (
        <text x={Number(props.x) + 8} y={Number(props.y) + 4} fill={t['--c-chart-axis']} fontSize={12} fontWeight={700}>
          {name}
        </text>
      )
    }
  const hiatus = (
    <ReferenceArea
      x1="2011"
      x2="2014"
      fill={t['--c-surface-2']}
      fillOpacity={1}
      label={{ value: '休止', position: 'insideTop', fill: t['--c-chart-axis'], fontSize: 12 }}
    />
  )

  return (
    <>
      <section className="chart-card">
        <h2 className="section-title">エントリー数の推移</h2>
        <p className="section-note">2001〜2010年は記録に残るコンビの数です。</p>
        <div role="img" aria-label="エントリー数の推移の棒グラフ。数値は下の「年度別の出場・通過数」の表にあります">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={entriesData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={t['--c-chart-grid']} vertical={false} />
              {hiatus}
              <XAxis dataKey="year" tick={tick} tickLine={false} axisLine={{ stroke: t['--c-chart-grid'] }} interval={2} />
              <YAxis
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v: number) => v.toLocaleString('ja-JP')}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [`${Number(v).toLocaleString('ja-JP')}組`, 'エントリー']}
                cursor={{ fill: t['--c-surface-2'] }}
              />
              <Bar dataKey="entries" fill={t['--c-chart-1']} radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="chart-card">
        <h2 className="section-title">回戦別 通過率の推移</h2>
        <ul className="chart-legend" aria-label="線の色">
          {SERIES.map((s) => (
            <li key={s.key}>
              <i style={{ background: t[s.token] }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
        <div role="img" aria-label="回戦別の通過率の推移の折れ線グラフ。数値は下の「表で見る」にあります">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={rateData} margin={{ top: 8, right: 64, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={t['--c-chart-grid']} vertical={false} />
              {hiatus}
              <XAxis dataKey="year" tick={tick} tickLine={false} axisLine={{ stroke: t['--c-chart-grid'] }} interval={2} />
              <YAxis tick={tick} tickLine={false} axisLine={false} width={44} unit="%" />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, name) => [`${v}%`, SERIES.find((s) => s.key === name)?.label ?? name]}
              />
              {SERIES.map((s) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  stroke={t[s.token]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  // 休止の年は線をつながない(つなぐと、開かれていない年にも値があるように見える)
                  connectNulls={false}
                  label={endLabel(s.label, lastIndex(s.key))}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="legend">通過率 = 通過数 ÷ 出場数。合格者しか記録がない年は除きます。</p>
        <details className="note">
          <summary>
            <span className="note-label">表で見る</span>
          </summary>
          <HistoryTable caption="回戦別の通過率(%)">
            <thead>
              <tr>
                <th scope="col">年</th>
                {SERIES.map((s) => (
                  <th key={s.key} scope="col" className="num">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rateRows.map((y) => (
                <tr key={y.year}>
                  <td className="year">{y.year}</td>
                  {SERIES.map((s) => {
                    const r = passRate(y, s.key)
                    return (
                      <td key={s.key} className="no">
                        {r != null ? `${r.toFixed(1)}%` : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </HistoryTable>
        </details>
      </section>
      <h2 className="section-title">年度別の出場・通過数</h2>
      <HistoryTable caption="年度別の出場・通過数" className="stats-table">
          <thead>
            <tr>
              <th scope="col">年</th>
              <th scope="col">エントリー</th>
              {ROUND_ORDER.map((rk) => (
                <th scope="col" key={rk}>{ROUND_LABEL[rk]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...byYear].reverse().map((y) => (
              <tr key={y.year}>
                <td className="year">
                  <Link to={`/years/${y.year}`}>{y.year}</Link>
                </td>
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
        </HistoryTable>
      <p className="legend">各セルは「通過数/出場数」</p>

    </>
  )
}
