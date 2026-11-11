import { videoLabel, videoUrl } from '../lib/officialVideos'
import type { OfficialVideoLink } from '../lib/types'

/**
 * コンビの公式YouTube動画への ▶ リンク(動画が無ければ何も描かない)。
 * 年度ページの行ではコンビ名の <Link> の外に置くこと(a の入れ子は不正)。
 */
export function VideoLinks({ links, name }: { links: OfficialVideoLink[]; name: string }) {
  if (links.length === 0) return null
  return (
    <>
      {links.map((l) => {
        const label = videoLabel(l)
        return (
          <a
            key={l.v}
            className="yt-link"
            href={videoUrl(l.v)}
            target="_blank"
            rel="noopener noreferrer"
            title={label}
            aria-label={`${name}の動画(${label})`}
          >
            <span className="yt-icon" aria-hidden />
          </a>
        )
      })}
    </>
  )
}
