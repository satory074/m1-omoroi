import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ isSsrBuild }) => ({
  base: '/m1-omoroi/',
  plugins: [react()],
  build: isSsrBuild
    ? // 事前描画用(src/entry-server.tsx → dist-ssr)。public/(data/ など)は写さない
      { copyPublicDir: false }
    : // どの画面がどの JS を読むかの表。scripts/prerender.mjs が決勝・記録統計のページに先読みの指示を書くのに使い、
      // 使い終わったら dist から消す(公開しない)
      { manifest: true },
}))
