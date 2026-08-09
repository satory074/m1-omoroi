import { useMemo, useState } from 'react'

import { GRID_COLS, GRID_ROWS, PREF_NAME_SET, PREF_TILES } from '../lib/prefectures'

export interface PrefNameGroup {
  /** 一覧の見出し(例: "👑 王者" / "決勝到達") */
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

// 薄い紙色(--paper-2) → M-1の朱(--red) へRGB補間する choropleth
const LOW: [number, number, number] = [242, 238, 230]
const HIGH: [number, number, number] = [200, 16, 46]
function mix(ratio: number): string {
  const r = Math.round(LOW[0] + (HIGH[0] - LOW[0]) * ratio)
  const g = Math.round(LOW[1] + (HIGH[1] - LOW[1]) * ratio)
  const b = Math.round(LOW[2] + (HIGH[2] - LOW[2]) * ratio)
  return `rgb(${r}, ${g}, ${b})`
}

export default function JapanGridMap({ rows, unit, nameLabel, badgeLabel = '王者' }: Props) {
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
          {PREF_TILES.map((t) => {
            const row = byPref.get(t.name)
            const count = row?.count ?? 0
            const badge = row?.badge ?? 0
            const ratio = max > 0 ? count / max : 0
            const zero = count === 0 && badge === 0
            const isActive = t.name === active
            return (
              <button
                key={t.name}
                type="button"
                className={`jpmap-cell${zero ? ' zero' : ''}${isActive ? ' selected' : ''}`}
                style={{
                  gridColumn: t.col + 1,
                  gridRow: t.row + 1,
                  background: zero ? undefined : mix(ratio),
                  color: !zero && ratio > 0.55 ? '#fff' : undefined,
                }}
                title={`${t.name} ${count}${unit}${badge > 0 ? `(うち${badgeLabel}${badge}${unit})` : ''}`}
                aria-pressed={isActive}
                onClick={() => setSelected(t.name)}
              >
                {badge > 0 && (
                  <span className="jpmap-crown" aria-label={`${badgeLabel}${badge}${unit}`}>
                    👑{badge > 1 ? badge : ''}
                  </span>
                )}
                <span className="jpmap-name">{t.short}</span>
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
          <i style={{ background: 'var(--paper)' }} />
          <i style={{ background: mix(0.25) }} />
          <i style={{ background: mix(0.5) }} />
          <i style={{ background: mix(0.75) }} />
          <i style={{ background: mix(1) }} />
        </span>
        <span>
          少 → 多(数字=のべ{unit}数{max > 0 ? `・最多 ${max}${unit}` : ''})
          {hasBadges ? ` ／ 👑=${badgeLabel}を輩出` : ''}
        </span>
      </div>

      {foreign.length > 0 && (
        <p className="jpmap-foreign">
          海外・その他: {foreign.map((f) => `${f.pref}${f.count}${unit}`).join('、')}
        </p>
      )}
    </div>
  )
}
