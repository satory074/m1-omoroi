# CLAUDE.md

M-1グランプリのファンサイト。年度×回戦の合格者/敗退者一覧、注目度(YouTube再生数)ソート、コンビ詳細、記録ランキング、統計、決勝得点表。GitHub Pagesで公開: https://satory074.github.io/m1-omoroi/

## 構成

- `scraper/` — Python (**uv必須**)。公式サイト m-1gp.com / Wikipedia / YouTube Data API からデータ収集し `data/` にJSONを生成
- `data/` — 配信用JSONの正本(コミット対象)。スキーマは `scraper/src/m1scraper/build_json.py` 参照
- `web/` — Vite + React + TS のSPA。ビルド前に `scripts/copy-data.mjs` が `../data` → `public/data` へコピー

## コマンド

```bash
# スクレイパー (scraper/ で実行)
uv run m1 crawl-list [--year YYYY] [--detect-changed]  # list.php列挙 → work/list[_YYYY].jsonl (+ changed_YYYY.json)
uv run m1 crawl-combi [--ids F] [--limit N] [--force]  # 詳細ページ取得 → cache/combi/ (レジューム可)
uv run m1 parse-combi                # キャッシュ全件パース → work/combi.jsonl
uv run m1 detect-stale --year YYYY   # list=確定だが詳細が追随漏れのID → work/stale_YYYY.json (シーズン差分の第2パス)
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
- シーズン差分更新(`update-season.yml`)は2パス構成。**① detect-changed**: list.phpのステータス文字列が前回スナップショットから変化したIDを再取得。**② detect-stale**: list.phpは詳細ページ(meta description)より先に更新されるため、①だけでは『listが先に確定 → 後から詳細ページが確定』した組を取りこぼす(listが既に確定済みで文字列変化が起きない)。`detect-stale`はlistが確定結果を示すのに詳細パース結果が追随漏れ(`出場予定`のまま等)の組を洗い出し(`list_crawler.parse_list_status`。**listは「シード通過」・metaは「シード権獲得により通過」と表記が違う**点に注意)、第2パスで再取得する。両パスとも `parse-combi` で正本(`combi.jsonl.gz`)にマージ
- 2001〜2010は `archive/{year}/` の日付別ページ(合格者のみ → 敗退者は前回戦との差分導出、1回戦敗退者は不明)
- 決勝の最終決戦(1本目上位2〜3組の2本目後の投票)の得票 `finalRound[].votes`: 2001〜2010の公式アーカイブ `final.htm` に票数表が無いため、`wikipedia_finals.py` の `KNOWN_FINAL_ROUNDS`(2001〜2010、出典=各年Wikipedia)で手動補完。`archive_parser.parse_archive_finals` がこれを読み `champion` を最多票から算出(2001は上位2組・他は上位3組、各年合計7票)。2001は `overrides/finals/2001.json` が work を上書きするため同じ得票を override 側にも記載。フロント(`FinalsScoreTable`)は `finalRound` の進出組行を淡赤背景でハイライトし最終決戦進出ラインを可視化する
- 決勝データへのbuild時注釈(build_json.py): **① `finalAppearance`** — 全年の finals をロード後、`annotate_final_appearances` が firstRound 各行へ「その年時点で通算N回目の決勝進出」を付与(combiId優先、null行は正規化名→ID逆引きが一意なら統合・曖昧なら名前キーで独立カウント)。**② `voters`** — `overrides/final_votes.json`(年→[{name, voters[]}]、出典=各年Wikipediaの「最終決戦得票詳細」表の審査員別★印)を `merge_final_votes` が finalRound 各行へマージ。審査員名は各年 `judges` 配列の短縮表記と完全一致必須で、票数一致・judges包含・重複投票なし・全組列挙を検証し、不整合の年は丸ごとスキップ+警告(ビルドは止めない)。**新シーズンは決勝後に final_votes.json へ1年分追記する**(未追記の年はUIが票数のみ表示に自然劣化)。**③ `order`/`revival`** — 出番順は2015年以降Wikipediaの表からパース(firstRound/finalRound両方)、2001〜2010は `overrides/finals_extra.json` を `merge_finals_extra` がマージ(NFKC名前セット一致+1..Nの順列を検証、不整合はフィールド単位でスキップ+警告)。敗者復活組は `annotate_revivals` が firstRound 該当行へ `revival:true` を付与 — 2015年以降は years の `results.playoff=="pass"`(各年1組)から自動導出、2002〜2010は finals_extra の `revival`(2001年は敗者復活戦なし)。**新シーズンは order/revival とも追記不要**(自動)。フロントは点数横に審査員内順位 `(N)`、コンビ名横に `(N回目)`と敗者復活チップ、最終決戦リストのコンビ名下に投票審査員名を表示
- コンビ詳細ページの `history` は公式コンビDB由来で2015年以降のみ。2001〜2010の出場は `build_json.py` の `merge_archive_history` が years/(アーカイブ)から各コンビの `history` に逆マージして表示する(id紐付けができた組のみ)
- 生HTMLは `scraper/cache/` にキャッシュ(gitignore、~2GB)。再パースはクロール不要
- レート制限: 2〜4req/s厳守
- 注目度ソートはYouTube Data APIで「コンビ名 漫才」検索した上位10本のうち、タイトル/説明文/チャンネル名/タグにコンビ名を含む動画の再生数合計(youtube_popularity.py)。このフィルタは必須 — 無いと動画の少ない組の検索結果が無関係な高再生動画で埋まり順位が壊れる。対象は3回戦以上の出場経験があるコンビ(約1,284組)。環境変数 `YOUTUBE_API_KEY` が必要で、search.listが100units/回のため無料枠(10,000units/日)では約95組/日。無料枠は日本時間16時頃(太平洋時間0時)リセット。update-popularity.yml が毎日18時(JST)に未取得優先→取得日の古い順で約95組ずつローリング更新し(全組約14日周期)、data/へのコミットで deploy.yml が発火してサイトにも自動反映される。手動実行は初回投入や緊急時のみ。work側hitsの `ids` は検索結果全件で、フィルタ規則変更時はsearch再消費なしで再集計可能(buildで配信JSONからは除去)
- 指標の変遷: Google CSEヒット件数(ウェブ全体検索が2027-01廃止予定で断念) → Wikipedia閲覧数(記事のある348組しかカバーできず変更) → M-1公式ネタ動画再生数(シーズン終了後に全動画非公開化と判明し断念) → 現在のYouTube検索ベース
- 歴代王者統計 `data/champions.json` (build_json.py `build_champions`): 各 `finals/{year}.json` の `finalRound[].champion` から優勝者を特定し、`combi` レコードの `formed`/`members[].from`/`members[].birth` を付与。年齢は「優勝年 − 生年」(全王者の誕生日は12月の決勝より前)。統計ページの都道府県別(日本地図グリッドマップ `web/src/components/JapanGridMap.tsx`。マスをタップで該当王者表示)/結成年別/年齢別が消費。2001〜2010は公式コンビDB(2015年以降のみ)に該当が無く `combiId=null` のため、`scraper/overrides/champions_meta.json`(年→{formed, members[{name,from,birth}]}、出典=Wikipedia)で補完
- 決勝横断統計 `data/finals_stats.json` (build_json.py `build_finals_stats`): 全年の finals(order/revival注釈後)+records+champions から集計し記録ランキングページ「決勝の記録」セクションが消費。**B1 `firstRoundOrderStats`**(出番順別の出場/最終決戦進出/優勝。分母は order 判明行のみ)/**B2 `finalOrderStats`**(最終決戦の出番順別)/**B3 `championFirstRoundRank`**(王者の1本目順位分布)/**B4 `formationYears`**(結成N年=大会年−結成年 の分布。champion系列は champions.json 由来で combis 付き、final/semifinal/quarterfinal は history の(コンビ,年)イベント数。結成年不明・負値は `unknownFormed` へ)/**B5 `deviationScores`**(各年firstRound合計の年内偏差値 50+10×(x−μ)/σ(pstdev)。丸め後に同点判定、**全件**約200行)/**B6 `mostFinalRoundAppearances`**(最終決戦進出回数。表示名は公式DB現行名=改名反映)/**B7 `agencyFinals`**(事務所別延べ決勝進出。`belong` の `プロ（X）`→X 正規化、レガシーは生文字列。現在の所属で集計)/**B8 `mostFinalAppearances`・`uncrownedKings`**(全期間の決勝進出回数+wins。名寄せは `_make_final_identity`=annotate_final_appearances と共用。無冠の帝王=2回以上進出・未優勝。旧 rankings.mostFinals はこれに一本化して廃止)/**B9 `revivalStats`**(敗者復活組vsストレート組の決勝出場/最終決戦進出/優勝。制度のある2002年〜が分母+復活優勝一覧)/**B10 `championNthFinal`**(通算N回目の決勝で優勝の分布)/**B11 `debutFinalists`**(初出場で決勝。第1回2001年は全組初出場のため対象外。結成2010年以前は1回戦敗退記録が残らないため `recordedOnly` 注記)/**B12 `firstRoundMargins`**(各年1位2位の点差)/**B13 `nameLengthStats`**(コンビ名文字数(NFKC・空白除去)別のエントリー/決勝/優勝組数)。ランキング系は `_top_with_ties` で件数境界の同点を全含み(rankings.json の top30 も同様)
- ページの役割分担: `/rankings`(記録ランキング)=コンビ・人・審査員を順位付けするランキング、`/stats`(統計)=分布・傾向(決勝の傾向=FinalsTrends・審査員の年別傾向・RecordsExplorer)。決勝進出系は finals ベースで2001年からの全期間、その他の通算記録(rankings.json)はアーカイブ統合前の2015年以降。rankings.json の `longestStreaks`(連続出場)は最上位が全大会皆勤の巨大同値グループ(2026年時点87組)なのでフロントは組数+折りたたみ全組リストで表示
- 審査員統計 `data/judges_stats.json` (build_json.py `build_judges_stats`): 名寄せは `overrides/judges.json`。`career`(通算: 採点数・avgDiff=自分の点−その組への個人審査員平均の平均で負=辛口・行内最高/最低点回数(タイは全員計上)・votes/champVotes=最終決戦で優勝者に投票した数。votersマージ済み年のみ分母)/`byYear`(年別採点傾向。2001年の会場票3列は除外)/`finalVotes`(満場一致・票差。votesから全年分)。**名寄せ未収録の審査員名は警告して生表記のまま集計されるので、新シーズンはビルド警告を見て judges.json へ追記する**
- 人物統計 `data/people_stats.json` (build_json.py `build_people_stats`): 出場/決勝進出/優勝の最年少・最年長(出場=大会年−生年の近似、決勝・優勝は `overrides/finals_dates.json` の開催日基準で誕生日込み満年齢。10〜90歳範囲外は除外し `ageExcluded` で報告、人物単位で極値1件に集約)/コンビ内年齢差(自己申告ノイズ対策で準々決勝以上到達組のみ)/アマチュア(belong完全一致)・職業別(members[].job)・トリオ(members数=3。公式DBの現行登録人数なので当時と違う場合あり: 2006年決勝のザ・プラン９は当時5人)の最高到達。**新シーズンは決勝後に finals_dates.json へ開催日を1行追記**
- `data/combi/index.json` の行は `[id, 名前, かな, [出場年...], 最高到達ラウンド]` の位置対応タプル。5要素目(build_json.py `best_round`)は **0=不明 / 1..6 = `MAIN_ROUNDS`(1回戦・2回戦・3回戦・準々決勝・準決勝・決勝)**。`MAIN_ROUNDS` は `ROUND_KEYS` から `playoff` を除いたもので、フロントの `rounds.ts` `furthestRound()` と同じ意味論(敗者復活戦は本線の到達段階に数えない)。「到達」は当該年 `results` にキーが在ることで判定し合否は問わない(`build_advancers` と同基準)。分布は 不明3,271/1回戦33,040/2回戦5,326/3回戦893/準々293/準決186/決勝99(不明= `results` が空の組。大半は進行中シーズンで2026年1,875組・2025年679組。2001〜2010は `merge_archive_history` で結果が入るので不明にはならない)。人物統計の `_best_round_key` も同じ `best_round` を通す(以前は同一ロジックの写しが2箇所にあった)。int にしているのはラウンドキー文字列だとgzip後+24.5KBに対しint は+12.8KB(+1.7%)で済むため。`advancers.json` は準々決勝以上の578組しかカバーしないので検索結果の行表示には使えない
- 検索(ヘッダー常駐 `CombiSearch.tsx`)はコンビ名と**芸人の個人名**の両方を引く。個人名索引は `data/combi/members.json` (build_json.py `build_member_index`): `combi/index.json` と**同じ並び・同じ行数の位置対応配列**で、各行は `[名前, かな, 名前, かな, ...]` のフラット配列(かな欠損は空文字、名前なしの4人は除外)。全43,108組・88,315人。行にidを持たせないのはgzipで+11%になるため — 参照は `index[i]` と同じ添字で行い、行数の一致はbuildで検証して不一致なら SystemExit。約1.07MB(gz)あるので`index.json`(770KB gz)を太らせず別ファイルにしてある(index.json は PopularityRanking も無条件に読むため、混ぜると検索しない人にも課金される)。フロントは検索ボックスの**フォーカス時**に両方を並行取得し、コンビ名の結果を先に描画して芸人名セクションを後から合流させる。**正規化(NFKC・ひらがな→カタカナ・小書き仮名畳み・記号除去)はビルドで焼かずクライアント側 `web/src/lib/search.ts` で1回だけ行う** — 焼き込むと配信量が+28%になるのに対し、クライアント正規化は初回1回きり約100msで済む。かな表記は公式DB由来がカタカナ・`legacy_combis.json` 由来がひらがなで不統一なため、正規化なしでは片方しか当たらない
- 年度ページの「資格がありながら未エントリー」(`web/src/components/AbsentAdvancers.tsx`): 準々決勝以上経験の578組(advancers の3tierの和集合)のうち、その年の出場資格を満たすのにエントリー記録が無い組を一覧する。資格判定は `web/src/lib/eligibility.ts` の `isEligible`(= `m1LimitYears` 2001〜2010は10年・2015年以降は15年、`formationInfo` と共用)、エントリー有無は年度JSONの `entries` のid、区分は `entryYears` の前後年から **見送り**(前後に出場=この年だけ不参加)/**以降エントリーなし**/**初出場前** に自動分類する。ビルドに焼き込まずフロントで動的結合(advancers.json gz25KB + champions.json のみで済み、`combi/index.json` の799KBを年度ページに持ち込まないため)。**解散・活動休止のデータは公式DBに存在しない**ので「以降エントリーなし」には解散組が混ざる(UIで明示)。優勝経験組は👑を付けるが除外しない — 優勝後も資格がある間は再エントリーでき、実例もある(フットボールアワー2006・NON STYLE2009・パンクブーブー2010・令和ロマン2024)。2001〜2010はアーカイブが全エントリーを持たないため誤検出があり得る旨をその年だけ注記する
- 注目度ランキング(/rankings 内 `PopularityRanking.tsx`)はビルドに焼き込まず、フロントが popularity.json × combi/index.json × advancers.json を動的結合する(update-popularity.yml は popularity.json しかコミットせず、焼き込むと日次更新に追随しないため)。「決勝未経験の注目株」= advancers の final tier に居ない組
- 準々決勝以上進出コンビ `data/advancers.json` (build_json.py `build_advancers`): 各コンビの `history` を走査し、最高到達ラウンド(準々決勝/準決勝/決勝)で相互排他に3グループへ分割(`{tiers:[{round, combis:[{id,name,formed,firstYear,reachCount,entryYears,members[{name,from,age}]}]}]}`)。「到達」は当該年 `results` に `quarterfinal`/`semifinal`/`final` キーが在ることで判定(合否不問。準々決勝の独立ラウンドは毎年は無いため3キーで判定)。`reachCount`=最高ラウンドに届いた年数、`firstYear`=初到達年、`age`=firstYear−生年、`entryYears`=最高ラウンドと無関係な全出場年(昇順。後述の未エントリー判定用)。統計ページ「準々決勝以上の記録」セクション(タブ切替+都道府県別(グリッドマップ。`JapanGridMap`を再利用)/結成年別/年齢別/到達回数ランキング)が消費。都道府県別は47県を接尾辞つきフルネーム(`東京都`等)でタイル配置し件数で色分け(`web/src/lib/prefectures.ts` の座標表)。47県セット外の値(海外)は地図下チップに、`from=null`は集計時に除外。`merge_archive_history` **後** の records で集計するため 2001〜2010 も含む(ただし出身地/生年はID名寄せできた公式DB・レガシー分のみ、欠損は集計から除外)

## 注意

- `data/` を直接手編集しない(buildで上書きされる)。手動補正は `scraper/overrides/` に置く
  - `champions_meta.json` — 2001〜2010王者の出身地/結成年/生年月日(公式コンビDB未収録分の補完)
  - `legacy_combis.json` — 2001〜2010に準々決勝以上へ進出したが公式コンビDBに無い著名コンビ(千鳥・笑い飯等)の合成レコード。予約ID 900001+。`records` に投入され名寄せ→アーカイブ履歴逆マージ→詳細ページ生成。出典はWikipedia。`legacy:true`/`wikipedia` を持ち、`aliases` で全半角/綴り違いのアーカイブ名も紐付ける
  - `name_links.json` — アーカイブ名/旧名 → 既存DBコンビID。改名(鎌鼬→かまいたち、ぷくぷく隊→ヤング等)や全半角違いで名寄せが外れた組の2001〜2010出場を実ページへ紐付ける(合成コンビの重複ページ回避)。`link()` は生名・NFKC正規化名の両方で照合
  - `finals/{year}.json` — 決勝得点表を丸ごと差し替える(build_json.py が `work/finals/{year}.json` より優先して読む)。2001は第1回のみの会場審査(札幌・大阪・福岡3会場×各100人)を反映するため「会場票」1列を `大阪`/`札幌`/`福岡` の3列に分割済み(judgesの先頭3つ)。3会場合計は公式の会場票と全10組で一致することを検証済み。出典=半帖庵 http://www.hanjoan.com/project/m1.htm 。UI(`FinalsScoreTable`)は judges 配列を汎用に描画するので会場列もソート/チェックボックス対象になる
  - `final_votes.json` — 最終決戦の審査員別投票(年→[{name, voters[]}]、全21年分、出典=各年Wikipedia)。build が finalRound へ `voters` としてマージ(検証つき)。2001の投票は個人審査員7名のみ(会場3列は投票しない)
  - `finals_extra.json` — 2001〜2010の出番順(firstRoundOrder/finalOrder、名前→順番)と敗者復活組(revival、2002〜2010。2001年は制度なし)。出典=Wikipedia「M-1グランプリ」本体記事の各回結果表(個別年記事はリダイレクトのみ)。2001の最終決戦は表が「先攻/後攻」表記のため 1/2 に数値化して記載。2015年以降はWikipediaパース+playoff結果から自動なので追記不要
  - `judges.json` — 審査員名の名寄せ(生表記→正規名、全45表記。`ラサ｜ル石井` 等のU+FF5C表記や短縮名「礼二」「巨人」を吸収)と会場票列(`venues`: 2001の大阪/札幌/福岡)。2015年=歴代王者9名(佐藤=パンクブーブー佐藤哲夫・哲夫=笑い飯)、2025年の後藤輝基・駒場孝はORICON/お笑いナタリーの審査員発表記事で裏取り済み。新審査員はビルド警告が出たら追記。同名衝突が起きたら `byYear`(`{年}:{生表記}`)で年限定の対応を書く
  - `finals_dates.json` — 各年の決勝開催日(出典=Wikipedia)。決勝・優勝時の満年齢を誕生日込みで計算するために使用。ロード時にキー年と日付年の一致・月が11/12を検証
- 結果enum: pass / fail / seed_pass / fail_inferred / unknown (models.py)
