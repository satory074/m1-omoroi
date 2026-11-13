import { videoLabel, videoUrl } from '../lib/officialVideos'
import type { OfficialVideoLink } from '../lib/types'

/**
 * コンビの公式YouTube動画への ▶ リンク(動画が無ければ何も描かない)。
 * 年度ページの行ではコンビ名のリンクの外に置くこと(a の入れ子は不正)。
 * 動画の中身(回戦・会場・出番)はリンクの名前(aria-label)で伝える。title は使わない(スマホで見られないため)。
 */
export function VideoLinks({ links, name }: { links: OfficialVideoLink[]; name: string }) {
  if (links.length === 0) return null
  return (
    <>
      {links.map((l) => (
        <a
          key={l.v}
          className="yt-link"
          href={videoUrl(l.v)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${name}の動画を YouTube で開く(${videoLabel(l)})`}
        >
          <span className="yt-icon" aria-hidden />
        </a>
      ))}
    </>
  )
}
