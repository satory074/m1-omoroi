import { useMemo, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import LikeButton from '../components/LikeButton'
import { VideoLinks } from '../components/OfficialVideo'
import { Loading } from '../components/PageState'
import { useOfficialVideos, useYears } from '../lib/api'
import { backupHash, importLikes, likedKeys, likesSaveFailed, likesSinceBackup, useLikes } from '../lib/likes'
import { decodeLikes, parseLikeKey, type LikeRef } from '../lib/likesCodec'
import { combiVideos } from '../lib/officialVideos'
import { RESULT_DISPLAY, ROUND_LABEL, ROUND_ORDER } from '../lib/rounds'
import type { OfficialVideos, ResultKey, YearEntry, YearFile } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'

const BASE = import.meta.env.BASE_URL

interface Group {
  year: number
  round: LikeRef['round']
  refs: LikeRef[]
}

/** キーを 年(新しい順)→ 回戦(大会の順)にまとめる。回戦の中は保存した順(押した順) */
function groupKeys(keys: readonly string[]): Group[] {
  const map = new Map<string, Group>()
  for (const k of keys) {
    const ref = parseLikeKey(k)
    if (!ref) continue
    const g = `${ref.year}:${ref.round}`
    const group = map.get(g)
    if (group) group.refs.push(ref)
    else map.set(g, { year: ref.year, round: ref.round, refs: [ref] })
  }
  return [...map.values()].sort(
    (a, b) => b.year - a.year || ROUND_ORDER.indexOf(a.round) - ROUND_ORDER.indexOf(b.round),
  )
}

type EntryIndex = Map<number, Map<number, YearEntry>>

/** 読み込めた年度ファイルを 年 → コンビID → 行 にする(useYears の combine。結果が変わらなければ同じ値) */
function toEntryIndex(results: UseQueryResult<YearFile>[]): { index: EntryIndex; pending: boolean } {
  const index: EntryIndex = new Map()
  for (const r of results) {
    if (!r.data) continue
    const byId = new Map<number, YearEntry>()
    for (const e of r.data.entries) if (e.id != null) byId.set(e.id, e)
    index.set(r.data.year, byId)
  }
  return { index, pending: results.some((r) => r.isPending) }
}

/** キーに出てくる年の年度ファイルを読んで、行を引けるようにする */
function useEntryIndex(keys: readonly string[]) {
  const yearsKey = [...new Set(keys.map((k) => parseLikeKey(k)?.year ?? 0))]
    .filter(Boolean)
    .sort()
    .join(',')
  const years = useMemo(() => (yearsKey ? yearsKey.split(',').map(Number) : []), [yearsKey])
  return useYears(years, toEntryIndex)
}

function LikeList({
  keys,
  index,
  official,
  editable,
}: {
  keys: readonly string[]
  index: EntryIndex
  official: OfficialVideos | null | undefined
  /** 自分のいいね(ハートで外せる)か、リンクの中身の下見(表示だけ)か */
  editable: boolean
}) {
  const groups = groupKeys(keys)
  return (
    <div className="likes-groups">
      {groups.map((g) => {
        const byId = index.get(g.year)
        const rows = g.refs.map((ref) => ({ ref, e: byId?.get(ref.id) })).filter((r) => r.e)
        if (rows.length === 0) return null
        return (
          <section key={`${g.year}:${g.round}`} className="likes-group">
            <h2 className="section-title">
              {g.year}年 {ROUND_LABEL[g.round]}
              <span className="likes-group-count">{rows.length.toLocaleString('ja-JP')}組</span>
            </h2>
            <ul className="likes-list">
              {rows.map(({ ref, e }) => {
                const entry = e as YearEntry
                const res = entry.results[g.round] as ResultKey | undefined
                const disp = res ? RESULT_DISPLAY[res] : null
                const search = new URLSearchParams()
                if (g.round !== 'first') search.set('round', g.round)
                search.set('focus', String(ref.id))
                return (
                  <li key={ref.id} className="likes-row">
                    <Link className="likes-name" to={{ pathname: `/years/${g.year}`, search: `?${search}` }}>
                      {entry.name}
                    </Link>
                    <span className={`likes-result result-${res ?? 'unknown'}`}>
                      {disp ? (
                        <>
                          <span aria-hidden="true">{disp.sym}</span> {disp.label || entry.raw?.[g.round] || '不明'}
                        </>
                      ) : (
                        'この回戦の記録なし'
                      )}
                    </span>
                    <span className="likes-video">
                      <VideoLinks links={combiVideos(official, g.year, ref.id, g.round)} name={entry.name} />
                    </span>
                    {editable && (
                      <span className="likes-like">
                        <LikeButton
                          likeKey={`${g.year}:${g.round}:${ref.id}`}
                          label={`${entry.name}(${g.year}年 ${ROUND_LABEL[g.round]})をいいね`}
                        />
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** いいねした組の一覧と、バックアップ用リンク(作る・開いて取り込む) */
export default function LikesPage() {
  useDocumentTitle('いいね')
  const location = useLocation()
  const navigate = useNavigate()
  const likes = useLikes()
  const { data: official } = useOfficialVideos()

  // リンクで開いたときの中身(# 以降)。いいねのリンクでなければ null。途中で切れたリンクは取り込ませない
  const decoded = useMemo(() => decodeLikes(location.hash), [location.hash])
  const broken = decoded !== null && !decoded.intact
  const incoming = decoded?.intact ? decoded.keys : null
  const [imported, setImported] = useState<number | null>(null)

  // このページで外したいいねは、ページを離れるまで行を残す(押し直せるように)。開いたときの一覧を覚えておき、今の一覧に足す
  const [initial] = useState(() => likedKeys())
  const ownKeys = useMemo(
    // likes が変わったら likedKeys() も変わっている(同じ保存場所を見ている)
    () => [...likedKeys(), ...initial.filter((k) => !likes.has(k))],
    [likes, initial],
  )

  const { index, pending } = useEntryIndex(incoming ? [...ownKeys, ...incoming] : ownKeys)

  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  // 前回のバックアップに無いいいねの件数。リンクを作ると setLink で描き直されて数え直す
  const sinceBackup = likesSinceBackup([...likes])

  const makeLink = () => {
    const url = `${window.location.origin}${BASE}likes#${backupHash()}`
    setLink(url)
    return url
  }
  const copyLink = async () => {
    const url = makeLink()
    try {
      await navigator.clipboard.writeText(url)
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
  }
  const shareLink = async () => {
    const url = makeLink()
    try {
      await navigator.share({ title: 'M-1オモロイ いいねのバックアップ', url })
    } catch {
      // 閉じただけ(AbortError)も含む。リンクは下の欄に出ているので何もしない
    }
  }

  const doImport = () => {
    if (!incoming) return
    setImported(importLikes(incoming))
    // 取り込んだら # を消す(再読み込みでまた下見が出ないように)
    navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true })
  }

  const found = (keys: readonly string[]) =>
    keys.filter((k) => {
      const ref = parseLikeKey(k)
      return ref && index.get(ref.year)?.has(ref.id)
    }).length
  const missing = pending ? 0 : likes.size - found([...likes])
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <div className="likes-page">
      <h1 className="page-title">いいね</h1>
      <p className="likes-lead">
        観て気に入ったネタに付けたいいねの一覧です。年度別の一覧の各行の右端にある ♡ で付け外しできます。
      </p>

      {broken && (
        <p className="likes-warn" role="alert">
          このリンクは途中で切れているようです(最後の文字まで含めてコピーされていません)。違う組を取り込まないよう、読み込みませんでした。元のリンクを全部コピーし直してください。
        </p>
      )}

      {incoming && (
        <section className="likes-import" aria-labelledby="likes-import-title">
          <h2 id="likes-import-title" className="section-title">
            このリンクのいいね {incoming.length.toLocaleString('ja-JP')}件
          </h2>
          {(() => {
            const fresh = incoming.filter((k) => !likes.has(k)).length
            return (
              <>
                <p>
                  このブラウザに取り込むと、今のいいねに足されます(今のいいねは消えません)。うち新しく増えるのは
                  <strong> {fresh.toLocaleString('ja-JP')}件</strong>です。
                </p>
                <div className="likes-actions">
                  <button type="button" className="button button-primary" onClick={doImport}>
                    このブラウザに取り込む
                  </button>
                  <Link
                    className="button"
                    to={{ pathname: location.pathname, search: location.search, hash: '' }}
                    replace
                  >
                    取り込まない
                  </Link>
                </div>
              </>
            )
          })()}
          {pending ? <Loading /> : <LikeList keys={incoming} index={index} official={official} editable={false} />}
        </section>
      )}

      {imported !== null && (
        <p className="likes-done" role="status">
          {imported > 0 ? `${imported.toLocaleString('ja-JP')}件を取り込みました。` : '新しく増えるいいねはありませんでした。'}
        </p>
      )}

      <section className="likes-backup" aria-labelledby="likes-backup-title">
        <h2 id="likes-backup-title" className="section-title">
          バックアップ
        </h2>
        <p>
          いいねはこのブラウザの中にだけ保存されます(サーバーには送りません)。iPhone の Safari
          などでは、しばらくサイトを開かないと消えることがあります。下のリンクをメモや自分宛ての LINE
          などに残しておくと、開くだけで取り込み直せます。ほかの端末へ移すのにも使えます。
        </p>
        {likesSaveFailed() && (
          <p className="likes-warn" role="alert">
            このブラウザでは保存できませんでした(プライベートブラウズなど)。このタブを閉じると消えるので、リンクに残してください。
          </p>
        )}
        <p className="likes-since">
          {likes.size === 0
            ? 'まだいいねがありません。'
            : sinceBackup === null
              ? `まだバックアップしていません(いいね ${likes.size.toLocaleString('ja-JP')}件)。`
              : sinceBackup > 0
                ? `前回のバックアップ後に増えたいいね: ${sinceBackup.toLocaleString('ja-JP')}件`
                : '前回のバックアップ後に増えたいいねはありません。'}
        </p>
        <div className="likes-actions">
          <button type="button" className="button button-primary" onClick={copyLink} disabled={likes.size === 0}>
            バックアップ用リンクをコピー
          </button>
          {canShare && (
            <button type="button" className="button" onClick={shareLink} disabled={likes.size === 0}>
              共有…
            </button>
          )}
        </div>
        {link && (
          <div className="likes-link">
            <p role="status">
              {copied === 'copied'
                ? 'コピーしました。'
                : copied === 'failed'
                  ? 'コピーできなかったので、下の欄を長押し(または選択)してコピーしてください。'
                  : ''}
            </p>
            <label>
              <span className="sr-only">バックアップ用リンク</span>
              <input type="text" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            </label>
          </div>
        )}
      </section>

      {ownKeys.length === 0 ? (
        <p className="page-state">
          まだいいねがありません。<Link to="/years">年度別の一覧</Link>で、気に入ったネタの ♡ を押してください。
        </p>
      ) : pending ? (
        <Loading />
      ) : (
        <>
          <LikeList keys={ownKeys} index={index} official={official} editable />
          {missing > 0 && (
            <p className="legend">
              いま年度データに見当たらないいいねが {missing.toLocaleString('ja-JP')}件あります(データの修正で一時的に見えないだけのことがあるので、消さずに残しています)。
            </p>
          )}
        </>
      )}
    </div>
  )
}
