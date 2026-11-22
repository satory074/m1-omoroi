// vite.config.ts のプラグインが作るモジュールの型
declare module 'virtual:combi-pages' {
  /** 事前描画するコンビ詳細の ID(最高到達が準々決勝以上の組) */
  const ids: ReadonlySet<number>
  export default ids
}
