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
- 宣材写真は同ページの `og:image` から抽出(`photo` フィールド、`https://www.m-1gp.com/combi/` を除いた相対パスで保存)。デフォルト画像 `img_emptyPic` は写真なし扱い。表示は公式サーバーへの直リンク(複製・再配信しない)で、削除済みはonErrorで非表示
- 列挙は `list.php` 全41,018組・20件/頁。公式DBは2015年以降のみ
- 2001〜2010は `archive/{year}/` の日付別ページ(合格者のみ → 敗退者は前回戦との差分導出、1回戦敗退者は不明)
- コンビ詳細ページの `history` は公式コンビDB由来で2015年以降のみ。2001〜2010の出場は `build_json.py` の `merge_archive_history` が years/(アーカイブ)から各コンビの `history` に逆マージして表示する(id紐付けができた組のみ)
- 生HTMLは `scraper/cache/` にキャッシュ(gitignore、~2GB)。再パースはクロール不要
- レート制限: 2〜4req/s厳守
- 注目度ソートはYouTube Data APIで「コンビ名 漫才」検索した上位10本のうち、タイトル/説明文/チャンネル名/タグにコンビ名を含む動画の再生数合計(youtube_popularity.py)。このフィルタは必須 — 無いと動画の少ない組の検索結果が無関係な高再生動画で埋まり順位が壊れる。対象は3回戦以上の出場経験があるコンビ(約1,284組)。環境変数 `YOUTUBE_API_KEY` が必要で、search.listが100units/回のため無料枠(10,000units/日)では約95組/日。無料枠は日本時間16時頃(太平洋時間0時)リセット。update-popularity.yml が毎日18時(JST)に未取得優先→取得日の古い順で約95組ずつローリング更新し(全組約14日周期)、data/へのコミットで deploy.yml が発火してサイトにも自動反映される。手動実行は初回投入や緊急時のみ。work側hitsの `ids` は検索結果全件で、フィルタ規則変更時はsearch再消費なしで再集計可能(buildで配信JSONからは除去)
- 指標の変遷: Google CSEヒット件数(ウェブ全体検索が2027-01廃止予定で断念) → Wikipedia閲覧数(記事のある348組しかカバーできず変更) → M-1公式ネタ動画再生数(シーズン終了後に全動画非公開化と判明し断念) → 現在のYouTube検索ベース
- 歴代王者統計 `data/champions.json` (build_json.py `build_champions`): 各 `finals/{year}.json` の `finalRound[].champion` から優勝者を特定し、`combi` レコードの `formed`/`members[].from`/`members[].birth` を付与。年齢は「優勝年 − 生年」(全王者の誕生日は12月の決勝より前)。統計ページの都道府県別(日本地図グリッドマップ `web/src/components/JapanGridMap.tsx`。マスをタップで該当王者表示)/結成年別/年齢別が消費。2001〜2010は公式コンビDB(2015年以降のみ)に該当が無く `combiId=null` のため、`scraper/overrides/champions_meta.json`(年→{formed, members[{name,from,birth}]}、出典=Wikipedia)で補完
- 準々決勝以上進出コンビ `data/advancers.json` (build_json.py `build_advancers`): 各コンビの `history` を走査し、最高到達ラウンド(準々決勝/準決勝/決勝)で相互排他に3グループへ分割(`{tiers:[{round, combis:[{id,name,formed,firstYear,reachCount,members[{name,from,age}]}]}]}`)。「到達」は当該年 `results` に `quarterfinal`/`semifinal`/`final` キーが在ることで判定(合否不問。準々決勝の独立ラウンドは毎年は無いため3キーで判定)。`reachCount`=最高ラウンドに届いた年数、`firstYear`=初到達年、`age`=firstYear−生年。統計ページ「準々決勝以上の記録」セクション(タブ切替+都道府県別(グリッドマップ。`JapanGridMap`を再利用)/結成年別/年齢別/到達回数ランキング)が消費。都道府県別は47県を接尾辞つきフルネーム(`東京都`等)でタイル配置し件数で色分け(`web/src/lib/prefectures.ts` の座標表)。47県セット外の値(海外)は地図下チップに、`from=null`は集計時に除外。`merge_archive_history` **後** の records で集計するため 2001〜2010 も含む(ただし出身地/生年はID名寄せできた公式DB・レガシー分のみ、欠損は集計から除外)

## 注意

- `data/` を直接手編集しない(buildで上書きされる)。手動補正は `scraper/overrides/` に置く
  - `champions_meta.json` — 2001〜2010王者の出身地/結成年/生年月日(公式コンビDB未収録分の補完)
  - `legacy_combis.json` — 2001〜2010に準々決勝以上へ進出したが公式コンビDBに無い著名コンビ(千鳥・笑い飯等)の合成レコード。予約ID 900001+。`records` に投入され名寄せ→アーカイブ履歴逆マージ→詳細ページ生成。出典はWikipedia。`legacy:true`/`wikipedia` を持ち、`aliases` で全半角/綴り違いのアーカイブ名も紐付ける
  - `name_links.json` — アーカイブ名/旧名 → 既存DBコンビID。改名(鎌鼬→かまいたち、ぷくぷく隊→ヤング等)や全半角違いで名寄せが外れた組の2001〜2010出場を実ページへ紐付ける(合成コンビの重複ページ回避)。`link()` は生名・NFKC正規化名の両方で照合
  - `finals/{year}.json` — 決勝得点表を丸ごと差し替える(build_json.py が `work/finals/{year}.json` より優先して読む)。2001は第1回のみの会場審査(札幌・大阪・福岡3会場×各100人)を反映するため「会場票」1列を `大阪`/`札幌`/`福岡` の3列に分割済み(judgesの先頭3つ)。3会場合計は公式の会場票と全10組で一致することを検証済み。出典=半帖庵 http://www.hanjoan.com/project/m1.htm 。UI(`FinalsScoreTable`)は judges 配列を汎用に描画するので会場列もソート/チェックボックス対象になる
- 結果enum: pass / fail / seed_pass / fail_inferred / unknown (models.py)
