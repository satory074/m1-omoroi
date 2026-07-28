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

import { useStats } from '../lib/api'
import { ROUND_LABEL, ROUND_ORDER } from '../lib/rounds'
import type { YearStats } from '../lib/types'

// datavizスキルで検証済みのカテゴリカルパレット(赤=1回戦, 金=2回戦, 青=3回戦)
const SERIES = [
  { key: 'first', label: '1回戦', color: '#c8102e' },
  { key: 'second', label: '2回戦', color: '#d99f23' },
  { key: 'third', label: '3回戦', color: '#3468c0' },
] as const

const INK = '#221e1a'
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
    </>
  )
}
