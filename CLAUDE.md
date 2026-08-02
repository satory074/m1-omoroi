# CLAUDE.md

M-1グランプリのファンサイト。年度×回戦の合格者/敗退者一覧、注目度(YouTube再生数)ソート、コンビ詳細、記録ランキング、統計、決勝得点表。GitHub Pagesで公開: https://satory074.github.io/m1-omoroi/

## 構成

- `scraper/` — Python (**uv必須**)。公式サイト m-1gp.com / Wikipedia / YouTube Data API からデータ収集し `data/` にJSONを生成
- `data/` — 配信用JSONの正本(コミット対象)。スキーマは `scraper/src/m1scraper/build_json.py` 参照
- `web/` — Vite + React + TS のSPA。ビルド前に `scripts/copy-data.mjs` が `../data` → `public/data` へコピー

## コマンド

```bash
# スクレイパー (scraper/ で実行)
uv run m1 crawl-list [--year YYYY]   # list.php列挙 → work/list.jsonl
uv run m1 crawl-combi [--limit N]    # 詳細ページ取得 → cache/combi/ (レジューム可)
uv run m1 parse-combi                # キャッシュ全件パース → work/combi.jsonl
uv run m1 crawl-archive / parse-archive  # 2001〜2010 旧アーカイブ
uv run m1 crawl-finals               # Wikipedia決勝得点表
uv run m1 fetch-popularity [--limit N]  # YouTube再生数(注目度)。要 YOUTUBE_API_KEY。通常はCIが日次実行
uv run m1 build                      # work/* → ../data/* 生成 + 整合性検証
uv run pytest

# フロント (web/ で実行)
npm run dev / npm run build
```

## データソースの要点

- コンビ詳細 `https://www.m-1gp.com/combi/{id}.html` の `<meta name="description">` に全年度成績が埋込み(combi_parser.pyが正規表現でパース)
- 列挙は `list.php` 全41,018組・20件/頁。公式DBは2015年以降のみ
- 2001〜2010は `archive/{year}/` の日付別ページ(合格者のみ → 敗退者は前回戦との差分導出、1回戦敗退者は不明)
- 生HTMLは `scraper/cache/` にキャッシュ(gitignore、~2GB)。再パースはクロール不要
- レート制限: 2〜4req/s厳守
- 注目度ソートはYouTube Data APIで「コンビ名 漫才」検索した上位10本のうち、タイトル/説明文/チャンネル名/タグにコンビ名を含む動画の再生数合計(youtube_popularity.py)。このフィルタは必須 — 無いと動画の少ない組の検索結果が無関係な高再生動画で埋まり順位が壊れる。対象は3回戦以上の出場経験があるコンビ(約1,284組)。環境変数 `YOUTUBE_API_KEY` が必要で、search.listが100units/回のため無料枠(10,000units/日)では約95組/日。無料枠は日本時間16時頃(太平洋時間0時)リセット。update-popularity.yml が毎日18時(JST)に未取得優先→取得日の古い順で約95組ずつローリング更新し(全組約14日周期)、data/へのコミットで deploy.yml が発火してサイトにも自動反映される。手動実行は初回投入や緊急時のみ。work側hitsの `ids` は検索結果全件で、フィルタ規則変更時はsearch再消費なしで再集計可能(buildで配信JSONからは除去)
- 指標の変遷: Google CSEヒット件数(ウェブ全体検索が2027-01廃止予定で断念) → Wikipedia閲覧数(記事のある348組しかカバーできず変更) → M-1公式ネタ動画再生数(シーズン終了後に全動画非公開化と判明し断念) → 現在のYouTube検索ベース

## 注意

- `data/` を直接手編集しない(buildで上書きされる)。手動補正は `scraper/overrides/` に置く
- 結果enum: pass / fail / seed_pass / fail_inferred / unknown (models.py)
