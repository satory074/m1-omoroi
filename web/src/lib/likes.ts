// いいね(好みのネタの印)を、このブラウザの localStorage にだけ保存する。サーバーには送らない。
//   m1:likes        = {"v":1,"keys":["2026:third:39447", …]}  キーの形は likesCodec.ts
//   m1:likes-backup = 最後にバックアップ用リンクを作ったときの、リンクの # 以降(「その後に増えた件数」用)
// iPhone の Safari などは、サイトをしばらく開かないとスクリプトが保存したものを消す(WebKit の ITP。
// Safari を使った日で7日)。シーズンの合間に消えることを前提に、バックアップ用リンクで持ち出せるようにしている。
// プライベートブラウズ等では localStorage 自体が例外を投げるので、読み書きをすべて try/catch で包む。
// 読み込みで形式に合わないキーは捨てるが、年度データに見当たらないキーは捨てない(データの修正で一時的に
// 見えなくなっただけかもしれないので。専用ページで件数だけ出す)。

import { useSyncExternalStore } from 'react'

import { decodeLikes, encodeLikes, mergeLikes, normalizeKeys } from './likesCodec'

const STORAGE_KEY = 'm1:likes'
const BACKUP_KEY = 'm1:likes-backup'

let keys: string[] | null = null
let snapshot: ReadonlySet<string> = new Set()
/** 最後の書き込みが失敗したか(このタブの中では覚えているが、閉じると消える) */
let saveFailed = false
const listeners = new Set<() => void>()

function readStorage(): string[] {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return []
    const list = (parsed as { keys?: unknown }).keys
    return Array.isArray(list) ? normalizeKeys(list) : []
  } catch {
    return []
  }
}

function current(): string[] {
  if (keys === null) {
    keys = readStorage()
    snapshot = new Set(keys)
  }
  return keys
}

function emit() {
  for (const l of listeners) l()
}

function commit(next: string[]) {
  keys = next
  snapshot = new Set(next)
  try {
    if (next.length === 0) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, keys: next }))
    saveFailed = false
  } catch {
    // 容量超過・ストレージ無効。画面の上ではこのタブを閉じるまで覚えている
    saveFailed = true
  }
  emit()
}

// 別のタブで押したいいねにも追随する(行ごとに付けると数十個になるので、ページに1つだけ)
function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY && e.key !== null) return
  keys = null
  current()
  emit()
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): ReadonlySet<string> {
  current()
  return snapshot
}

const EMPTY: ReadonlySet<string> = new Set()

/** いいねしたキーの集合。押すたびに描き直される */
export function useLikes(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}

/** 保存した順のキーの列(専用ページ・リンク作成用) */
export function likedKeys(): readonly string[] {
  return current()
}

export function toggleLike(key: string) {
  const list = current()
  commit(list.includes(key) ? list.filter((k) => k !== key) : [...list, key])
}

/** 足し合わせて取り込む。増えた件数を返す */
export function importLikes(incoming: readonly string[]): number {
  const before = current()
  const next = mergeLikes(before, incoming)
  if (next.length !== before.length) commit(next)
  return next.length - before.length
}

/** 直前の保存が失敗したか(プライベートブラウズ等)。専用ページで知らせる */
export function likesSaveFailed(): boolean {
  return saveFailed
}

/** バックアップ用リンクの # 以降を作り、「バックアップした」と覚える */
export function backupHash(): string {
  const hash = encodeLikes(current())
  try {
    window.localStorage.setItem(BACKUP_KEY, hash)
  } catch {
    // 覚えられなくてもリンクは使える
  }
  return hash
}

/** 前回のバックアップに無いいいねの件数。バックアップしたことが無ければ null */
export function likesSinceBackup(list: readonly string[]): number | null {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(BACKUP_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  const backed = new Set(decodeLikes(raw)?.keys ?? [])
  return list.filter((k) => !backed.has(k)).length
}
