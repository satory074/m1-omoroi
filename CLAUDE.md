# CLAUDE.md

M-1グランプリのファンサイト。年度×回戦の合格者/敗退者一覧、Google検索ヒット件数ソート、コンビ詳細、記録ランキング、統計、決勝得点表。GitHub Pagesで公開: https://satory074.github.io/m1-omoroi/

## 構成

- `scraper/` — Python (**uv必須**)。公式サイト m-1gp.com / Wikipedia / Google CSE からデータ収集し `data/` にJSONを生成
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
uv run m1 fetch-popularity           # Wikipedia閲覧数(注目度)。APIキー不要
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
- 注目度ソートはWikipedia閲覧数(直近1年)。当初のGoogle CSEヒット件数案は、GoogleがCSEの「ウェブ全体を検索」を2027-01に廃止予定のため断念した経緯あり

## 注意

- `data/` を直接手編集しない(buildで上書きされる)。手動補正は `scraper/overrides/` に置く
- 結果enum: pass / fail / seed_pass / fail_inferred / unknown (models.py)
