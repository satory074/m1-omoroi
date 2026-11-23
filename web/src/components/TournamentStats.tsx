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

import { Link } from 'react-router-dom'

import { ROUND_LABEL, ROUND_ORDER } from '../lib/rounds'
import { useTokens } from '../lib/tokens'
import type { FormationReach, PassCount, Stats } from '../lib/types'
import { hiatusArea, yearsWithHiatus } from './chartHiatus'
import HistoryTable from './HistoryTable'
import { yearPath } from '../lib/paths'

// 線・棒の色は CSS のトークンから読む(styles/tokens/theme.css)。dataviz スキルの検証スクリプトで確認済み
// (色覚の違いでの区別 ΔE 19.3 以上・白地で 3:1 以上)
const TOKENS = ['--c-chart-1', '--c-chart-2', '--c-chart-3', '--c-chart-grid', '--c-chart-axis', '--c-bg', '--c-border', '--c-surface-2'] as const

/** 記録・統計「大会」タブ: エントリー数の推移・年度別の出場/通過数・結成年数別の勝ち上がり率(stats.json) */
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
  // 休止の年も軸に並べる(値は空)
  const years = yearsWithHiatus(byYear.map((y) => y.year))
  const yearOf = new Map(byYear.map((y) => [y.year, y]))
  const entriesData = years.map((yr) => ({ year: String(yr), entries: yearOf.get(yr)?.entries ?? null }))
  const hiatus = hiatusArea(t['--c-surface-2'], t['--c-chart-axis'])

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
                  <Link to={yearPath(y.year)}>{y.year}</Link>
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

      <FormationReachSection reach={data.formationReach} />
    </>
  )
}

function rate(c: PassCount): string {
  return c.appeared ? `${((c.passed / c.appeared) * 100).toFixed(1)}%` : '—'
}

function countCell(c: PassCount, key?: string) {
  return (
    <td key={key} className="no">
      {rate(c)} <small>({c.passed}/{c.appeared})</small>
    </td>
  )
}

// 結成年数別の到達率の線
const REACH_SERIES = [
  { key: 'third', label: '3回戦以降', short: '3回戦', token: '--c-chart-3' },
  { key: 'quarterfinal', label: '準々決勝以降', short: '準々決勝', token: '--c-chart-2' },
  { key: 'semifinal', label: '準決勝以降', short: '準決勝', token: '--c-chart-1' },
] as const

/**
 * 結成年数(大会年 − 結成年)ごとに、その回戦かそれより先まで進んだ割合。
 * 分母はその結成年数で出場した延べ組数。勝ち上がれない組は解散して分母から消えるので、年数そのものの効果ではない
 */
function FormationReachSection({ reach }: { reach: FormationReach }) {
  const t = useTokens(TOKENS)
  if (!reach.fromYear || reach.rows.length === 0) return null
  const tick = { fontSize: 12, fill: t['--c-chart-axis'] }
  const tooltipStyle = {
    background: t['--c-bg'],
    border: `1px solid ${t['--c-border']}`,
    borderRadius: 4,
    fontSize: 13,
    fontFamily: 'inherit',
  }
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null)
  const data = reach.rows.map((r) => ({
    years: `${r.years}年`,
    third: pct(r.reached.third, r.entries),
    quarterfinal: pct(r.reached.quarterfinal, r.entries),
    semifinal: pct(r.reached.semifinal, r.entries),
  }))
  const last = data.length - 1
  const endLabel =
    (name: string) =>
    (props: { x?: number | string; y?: number | string; index?: number }) => {
      if (props.index !== last || props.x == null || props.y == null) return <g />
      return (
        <text x={Number(props.x) + 8} y={Number(props.y) + 4} fill={t['--c-chart-axis']} fontSize={12} fontWeight={700}>
          {name}
        </text>
      )
    }
  const span = `${reach.fromYear}〜${reach.toYear}年`
  const total = reach.rows.reduce((sum, r) => sum + r.entries, 0)
  const ex = reach.excluded
  return (
    <section className="chart-card">
      <h2 className="section-title">結成年数別の勝ち上がり率</h2>
      <p className="section-note">
        結成何年目(大会の年 − 結成年)の組が、その回戦かそれより先まで進んだ割合です({span}の合計、延べ{total.toLocaleString('ja-JP')}組)。
        到達率 = その回戦以降まで進んだ延べ組数 ÷ その結成年数で出場した延べ組数。
        シードで回戦を飛ばした組や、3回戦の無かった2020年に準々決勝へ進んだ組も「3回戦以降」に入ります。
      </p>
      <p className="section-note">
        年数が長いほど高くなりますが、勝ち上がれない組は解散して分母から消えていくので、「続けると強くなる」という年数そのものの効果とは言えません。
        結成年は公式サイトのコンビ情報の登録値です。
      </p>
      <ul className="chart-legend" aria-label="線の色">
        {REACH_SERIES.map((s) => (
          <li key={s.key}>
            <i style={{ background: `var(${s.token})` }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <div role="img" aria-label="結成年数別の到達率の折れ線グラフ。数値は下の「表で見る」にあります">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 8, right: 72, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={t['--c-chart-grid']} vertical={false} />
            <XAxis dataKey="years" tick={tick} tickLine={false} axisLine={{ stroke: t['--c-chart-grid'] }} interval={2} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={44} unit="%" />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(l) => `結成${l}`}
              formatter={(v, name) => [`${v}%`, REACH_SERIES.find((s) => s.key === name)?.label ?? name]}
            />
            {REACH_SERIES.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={t[s.token]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                label={endLabel(s.short)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="legend">
        除いた組: 出場予定が残る{ex.scheduled}件・欠席のみや結果なし{ex.noResult.toLocaleString('ja-JP')}件・結成年なし{ex.unknownFormed}件・
        結成年数が0〜15年の外(再結成などで負になる組){ex.outOfRange}件。
        {reach.excludedYears.length > 0 && `${reach.excludedYears.join('・')}年は大会の途中なので含めません。`}
      </p>
      <details className="note">
        <summary>
          <span className="note-label">表で見る</span>
        </summary>
        <HistoryTable caption={`結成年数別の到達率(${span})`}>
          <thead>
            <tr>
              <th scope="col">結成年数</th>
              <th scope="col">出場(延べ)</th>
              {REACH_SERIES.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
              <th scope="col">決勝</th>
            </tr>
          </thead>
          <tbody>
            {reach.rows.map((r) => (
              <tr key={r.years}>
                <td className="no">{r.years}年</td>
                <td className="no">{r.entries.toLocaleString('ja-JP')}</td>
                {REACH_SERIES.map((s) => countCell({ appeared: r.entries, passed: r.reached[s.key] }, s.key))}
                {countCell({ appeared: r.entries, passed: r.reached.final }, 'final')}
              </tr>
            ))}
          </tbody>
        </HistoryTable>
      </details>
    </section>
  )
}
