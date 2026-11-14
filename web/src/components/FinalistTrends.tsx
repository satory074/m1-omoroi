import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useTokens } from '../lib/tokens'
import type { FinalistsYear } from '../lib/types'
import { hiatusArea, yearsWithHiatus } from './chartHiatus'
import HistoryTable from './HistoryTable'

// 色は CSS のトークンから読む。3色の組み合わせ(赤・青・金)は dataviz スキルの検証スクリプトで確認済み
// (色覚の違いでの区別 ΔE 19.3 以上・白地で 3:1 以上)
const TOKENS = ['--c-chart-1', '--c-chart-2', '--c-chart-3', '--c-chart-grid', '--c-chart-axis', '--c-bg', '--c-border', '--c-surface-2'] as const

type Tokens = Record<(typeof TOKENS)[number], string>

function useChartStyle() {
  const t = useTokens(TOKENS) as Tokens
  return {
    t,
    tick: { fontSize: 12, fill: t['--c-chart-axis'] },
    tooltipStyle: {
      background: t['--c-bg'],
      border: `1px solid ${t['--c-border']}`,
      borderRadius: 4,
      fontSize: 13,
      fontFamily: 'inherit',
    },
  }
}

/** 年ごとの値を、休止の年を空にして軸に並べる */
function onYearAxis<T>(rows: FinalistsYear[], pick: (r: FinalistsYear) => T) {
  const byYear = new Map(rows.map((r) => [r.year, r]))
  return yearsWithHiatus(rows.map((r) => r.year)).map((y) => {
    const r = byYear.get(y)
    return { year: String(y), ...(r ? pick(r) : {}) }
  })
}

/** 1系列の小さな折れ線(年齢・結成年数を別々のグラフにする。単位の違う2つを1つの軸に重ねない) */
function SmallLine({
  rows,
  label,
  unit,
  step,
  value,
}: {
  rows: FinalistsYear[]
  label: string
  unit: string
  /** 目盛りの刻み(軸の端をこの倍数にそろえる) */
  step: number
  value: (r: FinalistsYear) => number | null
}) {
  const { t, tick, tooltipStyle } = useChartStyle()
  const data = onYearAxis(rows, (r) => ({ v: value(r) }))
  const vals = rows.map(value).filter((v): v is number => v != null)
  const lo = Math.floor(Math.min(...vals) / step) * step
  const hi = Math.ceil(Math.max(...vals) / step) * step
  const ticks = Array.from({ length: (hi - lo) / step + 1 }, (_, i) => lo + i * step)
  return (
    <figure className="chart-small">
      <figcaption className="chart-small-title">{label}</figcaption>
      <div role="img" aria-label={`決勝進出者の${label}の推移の折れ線グラフ。数値は下の「表で見る」にあります`}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={t['--c-chart-grid']} vertical={false} />
            {hiatusArea(t['--c-surface-2'], t['--c-chart-axis'])}
            <XAxis dataKey="year" tick={tick} tickLine={false} axisLine={{ stroke: t['--c-chart-grid'] }} interval={6} />
            <YAxis
              tick={tick}
              tickLine={false}
              axisLine={false}
              width={36}
              domain={[lo, hi]}
              ticks={ticks}
            />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}${unit}`, label]} />
            <Line
              dataKey="v"
              stroke={t['--c-chart-1']}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

/** 決勝進出者の平均年齢・平均結成年数の推移(finals_stats.finalistsByYear) */
export function FinalistAgeSection({ rows }: { rows: FinalistsYear[] }) {
  if (rows.length === 0) return null
  const early = rows.filter((r) => r.year <= 2010 && r.meanAge != null).map((r) => r.meanAge as number)
  const late = rows.filter((r) => r.year >= 2015 && r.meanAge != null).map((r) => r.meanAge as number)
  const range = (xs: number[]) => `${Math.round(Math.min(...xs))}〜${Math.round(Math.max(...xs))}歳`
  return (
    <section className="chart-card">
      <h3 className="section-title">決勝進出者の年齢と結成年数</h3>
      <p className="section-note">
        決勝(ファーストラウンド)に進んだ組の、メンバーの平均年齢と、コンビの平均結成年数(大会年 − 結成年)。
        年齢は各年の決勝の日の満年齢です。出場資格は2010年までが結成10年以内、2015年から結成15年以内に広がりました。
        {early.length > 0 && late.length > 0 && ` 平均年齢は2010年までが${range(early)}、2015年以降は${range(late)}です。`}
      </p>
      <div className="chart-pair">
        <SmallLine rows={rows} label="平均年齢" unit="歳" step={5} value={(r) => r.meanAge} />
        <SmallLine rows={rows} label="平均結成年数" unit="年" step={2} value={(r) => r.meanFormedYears} />
      </div>
      <details className="note">
        <summary>
          <span className="note-label">表で見る</span>
        </summary>
        <HistoryTable caption="決勝進出者の平均年齢と平均結成年数">
          <thead>
            <tr>
              <th scope="col">年</th>
              <th scope="col">組数</th>
              <th scope="col">平均年齢</th>
              <th scope="col">平均結成年数</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.year}>
                <td className="year">{r.year}</td>
                <td className="no">{r.n}</td>
                <td className="no">
                  {r.meanAge != null ? `${r.meanAge.toFixed(1)}歳` : '—'}
                  {r.ageN > 0 && <small>({r.ageN}人)</small>}
                </td>
                <td className="no">{r.meanFormedYears != null ? `${r.meanFormedYears.toFixed(1)}年` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </HistoryTable>
      </details>
    </section>
  )
}

interface StackSeries {
  key: string
  label: string
  token: (typeof TOKENS)[number]
}

/** 年ごとの組数を積み上げる棒(凡例つき。系列は2〜3個) */
function StackedBars({
  data,
  series,
  aria,
}: {
  data: Record<string, string | number | null>[]
  series: StackSeries[]
  aria: string
}) {
  const { t, tick, tooltipStyle } = useChartStyle()
  return (
    <>
      <ul className="chart-legend" aria-label="棒の色">
        {series.map((s) => (
          <li key={s.key}>
            <i style={{ background: t[s.token] }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <div role="img" aria-label={aria}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={t['--c-chart-grid']} vertical={false} />
            {hiatusArea(t['--c-surface-2'], t['--c-chart-axis'])}
            <XAxis dataKey="year" tick={tick} tickLine={false} axisLine={{ stroke: t['--c-chart-grid'] }} interval={2} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: t['--c-surface-2'] }}
              formatter={(v, name) => [`${v}組`, series.find((s) => s.key === name)?.label ?? name]}
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="a"
                fill={t[s.token]}
                // 積み上げの境目に地の色の細い隙間(隣の色と溶けないように)
                stroke={t['--c-bg']}
                strokeWidth={1}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
                maxBarSize={24}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

const KANSAI_SERIES: StackSeries[] = [
  { key: 'all', label: '全員が関西出身', token: '--c-chart-1' },
  { key: 'some', label: '一部が関西出身', token: '--c-chart-2' },
  { key: 'none', label: '関西出身なし', token: '--c-chart-3' },
]

const YOSHIMOTO_SERIES: StackSeries[] = [
  { key: 'yes', label: '吉本', token: '--c-chart-1' },
  { key: 'no', label: '吉本以外', token: '--c-chart-2' },
]

/** 決勝の顔ぶれ(関西出身・吉本)の推移(finals_stats.finalistsByYear) */
export function FinalistMakeupSection({ rows }: { rows: FinalistsYear[] }) {
  if (rows.length === 0) return null
  const first = rows[0]
  const last = rows[rows.length - 1]
  const hasUnknownOrigin = rows.some((r) => r.kansai.unknown > 0)
  const hasUnknownAgency = rows.some((r) => r.yoshimoto.unknown > 0)
  const kansaiData = onYearAxis(rows, (r) => ({ all: r.kansai.all, some: r.kansai.some, none: r.kansai.none }))
  const yoshiData = onYearAxis(rows, (r) => ({ yes: r.yoshimoto.yes, no: r.yoshimoto.no }))
  return (
    <section className="chart-card">
      <h3 className="section-title">決勝の顔ぶれ(関西出身・吉本)</h3>
      <p className="section-note">
        決勝に進んだ組を、メンバーの出身地と所属事務所で分けた組数の推移です。
        2人(3人)とも関西出身の組は、{first.year}年の{first.n}組中{first.kansai.all}組から、{last.year}年は{last.n}組中
        {last.kansai.all}組になりました。
      </p>
      <h4 className="chart-small-title">出身地</h4>
      <StackedBars
        data={kansaiData}
        series={KANSAI_SERIES}
        aria="決勝進出組の出身地(関西)の内訳の積み上げ棒グラフ。数値は下の「表で見る」にあります"
      />
      <p className="legend">
        関西 = 大阪・京都・兵庫・奈良・和歌山・滋賀(公式コンビ情報の出身地。活動の拠点ではありません)。
        {hasUnknownOrigin && ' 出身地が分からない人がいる組はグラフから外し、表に「不明」として出します。'}
      </p>
      <h4 className="chart-small-title">所属事務所</h4>
      <StackedBars
        data={yoshiData}
        series={YOSHIMOTO_SERIES}
        aria="決勝進出組の所属(吉本かどうか)の内訳の積み上げ棒グラフ。数値は下の「表で見る」にあります"
      />
      <p className="legend">
        所属は公式コンビ情報の<strong>現在の</strong>登録で数えています。決勝の後に移籍した組は、当時と違う側に入ります。
        {hasUnknownAgency && ' 所属が分からない組はグラフから外し、表に「不明」として出します。'}
      </p>
      <details className="note">
        <summary>
          <span className="note-label">表で見る</span>
        </summary>
        <HistoryTable caption="決勝進出組の出身地と所属の内訳">
          <thead>
            <tr>
              <th scope="col">年</th>
              <th scope="col">組数</th>
              {KANSAI_SERIES.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
              {hasUnknownOrigin && <th scope="col">出身地不明</th>}
              {YOSHIMOTO_SERIES.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
              {hasUnknownAgency && <th scope="col">所属不明</th>}
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.year}>
                <td className="year">{r.year}</td>
                <td className="no">{r.n}</td>
                <td className="no">{r.kansai.all}</td>
                <td className="no">{r.kansai.some}</td>
                <td className="no">{r.kansai.none}</td>
                {hasUnknownOrigin && <td className="no">{r.kansai.unknown}</td>}
                <td className="no">{r.yoshimoto.yes}</td>
                <td className="no">{r.yoshimoto.no}</td>
                {hasUnknownAgency && <td className="no">{r.yoshimoto.unknown}</td>}
              </tr>
            ))}
          </tbody>
        </HistoryTable>
      </details>
    </section>
  )
}
