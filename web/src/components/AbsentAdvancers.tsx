import { KIND_LABEL, TIERS, type AbsentRow, type Tier } from '../lib/absentRows'
import { m1LimitYears } from '../lib/eligibility'
import { ROUND_LABEL, formatHits } from '../lib/rounds'
import { useUrlParam } from '../lib/useUrlParam'
import CombiLink from './CombiLink'
import FormedChip from './FormedChip'
import Segmented from './Segmented'
import TableRegion from './TableRegion'

export default function AbsentAdvancers({
  year,
  rows,
  isArchive,
}: {
  year: number
  rows: AbsentRow[]
  isArchive: boolean
}) {
  const [tier, setTier] = useUrlParam<Tier | 'all'>('tier', 'all', ['all', ...TIERS])
  const shown = tier === 'all' ? rows : rows.filter((r) => r.tier === tier)

  return (
    <section className="absent" aria-labelledby="absent-title">
      <h2 id="absent-title" className="section-heading">
        資格がありながら未エントリー
      </h2>
      <p className="section-lede">
        準々決勝以上に進んだことのあるコンビのうち、{year}年の出場資格(結成{m1LimitYears(year)}
        年以内)があるのにエントリーの記録が無い組です。解散・活動休止のデータは持っていないので、
        「以降エントリーなし」には解散した組も入ります。
        {isArchive && ' 2001〜2010年は1回戦敗退の記録が残っていないため、実際には出場していた組が入ることがあります。'}
      </p>
      <Segmented
        label="最高到達ラウンドで絞り込む"
        options={[
          { value: 'all', label: 'すべて', count: rows.length },
          ...TIERS.map((t) => ({ value: t, label: ROUND_LABEL[t], count: rows.filter((r) => r.tier === t).length })),
        ]}
        value={tier}
        onChange={setTier}
      />
      {shown.length === 0 ? (
        <p className="page-state">該当するコンビがいません</p>
      ) : (
        <TableRegion caption={`${year}年に資格がありながら未エントリーの組(${shown.length}組・注目度順)`} captionHidden>
          <thead>
            <tr>
              <th scope="col">コンビ</th>
              <th scope="col">最高到達</th>
              <th scope="col" className="num">
                直近の出場
              </th>
              <th scope="col">状況</th>
              <th scope="col" className="num">
                注目度
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <span className="name-with-chips">
                    <CombiLink id={r.id}>{r.name}</CombiLink>
                    <FormedChip year={year} formed={r.formed} />
                    {r.champYears.length > 0 && (
                      <span className="chip chip-champion">{r.champYears.join('・')}年優勝</span>
                    )}
                  </span>
                </th>
                <td>{ROUND_LABEL[r.tier]}</td>
                <td className="num">{r.prev ?? '—'}</td>
                <td>
                  <span className={`chip chip-kind ${r.kind}`}>{KIND_LABEL[r.kind]}</span>
                  {r.kind === 'skip' && <span className="cell-note">{r.next}年に復帰</span>}
                  {r.kind === 'predebut' && r.next != null && <span className="cell-note">初出場は{r.next}年</span>}
                </td>
                <td className="num">{r.hits != null ? formatHits(r.hits) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableRegion>
      )}
    </section>
  )
}
