// ページの <title>・説明文・構造化データ(JSON-LD)を作る。ここだけに書く。
// 事前描画(src/entry-server.tsx → scripts/prerender.mjs)が HTML の <head> に入れ、
// 画面(useDocumentTitle)も同じ関数でタブの名前を付けるので、HTML と画面のタイトルが食い違わない。
import { ROUND_LABEL, bestResultLabel, bestResultOfHistory, resultLevel } from './rounds'
import type { CombiDetail, FinalsFile, MetaFile, RoundKey, YearSummary } from './types'

export const SITE_NAME = 'M-1オモロイ'
/** 公開 URL(末尾 /)。canonical・og:url・サイトマップはこれを頭に付けた絶対 URL */
export const SITE_URL = 'https://satory074.github.io/m1-omoroi/'
export const SITE_DESCRIPTION =
  'M-1グランプリの1回戦から決勝までの通過・敗退を全コンビ分たどれる非公式ファンサイト'
const HOME_TITLE = `${SITE_NAME} | M-1グランプリ全回戦の通過・敗退データベース`

/** タブ・検索結果に出る <title>。'' はトップページ */
export function fullTitle(title: string): string {
  return title ? `${title} | ${SITE_NAME}` : HOME_TITLE
}

/** サイト内のパス('/years/2025/' など)→ 絶対 URL */
export function pageUrl(path: string): string {
  return new URL(path.replace(/^\//, ''), SITE_URL).href
}

const fmt = (n: number) => n.toLocaleString('ja-JP')

// ---------- 年度ページ ----------

/** 年度ページで見ているもの。null = 回戦の指定なし(クエリの無い URL。事前描画するのはこれ) */
export type YearView = { round: RoundKey; upcoming: boolean } | 'absent' | null

export function yearTitle(year: number, view: YearView): string {
  if (view === null) return `M-1グランプリ${year} 全回戦の結果`
  if (view === 'absent') return `M-1グランプリ${year} 資格がありながら未エントリーの組`
  return `M-1グランプリ${year} ${ROUND_LABEL[view.round]}の${view.upcoming ? '日程' : '結果'}`
}

export function yearDescription(s: YearSummary): string {
  const main = s.rounds.filter((r) => r.round !== 'playoff')
  const span = main.length ? `${ROUND_LABEL[main[0].round]}〜${ROUND_LABEL[main[main.length - 1].round]}` : ''
  const who = s.source === 'official-archive' ? `公式アーカイブに残る${fmt(s.entries)}組` : `エントリー${fmt(s.entries)}組`
  const parts = [`M-1グランプリ${s.year}の結果。${who}の${span}の通過・敗退を一覧できます。`]
  if (s.champion) parts.push(`優勝は${s.champion.name}。`)
  if (s.reached.length) {
    parts.push(`${s.reached.map((g) => `${ROUND_LABEL[g.round]}${g.combis.length}組`).join('・')}の顔ぶれも載せています。`)
  }
  return parts.join('')
}

// ---------- 決勝ページ ----------

export const finalsTitle = (year: number) => `M-1グランプリ${year} 決勝の得点`

export function finalsDescription(f: FinalsFile): string {
  const champion = f.finalRound?.find((r) => r.champion)
  const total = (f.finalRound ?? []).reduce((sum, r) => sum + (r.votes ?? 0), 0)
  const parts = [`M-1グランプリ${f.year}決勝の得点表。`]
  if (champion) {
    parts.push(
      champion.votes != null && total > 0
        ? `優勝は${champion.name}(最終決戦${total}票中${champion.votes}票)。`
        : `優勝は${champion.name}。`,
    )
  }
  parts.push(`${f.firstRound.length}組のネタへの審査員別の点数と順位、最終決戦の投票を載せています。`)
  return parts.join('')
}

// ---------- コンビ詳細 ----------

/** 出場年(昇順) */
const combiYears = (c: CombiDetail) =>
  Object.keys(c.history)
    .map(Number)
    .sort((a, b) => a - b)

const yearSpan = (ys: number[]) =>
  ys.length === 0 ? '' : ys.length === 1 ? `${ys[0]}年` : `${ys[0]}〜${ys[ys.length - 1]}年`

/** 「ミルクボーイのM-1戦績(2015〜2019年、最高 優勝)」の見出し部分 */
export function combiTitle(c: CombiDetail): string {
  const best = bestResultLabel(bestResultOfHistory(c.history))
  const facts = [yearSpan(combiYears(c)), best && `最高 ${best}`].filter(Boolean).join('、')
  return facts ? `${c.name}のM-1戦績(${facts})` : `${c.name}のM-1戦績`
}

/** 画面に出ている事実(出場年・最高成績とその年・メンバー・所属)だけで書く */
export function combiDescription(c: CombiDetail): string {
  const ys = combiYears(c)
  const level = bestResultOfHistory(c.history)
  const best = bestResultLabel(level)
  const bestYears = ys.filter((y) => resultLevel(c.history[String(y)].results) === level)
  const parts = [`${c.name}のM-1グランプリの出場記録。`]
  if (ys.length) parts.push(`${yearSpan(ys)}に${ys.length}回出場`)
  if (best) parts.push(`${ys.length ? '、' : ''}最高成績は${best}(${bestYears.join('・')}年)`)
  parts.push('。')
  const names = c.members.map((m) => m.name).filter(Boolean)
  if (names.length) parts.push(`メンバーは${names.join('・')}。`)
  if (c.belong) parts.push(`所属は${c.belong}。`)
  parts.push('年ごと・回戦ごとの結果を一覧できます。')
  return parts.join('')
}

/** 構造化データの about(ページの主題のコンビ)。画面に出ている名前とメンバー名だけ */
export function combiAbout(c: CombiDetail): Record<string, unknown> {
  const names = c.members.map((m) => m.name).filter((n): n is string => !!n)
  return {
    '@type': 'PerformingGroup',
    name: c.name,
    ...(names.length ? { member: names.map((name) => ({ '@type': 'Person', name })) } : {}),
  }
}

// ---------- 記録・統計 ----------

/** 記録・統計のテーマ(パス /stats/{key}/)。label はタブ、title・description は <head> */
export const STATS_SECTIONS = [
  {
    key: '',
    label: '大会',
    title: 'M-1グランプリの記録・統計 大会',
    description: () =>
      'M-1グランプリのエントリー数の推移と年度ごとの回戦別の出場・通過数、結成年数別の到達率。',
  },
  {
    key: 'combi',
    label: 'コンビ',
    title: 'M-1グランプリの記録・統計 コンビ',
    description: () =>
      'M-1グランプリのコンビの通算記録。今年がラストイヤーの組の現在地と、準々決勝・準決勝の最多進出と準決勝の最多敗退のランキング。',
  },
  {
    key: 'finals',
    label: '決勝',
    title: 'M-1グランプリの記録・統計 決勝',
    description: (span: string) =>
      `M-1グランプリ決勝${span}の記録と傾向。最多進出・無冠の帝王・出番順の有利不利・得点の偏差値・敗者復活組の成績・決勝進出者の年齢と結成年数の推移など。`,
  },
  {
    key: 'judges',
    label: '審査員',
    title: 'M-1グランプリの記録・統計 審査員',
    description: (span: string) =>
      `M-1グランプリ決勝${span}の審査員の記録と採点の傾向。辛口・甘口、年ごとの採点の幅、審査員を1人外したときの顔ぶれ、評価が割れたネタ、最高点・最低点など。`,
  },
  {
    key: 'people',
    label: '人物',
    title: 'M-1グランプリの記録・統計 人物',
    description: () =>
      'M-1グランプリ決勝の最年少・最年長、コンビ内の年齢差、アマチュア・職業別・トリオの最高到達と、王者・準々決勝以上の組の出身地・結成年・年齢。',
  },
] as const

export type StatsSectionKey = (typeof STATS_SECTIONS)[number]['key']

/** 決勝の大会数と期間(「全21大会(2001〜2025年)」) */
export function finalsSpan(meta: MetaFile | undefined): string {
  const ys = meta?.finalsYears ?? []
  return ys.length ? `全${ys.length}大会(${ys[0]}〜${ys[ys.length - 1]}年)` : ''
}

// ---------- 構造化データ ----------

/** 作者。この @id は satory074.com 側で Person として定義している */
const AUTHOR = {
  '@type': 'Person',
  '@id': 'https://satory074.com/#person',
  name: 'satory074',
  url: 'https://satory074.com/',
} as const
const WEBSITE_ID = `${SITE_URL}#website`

/** トップは WebSite、下層は WebPage(isPartOf でトップを指す)。画面に出ている名前・説明と同じものだけを書く */
export function jsonLd(
  path: string,
  title: string,
  description: string,
  about?: Record<string, unknown>,
): Record<string, unknown> {
  const url = pageUrl(path)
  if (url === SITE_URL) {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      name: SITE_NAME,
      url,
      description,
      inLanguage: 'ja',
      author: AUTHOR,
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url,
    description,
    inLanguage: 'ja',
    isPartOf: { '@type': 'WebSite', '@id': WEBSITE_ID, name: SITE_NAME, url: SITE_URL },
    ...(about ? { about } : {}),
    author: AUTHOR,
  }
}
