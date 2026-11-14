import { Link } from 'react-router-dom'

import { sliceWithTies } from '../lib/rank'
import type { FinalsStats } from '../lib/types'
import CombiLink from './CombiLink'
import { RankTable } from './RankTable'
import HistoryTable from './HistoryTable'

function percent(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : '—'
}

const SHOWN = 15 // 各ランキングの表示件数(境界の同点はすべて表示)

/** 記録・統計「決勝」タブの前半: コンビを順位付けする決勝の記録(finals_stats.json)。後半の傾向は FinalsTrends */
export default function FinalsRecords({ fs }: { fs: FinalsStats }) {
  return (
    <>
      <div className="rank-grid">
        <section className="rank-section">
          <h3 className="section-title">決勝 最多進出</h3>
          <p className="section-note">決勝(ファーストラウンド)に進んだ回数。全21大会(2001〜2025)</p>
          <RankTable items={sliceWithTies(fs.mostFinalAppearances, SHOWN, (it) => it.value)} unit="回" />
        </section>
        <section className="rank-section">
          <h3 className="section-title">最終決戦 最多進出</h3>
          <p className="section-note">最終決戦(1本目上位2〜3組)に進んだ回数。全21大会(2001〜2025)</p>
          <RankTable
            items={sliceWithTies(fs.mostFinalRoundAppearances, SHOWN, (it) => it.value)}
            unit="回"
          />
        </section>
        <section className="rank-section">
          <h3 className="section-title">無冠の帝王(決勝最多進出・未優勝)</h3>
          <p className="section-note">決勝に2回以上進みながら優勝の無いコンビ。全21大会(2001〜2025)</p>
          <RankTable items={sliceWithTies(fs.uncrownedKings, SHOWN, (it) => it.value)} unit="回" />
        </section>
        <section className="rank-section">
          <h3 className="section-title">決勝 連続進出</h3>
          <p className="section-note">
            続けて決勝に進んだ大会数。2011〜2014年は大会が無いので、2010年と2015年は続けて数えます。
          </p>
          <RankTable
            items={sliceWithTies(fs.finalStreaks, SHOWN, (it) => it.value).map((s) => ({
              id: s.id,
              name: s.name,
              value: s.value,
              detail: `${s.start}〜${s.end}年${s.ongoing ? '・継続中' : ''}`,
            }))}
            unit="大会"
          />
          <p className="legend">
            「継続中」は最新の決勝({fs.finalStreaks.find((s) => s.ongoing)?.end ?? '—'}年)まで続いている組。
            前の大会の決勝進出者が次の大会でも決勝に来たのは、延べ{fs.repeatFinalists.pairs}組中
            {fs.repeatFinalists.back}組({percent(fs.repeatFinalists.back, fs.repeatFinalists.pairs)})です。
          </p>
        </section>
      </div>
      <p className="section-note">各ランキング上位{SHOWN}組(同点は全組表示)。</p>

      {(() => {
        const ly = fs.lastYearFinalists
        const lyChampions = ly.rows.filter((r) => r.champion).length
        return (
          <>
            <h3 className="section-title">ラストイヤーで決勝</h3>
            <p className="section-note">
              出場資格の最後の年(結成10年目・2015年からは15年目)に決勝へ進んだ組。決勝進出の延べ{ly.finalists}組中
              {ly.rows.length}組で、そのうち優勝は{lyChampions}組({percent(lyChampions, ly.rows.length)})。
              決勝進出の組全体では{ly.finalists}組中{ly.champions}組({percent(ly.champions, ly.finalists)})が優勝しています。
              {ly.rows.length < 30 && ' ラストイヤーの組は数が少ないので、この差だけで有利・不利とは言えません。'}
            </p>
            <HistoryTable caption="ラストイヤーで決勝">
              <thead>
                <tr>
                  <th scope="col">年</th>
                  <th scope="col" className="sticky-name">
                    コンビ
                  </th>
                  <th scope="col">結成</th>
                  <th scope="col">1本目</th>
                  <th scope="col">結果</th>
                </tr>
              </thead>
              <tbody>
                {[...ly.rows].reverse().map((r) => (
                  <tr key={`${r.year}-${r.name}`}>
                    <td className="no">
                      <Link to={`/finals/${r.year}`}>{r.year}</Link>
                    </td>
                    <td className="sticky-name">
                      <CombiLink id={r.combiId}>{r.name}</CombiLink>
                    </td>
                    <td className="no">{r.formed}年</td>
                    <td className="no">{r.rank}位</td>
                    <td>
                      {r.champion ? (
                        <span className="chip chip-champion">優勝</span>
                      ) : r.finalRound ? (
                        '最終決戦'
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </HistoryTable>
            <p className="legend">「1本目」はファーストラウンドの合計点の順位(同点は同順位)。</p>
          </>
        )
      })()}

      <h3 className="section-title">1人あたり平均点の歴代上位</h3>
      <p className="section-note">
        ファーストラウンドの点を審査員1人あたりの平均にしたもの。審査員の人数は年によって5〜9人と違うので、合計点のままでは比べられません。
        2001年は会場票(大阪・札幌・福岡)を除いた個人審査員7人の平均です。
      </p>
      <HistoryTable caption="1人あたり平均点の歴代上位">
        <thead>
          <tr>
            <th scope="col">順位</th>
            <th scope="col">年</th>
            <th scope="col" className="sticky-name">
              コンビ
            </th>
            <th scope="col">1人あたり</th>
            <th scope="col">合計点</th>
            <th scope="col">審査員</th>
          </tr>
        </thead>
        <tbody>
          {fs.perJudgeTop.map((r) => (
            <tr key={`${r.year}-${r.name}`}>
              <td className="no">{r.rank}</td>
              <td className="no">
                <Link to={`/finals/${r.year}`}>{r.year}</Link>
              </td>
              <td className="sticky-name">
                <CombiLink id={r.combiId}>{r.name}</CombiLink>
              </td>
              <td className="no">{r.perJudge.toFixed(2)}</td>
              <td className="no">{r.total}</td>
              <td className="no">{r.judges}人</td>
            </tr>
          ))}
        </tbody>
      </HistoryTable>

      <h3 className="section-title">初出場で決勝進出</h3>
      <p className="section-note">
        初エントリーの年にいきなり決勝へ進んだコンビ。第1回(2001年)は全組が初出場のため対象外。
        ※印は2001〜2010に1回戦敗退などの記録が残らないため「記録に残る範囲での初出場」。
      </p>
      <HistoryTable caption="初出場で決勝進出">
          <thead>
            <tr>
              <th scope="col">年</th>
              <th scope="col" className="sticky-name">コンビ</th>
            </tr>
          </thead>
          <tbody>
            {fs.debutFinalists.map((d) => (
              <tr key={`${d.year}-${d.name}`}>
                <td className="no">{d.year}</td>
                <td className="sticky-name">
                  {d.combiId != null ? <Link to={`/combi/${d.combiId}`}>{d.name}</Link> : d.name}
                  {d.recordedOnly && ' ※'}
                </td>
              </tr>
            ))}
          </tbody>
        </HistoryTable>

      <h3 className="section-title">歴代スコアランキング(得点偏差値)</h3>
      <p className="section-note">
        偏差値 = その年のファーストラウンド得点内での (得点−平均)÷標準偏差×10+50。
        審査員数・満点(2001年は1000点満点)・採点の辛さが違う年をまたいで比較するための正規化。
        全{new Set(fs.deviationScores.map((d) => d.year)).size}大会の決勝進出全組を表示。
      </p>
      {(() => {
        // 上位20件(境界の同点は全部)を見せ、残りは折り畳む。以前は 199 行を一度に出していた。
        // 折り畳みの中もブラウザのページ内検索で見つかる(<details> は検索で自動的に開く)
        const all = fs.deviationScores
        const top = sliceWithTies(all, 20, (d) => d.rank)
        const rest = all.slice(top.length)
        const table = (rows: typeof all, caption: string) => (
          <HistoryTable caption={caption}>
            <thead>
              <tr>
                <th scope="col">順位</th>
                <th scope="col">年</th>
                <th scope="col" className="sticky-name">
                  コンビ
                </th>
                <th scope="col">得点</th>
                <th scope="col">偏差値</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={`${d.year}-${d.name}`}>
                  <td className="no">{d.rank}</td>
                  <td className="no">
                    <Link to={`/finals/${d.year}`}>{d.year}</Link>
                  </td>
                  <td className="sticky-name">
                    {d.combiId != null ? <Link to={`/combi/${d.combiId}`}>{d.name}</Link> : d.name}
                  </td>
                  <td className="no">{d.total}</td>
                  <td className="no">{d.deviation.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </HistoryTable>
        )
        return (
          <>
            {table(top, `得点偏差値 上位${top.length}件`)}
            {rest.length > 0 && (
              <details className="more">
                <summary>残りの{rest.length}件を見る(全{all.length}件)</summary>
                {table(rest, `得点偏差値 ${top.length + 1}位以下`)}
              </details>
            )}
          </>
        )
      })()}
    </>
  )
}
