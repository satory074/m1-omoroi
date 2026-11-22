import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * `virtual:combi-pages` = 事前描画するコンビ詳細の ID の集合(最高到達が準々決勝以上 = advancers.json の全組)。
 * 事前描画(src/entry-server.tsx がページを作る)と画面(CombiLink が HTML の時点でリンクにするか決める)が
 * 同じ集合を使うので、HTML とブラウザの最初の描画が食い違わない。
 * 最初に読む JS に入るので、昇順に並べた ID の差を36進で詰める(約615組で gzip 約0.7KB。JSON の配列だと約1.4KB)。
 */
function combiPages(): Plugin {
  const id = 'virtual:combi-pages'
  const resolved = `\0${id}`
  const file = fileURLToPath(new URL('./public/data/advancers.json', import.meta.url))
  return {
    name: 'm1-combi-pages',
    resolveId: (source) => (source === id ? resolved : null),
    load(source) {
      if (source !== resolved) return null
      let ids: number[] = []
      if (existsSync(file)) {
        this.addWatchFile(file)
        const advancers = JSON.parse(readFileSync(file, 'utf8')) as { tiers: { combis: { id: number }[] }[] }
        ids = [...new Set(advancers.tiers.flatMap((t) => t.combis.map((c) => c.id)))].sort((a, b) => a - b)
      } else {
        this.warn('public/data/advancers.json がありません(copy-data 未実行)。コンビ詳細は事前描画しません')
      }
      const packed = ids.map((n, i) => (n - (i === 0 ? 0 : ids[i - 1])).toString(36)).join(',')
      return (
        `let p = 0\n` +
        `export default new Set(${JSON.stringify(packed)}.split(',').filter(Boolean).map((x) => (p += parseInt(x, 36))))\n`
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ isSsrBuild }) => ({
  base: '/m1-omoroi/',
  plugins: [react(), combiPages()],
  build: isSsrBuild
    ? // 事前描画用(src/entry-server.tsx → dist-ssr)。public/(data/ など)は写さない
      { copyPublicDir: false }
    : // どの画面がどの JS を読むかの表。scripts/prerender.mjs が決勝・記録統計のページに先読みの指示を書くのに使い、
      // 使い終わったら dist から消す(公開しない)
      { manifest: true },
}))
