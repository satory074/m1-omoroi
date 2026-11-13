import { useMemo, useState } from 'react'

import { GRID_COLS, GRID_ROWS, PREF_NAME_SET, PREF_TILES } from '../lib/prefectures'
import { hexToRgb, useTokens } from '../lib/tokens'
import HistoryTable from './HistoryTable'

export interface PrefNameGroup {
  /** 一覧の見出し(例: "★ 王者" / "決勝到達") */
  label: string
  names: string[]
}

export interface PrefRow {
  pref: string
  count: number
  names: string[]
  /** マスの右上に王冠つきで表示する副カウント(例: 王者の延べ人数)。0/undefined なら非表示 */
  badge?: number
  /** タップ詳細を見出しつきの複数グループで出す場合に指定(names より優先して表示) */
  groups?: PrefNameGroup[]
}

interface Props {
  /** 都道府県別の集計行(件数降順・県名は接尾辞つきフルネーム)。海外/その他の値が混じっていてもよい */
  rows: PrefRow[]
  /** 件数の単位(例: "人") */
  unit: string
  /** 選択県の該当一覧の見出し(例: "該当王者" / "該当コンビ")。groups 使用時は未使用 */
  nameLabel: string
  /** badge の説明(セルの title 用。例: "王者") */
  badgeLabel?: string
}

const TOKENS = ['--c-surface-2', '--c-accent', '--c-text', '--c-on-accent'] as const

/** 相対輝度(WCAG)。マスの地の色に対して、黒と白のどちらの文字が読みやすいかを決めるのに使う */
function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

export default function JapanGridMap({ rows, unit, nameLabel, badgeLabel = '王者' }: Props) {
  // 淡い灰色 → M-1の赤 へ補間する塗り分け(色はトークンから)。文字色はマスごとに読みやすい方を選ぶ
  // (以前は割合 0.55 で白に切り替えていて、中間の赤に白文字が 3.1:1 しかなかった)
  const t = useTokens(TOKENS)
  const low = hexToRgb(t['--c-surface-2'])
  const high = hexToRgb(t['--c-accent'])
  const darkL = luminance(hexToRgb(t['--c-text']))
  const lightL = luminance(hexToRgb(t['--c-on-accent']))
  const mix = (ratio: number): [number, number, number] => [0, 1, 2].map((i) => Math.round(low[i] + (high[i] - low[i]) * ratio)) as [number, number, number]
  const rgb = (c: [number, number, number]) => `rgb(${c[0]} ${c[1]} ${c[2]})`
  const textOn = (c: [number, number, number]) => {
    const l = luminance(c)
    return contrast(l, darkL) >= contrast(l, lightL) ? t['--c-text'] : t['--c-on-accent']
  }

  const byPref = useMemo(() => {
    const m = new Map<string, PrefRow>()
    for (const r of rows) m.set(r.pref, r)
    return m
  }, [rows])

  const max = useMemo(() => {
    let mx = 0
    for (const t of PREF_TILES) {
      const c = byPref.get(t.name)?.count ?? 0
      if (c > mx) mx = c
    }
    return mx
  }, [byPref])

  // 最多県(初期選択に使う)
  const topPref = useMemo(() => {
    let best: string | null = null
    let bc = -1
    for (const t of PREF_TILES) {
      const c = byPref.get(t.name)?.count ?? 0
      if (c > bc) {
        bc = c
        best = t.name
      }
    }
    return best
  }, [byPref])

  // 47県に無いキー(海外・その他)は地図に載せずチップで表示
  const foreign = useMemo(
    () => rows.filter((r) => !PREF_NAME_SET.has(r.pref)).sort((a, b) => b.count - a.count),
    [rows],
  )

  const [selected, setSelected] = useState<string | null>(null)
  // 選択が現在の rows に無ければ最多県にフォールバック(ラウンド切替対策)
  const active = selected && byPref.has(selected) ? selected : topPref
  const activeRow = active ? byPref.get(active) : undefined
  const activeCount = activeRow?.count ?? 0
  const activeNames = activeRow?.names ?? []
  const activeGroups = (activeRow?.groups ?? []).filter((g) => g.names.length > 0)

  const hasBadges = rows.some((r) => (r.badge ?? 0) > 0)

  return (
    <div className="jpmap">
      <div className="jpmap-scroll">
        <div
          className="jpmap-grid"
          style={{
            gridTemplateColumns: `repeat(${GRID_COLS}, var(--cell))`,
            gridTemplateRows: `repeat(${GRID_ROWS}, var(--cell))`,
          }}
        >
          {PREF_TILES.map((tile) => {
            const row = byPref.get(tile.name)
            const count = row?.count ?? 0
            const badge = row?.badge ?? 0
            const ratio = max > 0 ? count / max : 0
            const zero = count === 0 && badge === 0
            const isActive = tile.name === active
            return (
              <button
                key={tile.name}
                type="button"
                className={`jpmap-cell${zero ? ' zero' : ''}${isActive ? ' selected' : ''}`}
                style={{
                  gridColumn: tile.col + 1,
                  gridRow: tile.row + 1,
                  background: zero ? undefined : rgb(mix(ratio)),
                  color: zero ? undefined : textOn(mix(ratio)),
                }}
                aria-label={`${tile.name} ${count}${unit}${badge > 0 ? `(うち${badgeLabel}${badge}${unit})` : ''}`}
                aria-pressed={isActive}
                onClick={() => setSelected(tile.name)}
              >
                {badge > 0 && (
                  <span className="jpmap-crown" aria-hidden="true">
                    ★{badge > 1 ? badge : ''}
                  </span>
                )}
                <span className="jpmap-name">{tile.short}</span>
                <span className="jpmap-num">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="jpmap-detail" aria-live="polite">
        {active ? (
          <>
            <strong>{active}</strong>
            <span className="jpmap-detail-count">
              {activeCount}
              {unit}
            </span>
            {activeGroups.length > 0 ? (
              activeGroups.map((g) => (
                <div key={g.label} className="jpmap-detail-group">
                  <span className="jpmap-detail-group-label">{g.label}</span> {g.names.join('、')}
                </div>
              ))
            ) : activeNames.length > 0 ? (
              <span className="jpmap-detail-names">
                {' '}
                ▶ {nameLabel}: {activeNames.join('、')}
              </span>
            ) : (
              <span className="jpmap-detail-names muted"> ▶ 該当なし</span>
            )}
          </>
        ) : (
          <span className="muted">県のマスをタップすると{nameLabel}が表示されます</span>
        )}
      </div>

      <div className="jpmap-legend">
        <span className="jpmap-legend-scale" aria-hidden="true">
          <i style={{ background: 'var(--c-bg)' }} />
          <i style={{ background: rgb(mix(0.25)) }} />
          <i style={{ background: rgb(mix(0.5)) }} />
          <i style={{ background: rgb(mix(0.75)) }} />
          <i style={{ background: rgb(mix(1)) }} />
        </span>
        <span>
          少 → 多(数字=のべ{unit}数{max > 0 ? `・最多 ${max}${unit}` : ''})
          {hasBadges ? ` ／ ★=${badgeLabel}を輩出` : ''}
        </span>
      </div>

      <details className="note">
        <summary>
          <span className="note-label">表で見る(都道府県別の一覧)</span>
        </summary>
        <HistoryTable caption={`都道府県別の${unit}数(多い順)`}>
          <thead>
            <tr>
              <th scope="col">都道府県</th>
              <th scope="col" className="num">
                {unit}数
              </th>
              <th scope="col">{nameLabel}</th>
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .filter((r) => r.count > 0)
              .sort((a, b) => b.count - a.count)
              .map((r) => (
                <tr key={r.pref}>
                  <td>{r.pref}</td>
                  <td className="no">
                    {r.count}
                    {r.badge ? `(${badgeLabel}${r.badge})` : ''}
                  </td>
                  <td className="names-cell">
                    {(r.groups && r.groups.length > 0 ? r.groups.flatMap((g) => g.names) : r.names).join('、')}
                  </td>
                </tr>
              ))}
          </tbody>
        </HistoryTable>
      </details>

      {foreign.length > 0 && (
        <p className="jpmap-foreign">
          海外・その他: {foreign.map((f) => `${f.pref}${f.count}${unit}`).join('、')}
        </p>
      )}
    </div>
  )
}
