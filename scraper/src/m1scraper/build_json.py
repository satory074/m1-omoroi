"""work/* + overrides/* から配信用JSON(data/*)を生成し、整合性を検証する。

生成物:
  meta.json            スキーマ版・生成日時・年度一覧
  years/{year}.json    年度×回戦の主データ
  combi/index.json     検索用索引 [[id, 名前, かな, [出場年...], 最高到達ラウンド], ...]
                       ※ 最高到達は 0=不明 / 1..6 = MAIN_ROUNDS(1回戦〜決勝)
  combi/members.json   芸人名(メンバー)検索用索引 [[名前, かな, 名前, かな, ...], ...]
                       ※ index.json と同じ並び・同じ行数(行 i = index[i] のコンビ)
  combi/{NN}.json      詳細シャード (NN = id % 100)
  rankings.json        記録ランキング(事前集計)
  stats.json           年度別統計(事前集計)
  champions.json       歴代王者(優勝者)の集計
  advancers.json       準々決勝以上進出コンビ(最高到達ラウンド別の集計)
  popularity.json      YouTube再生数による注目度 (work/popularity.json があれば)
  finals/{year}.json   決勝得点表 (work/finals/ があれば)
"""

import json
import re
import shutil
import statistics
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone

from .config import DATA_DIR, DB_YEARS, OVERRIDES_DIR, WORK_DIR
from .models import ROUND_KEYS

SCHEMA_VERSION = 1
SHARD_COUNT = 100

PASSING = {"pass", "seed_pass", "champion"}


def _norm_name(name: str) -> str:
    """全角/半角の表記揺れを吸収した名寄せキー(NFKC正規化)。"""
    return unicodedata.normalize("NFKC", name).strip()


def _load_legacy_combis() -> list[dict]:
    """overrides/legacy_combis.json の合成コンビレコード(2001〜2010の著名組)を読む。

    公式コンビDB(2015年以降)に無い組を詳細ページ化するための手動データ。
    history は空で投入し、merge_archive_history がアーカイブ年で満たす。
    """
    path = OVERRIDES_DIR / "legacy_combis.json"
    if not path.exists():
        return []
    out = []
    for c in json.loads(path.read_text(encoding="utf-8")):
        out.append(
            {
                "id": c["id"],
                "name": c["name"],
                "kana": c.get("kana"),
                "formed": c.get("formed"),
                "formedRaw": c.get("formedRaw"),
                "belong": c.get("belong"),
                "members": c.get("members", []),
                "photo": None,
                "history": {},
                "wikipedia": c.get("wikipedia"),
                "legacy": True,
                # アーカイブ名の別表記(全半角/綴り違い)。名寄せ用でシャードには出さない
                "aliases": c.get("aliases", []),
            }
        )
    return out


def _load_combi_records() -> list[dict]:
    path = WORK_DIR / "combi.jsonl"
    if path.exists():
        return [json.loads(line) for line in path.open(encoding="utf-8")]
    gz_path = WORK_DIR / "combi.jsonl.gz"
    if gz_path.exists():
        import gzip

        with gzip.open(gz_path, "rt", encoding="utf-8") as f:
            return [json.loads(line) for line in f]
    raise SystemExit(f"{path} がありません。先に `m1 parse-combi` を実行してください")


def _write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[build] -> {path.relative_to(DATA_DIR.parent)} ({path.stat().st_size // 1024}KB)")


def build_years(records: list[dict]) -> dict[int, dict]:
    """公式DB由来の年度ファイル群を組み立てる。"""
    years: dict[int, list] = defaultdict(list)
    for rec in records:
        for year_str, entry in rec["history"].items():
            row = {
                "id": rec["id"],
                "no": entry.get("no"),
                "name": rec["name"],
                "kana": rec["kana"],
                "results": entry["results"],
            }
            if rec.get("formed") is not None:
                row["formed"] = rec["formed"]
            if entry.get("raw"):
                row["raw"] = entry["raw"]
            if rec.get("photo"):
                row["photo"] = rec["photo"]
            years[int(year_str)].append(row)

    out = {}
    for year, entries in sorted(years.items()):
        entries.sort(key=lambda r: (r["no"] is None, r["no"] or 0, r["id"]))
        out[year] = {
            "year": year,
            "source": "official-db",
            "rounds": ROUND_KEYS,
            "entries": entries,
        }
    return out


def validate_years(year_files: dict[int, dict]):
    """回戦を追うごとに人数が減ることを検証(構造変化・パース漏れの検知)。"""
    problems = []
    for year, yf in year_files.items():
        appeared = {rk: 0 for rk in ROUND_KEYS}
        passed = {rk: 0 for rk in ROUND_KEYS}
        for e in yf["entries"]:
            for rk, res in e["results"].items():
                appeared[rk] += 1
                if res in PASSING:
                    passed[rk] += 1
        # 敗者復活戦は本線と人数が独立なので単調性チェックから除外。
        # ただし決勝には敗者復活戦の勝者も進むため、その分を許容する
        chain = [rk for rk in ROUND_KEYS if rk != "playoff" and appeared[rk] > 0]
        for a, b in zip(chain, chain[1:]):
            allowed = passed[a] + (passed["playoff"] if b == "final" else 0)
            if appeared[b] > allowed:
                problems.append(
                    f"{year}: {b} 出場 {appeared[b]}人 > 前回戦通過 {allowed}人"
                )
    if problems:
        for p in problems:
            print(f"[build] 整合性警告: {p}")
    else:
        print("[build] 整合性チェックOK(回戦人数の単調減少)")
    return problems


def _top_with_ties(items: list, n: int, key=lambda it: it["value"]) -> list:
    """上位n件+境界の同値をすべて含める(件数で機械的に切らない)。itemsはソート済み前提。"""
    if len(items) <= n:
        return items
    cut = key(items[n - 1])
    end = n
    while end < len(items) and key(items[end]) == cut:
        end += 1
    return items[:end]


def _longest_streak(years: list[int]) -> tuple[int, int, int]:
    """昇順の年リストから最長連続区間 (長さ, 開始年, 終了年) を返す。同長なら最初の区間。"""
    best = (0, 0, 0)
    run_start = years[0]
    prev = None
    for y in years:
        if prev is not None and y != prev + 1:
            run_start = y
        length = y - run_start + 1
        if length > best[0]:
            best = (length, run_start, y)
        prev = y
    return best


def build_rankings(records: list[dict]) -> dict:
    def top(counter: dict[int, int], names: dict[int, str], n=30):
        ranked = sorted(counter.items(), key=lambda kv: (-kv[1], names.get(kv[0], "")))
        return _top_with_ties(
            [{"id": cid, "name": names[cid], "value": v} for cid, v in ranked], n
        )

    # 「敗退」判定は明示的な fail に加えて推定敗退(fail_inferred)も数える。
    # ランキングはアーカイブ統合前の2015年以降データで集計するため現状 fail_inferred は
    # 出現しないが、集計対象が変わっても「そのラウンドで負けた回数」の意味がぶれないようにしておく。
    # (2001〜2010は1回戦敗退者が記録に残らず、全期間集計はバイアスが出るため対象にしない。
    #  決勝進出のみ全期間データが揃うので finals_stats.mostFinalAppearances 側で集計する)
    FAILED = ("fail", "fail_inferred")

    names = {r["id"]: r["name"] for r in records}
    semifinal_fails: dict[int, int] = defaultdict(int)
    quarterfinal_up: dict[int, int] = defaultdict(int)
    first_fails: dict[int, int] = defaultdict(int)
    streaks = []

    for rec in records:
        for entry in rec["history"].values():
            res = entry["results"]
            if res.get("semifinal") in FAILED:
                semifinal_fails[rec["id"]] += 1
            if "quarterfinal" in res:
                quarterfinal_up[rec["id"]] += 1
            if res.get("first") in FAILED:
                first_fails[rec["id"]] += 1
        years = sorted(int(y) for y in rec["history"])
        if years:
            length, start, end = _longest_streak(years)
            streaks.append(
                {"id": rec["id"], "name": rec["name"], "value": length, "start": start, "end": end}
            )

    # 連続出場は最上位が「全大会皆勤」の大きな同値グループになる(2026年時点で87組)ため、
    # 通算出場回数ランキングは上位が皆勤組と完全に一致してしまい独立の意味を持たない。
    # 連続出場のみ出力し、フロントは皆勤グループを組数+全組リストで表示する。
    streaks.sort(key=lambda r: (-r["value"], r["name"]))

    return {
        "mostSemifinalFails": top(semifinal_fails, names),
        "mostQuarterfinals": top(quarterfinal_up, names),
        "mostFirstRoundFails": top(first_fails, names),
        "longestStreaks": _top_with_ties(streaks, 30),
    }


def build_stats(year_files: dict[int, dict]) -> dict:
    by_year = []
    for year, yf in sorted(year_files.items()):
        rounds = {}
        for rk in ROUND_KEYS:
            appeared = sum(1 for e in yf["entries"] if rk in e["results"])
            passed = sum(1 for e in yf["entries"] if e["results"].get(rk) in PASSING)
            if appeared:
                rounds[rk] = {"appeared": appeared, "passed": passed}
        by_year.append(
            {
                "year": year,
                "source": yf["source"],
                "entries": len(yf["entries"]),
                "byRound": rounds,
            }
        )
    return {"byYear": by_year}


def build_champions(
    finals_list: list[dict], combi_by_id: dict[int, dict], overrides: dict[str, dict]
) -> dict:
    """歴代王者(優勝者)のメタデータを集計する。

    出身地・結成年・生年月日は公式コンビDB(2015年以降のみ)由来のため、
    2001〜2010の王者は overrides/champions_meta.json で補完する。
    年齢は決勝(12月)時点の満年齢とみなし「優勝年 − 生年」で算出する
    (歴代王者はいずれも誕生日が決勝より前のため誤差なし)。
    """
    out = []
    for finals in sorted(finals_list, key=lambda f: f["year"]):
        year = finals["year"]
        champ = next((r for r in finals.get("finalRound", []) if r.get("champion")), None)
        if not champ:
            continue

        rec = combi_by_id.get(champ.get("combiId")) if champ.get("combiId") is not None else None
        ov = overrides.get(str(year), {})
        formed = rec.get("formed") if rec else None
        if formed is None:
            formed = ov.get("formed")
        members_src = (rec.get("members") if rec else None) or ov.get("members") or []

        members = []
        for m in members_src:
            birth = m.get("birth")
            age = year - int(birth[:4]) if birth and birth[:4].isdigit() else None
            members.append({"name": m.get("name"), "from": m.get("from"), "age": age})

        out.append(
            {
                "year": year,
                "name": champ["name"],
                "id": champ.get("combiId"),
                "formed": formed,
                "members": members,
            }
        )

    return {"champions": out}


# ROUND_KEYS から playoff(敗者復活戦)を除いた本線。到達段階の比較に使う。
# web/src/lib/rounds.ts の furthestRound() と同じ意味論(敗者復活戦は本線に数えない)
MAIN_ROUNDS = [rk for rk in ROUND_KEYS if rk != "playoff"]


def best_round(rec: dict) -> int:
    """全出場年を通じた最高到達ラウンド。0=不明、1..6 が MAIN_ROUNDS に対応。

    「到達」は当該年の results にそのキーが在ることで判定する(合否は問わない)。
    build_advancers と同じ判定基準。results が空の組(エントリーのみで結果が未確定。
    約3,271組で、その大半は進行中シーズン — 2026年1,875組・2025年679組)は 0 を返す。
    2001〜2010のアーカイブ由来は merge_archive_history で結果が入るので 0 にはならない。

    combi/index.json の5要素目として配る。int にしているのはラウンドキー文字列より
    gzip後で約12KB小さいため(実測: int +12.8KB / 文字列 +24.5KB)。
    """
    best = 0
    for hist in (rec.get("history") or {}).values():
        for rk in (hist.get("results") or {}):
            if rk in MAIN_ROUNDS:
                best = max(best, MAIN_ROUNDS.index(rk) + 1)
    return best


def build_member_index(records: list[dict]) -> tuple[list[list[str]], int]:
    """combi/index.json と同じ並び(id昇順)のメンバー名検索索引を作る。

    行 i は index.json の行 i と同じコンビ。各行は [名前, かな, 名前, かな, ...] の
    フラット配列(かな欠損は空文字)。名前が無いメンバーは検索できないので落とす。
    メンバーが居ない/全員名前なしのコンビも空配列の行を残す(落とすと位置がずれる)。

    各行にidを持たせない(位置対応にする)のは、持たせるとgzip後に約+11%になるため。
    消費側は index[i] を同じ添字で引けるので、idは不要。呼び出し側は index と同じ
    sorted(records, key=id) を渡すこと(行数の一致は build() で検証する)。

    正規化(NFKC・ひらがな→カタカナ等)はここでは行わない。焼き込むと配信量が
    約+28%になる一方、クライアント側の正規化は初回1回きり約100msで済むため。
    """
    out: list[list[str]] = []
    dropped = 0
    for rec in records:
        row: list[str] = []
        for m in rec.get("members") or []:
            name = (m.get("name") or "").strip()
            if not name:
                dropped += 1
                continue
            row.append(name)
            row.append((m.get("kana") or "").strip())
        out.append(row)
    return out, dropped


ADVANCER_TIERS = ["quarterfinal", "semifinal", "final"]  # 昇順(final が最上位)


def build_advancers(records: list[dict]) -> dict:
    """準々決勝以上に到達したコンビを最高到達ラウンド別に集計する。

    最高到達ラウンド(準々決勝/準決勝/決勝)で相互排他に3グループへ分割する
    (決勝到達組は決勝グループのみ)。準々決勝の独立ラウンドは毎年あるわけでは
    ないため「到達」は3キーの有無で判定する(合否は問わない)。
    出身地・生年は公式コンビDB(2015年以降)/レガシー由来のため、それ以外は欠損のまま。
    age は「初めてその最高ラウンドに到達した年 − 生年」で算出する。
    entryYears は最高ラウンドに関係ない全出場年(昇順)。年度ページの
    「資格がありながら未エントリー」判定が、その年に出たか/前後に出たかを見るのに使う。
    records は merge_archive_history 後を渡すこと(2001〜2010の出場も含める)。
    """
    tiers: dict[str, list] = {r: [] for r in ADVANCER_TIERS}
    for rec in records:
        reached: dict[str, list[int]] = {r: [] for r in ADVANCER_TIERS}
        for year_str, entry in rec.get("history", {}).items():
            res = entry.get("results", {})
            for r in ADVANCER_TIERS:
                if r in res:
                    reached[r].append(int(year_str))
        max_r = next((r for r in reversed(ADVANCER_TIERS) if reached[r]), None)
        if max_r is None:
            continue
        years = sorted(reached[max_r])
        first_year = years[0]
        members = []
        for m in rec.get("members", []):
            birth = m.get("birth")
            age = first_year - int(birth[:4]) if birth and birth[:4].isdigit() else None
            members.append({"name": m.get("name"), "from": m.get("from"), "age": age})
        tiers[max_r].append(
            {
                "id": rec["id"],
                "name": rec["name"],
                "formed": rec.get("formed"),
                "firstYear": first_year,
                "reachCount": len(years),
                "entryYears": sorted(int(y) for y in rec.get("history", {})),
                "members": members,
            }
        )
    for r in ADVANCER_TIERS:
        tiers[r].sort(key=lambda c: (c["firstYear"], c["name"]))
    # 上位ラウンドから並べる: 決勝 → 準決勝 → 準々決勝
    order = ["final", "semifinal", "quarterfinal"]
    return {"tiers": [{"round": r, "combis": tiers[r]} for r in order]}


def merge_archive_history(records: list[dict], year_files: dict[int, dict]) -> int:
    """official-archive 年度(2001〜2010)の id 付き entry を、該当コンビの history に統合する。

    公式コンビDB由来の history は2015年以降しか無いため、アーカイブ参加を逆マージして
    コンビ詳細ページに pre-2015 の出場行を表示できるようにする。戻り値は追記した行数。
    """
    by_id = {r["id"]: r for r in records}
    added = 0
    for year, yf in year_files.items():
        if yf.get("source") != "official-archive":
            continue
        for e in yf["entries"]:
            rec = by_id.get(e.get("id"))
            if rec is None:
                continue
            # アーカイブ(2001〜2010)とDB(2015+)は年が重ならない
            rec.setdefault("history", {})[str(year)] = {
                "no": e.get("no"),
                "results": e["results"],
            }
            added += 1
    return added


def _make_final_identity(all_finals: list[dict]):
    """finals の firstRound/finalRound 行 → コンビ同一性キーを返す関数を作る。

    キーは combiId 優先。null の行は全年 firstRound からの正規化名→ID逆引きが
    一意に決まる場合のみそのIDへ統合し、曖昧(同名別コンビ)や不明なら名前キーで
    独立カウントする(link() と同じく誤リンクより未リンクを優先)。
    """
    ids_by_name: dict[str, set] = defaultdict(set)
    for finals in all_finals:
        for row in finals.get("firstRound", []):
            if row.get("combiId") is not None:
                ids_by_name[_norm_name(row["name"])].add(row["combiId"])

    def identity(row: dict) -> int | str:
        key = row.get("combiId")
        if key is None:
            nm = _norm_name(row["name"])
            known = ids_by_name.get(nm, set())
            key = next(iter(known)) if len(known) == 1 else f"name:{nm}"
        return key

    return identity


def annotate_final_appearances(all_finals: list[dict]) -> None:
    """finals の firstRound 各行に finalAppearance(その年時点で通算N回目の決勝進出)を付与する。"""
    identity = _make_final_identity(all_finals)
    count: dict = defaultdict(int)
    for finals in sorted(all_finals, key=lambda f: f["year"]):
        for row in finals.get("firstRound", []):
            key = identity(row)
            count[key] += 1
            row["finalAppearance"] = count[key]


def _load_final_votes() -> dict:
    """overrides/final_votes.json(最終決戦の審査員別投票、出典=各年Wikipedia)を読む。"""
    path = OVERRIDES_DIR / "final_votes.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def merge_final_votes(all_finals: list[dict], votes_by_year: dict) -> list[str]:
    """finals の finalRound 各行へ voters(その組に投票した審査員名)をマージする。

    手入力ミス(表記違い・転記ミス)検知のため年単位で検証し、不整合があれば
    その年を丸ごとスキップして警告する(voters の有無が年内で混在しないように)。
    voters は judges 配列の並び順に正規化して格納する。
    """
    problems = []
    finals_by_year = {f["year"]: f for f in all_finals}
    for year_str, entries in sorted(votes_by_year.items()):
        year = int(year_str)
        finals = finals_by_year.get(year)
        if finals is None:
            problems.append(f"{year}: finals データが存在しない")
            continue
        final_round = finals.get("finalRound", [])
        judge_order = {j: i for i, j in enumerate(finals.get("judges", []))}
        by_name = {_norm_name(e["name"]): e for e in entries}
        errs = []
        if set(by_name) != {_norm_name(r["name"]) for r in final_round}:
            errs.append("コンビ名の集合が finalRound と一致しない(0票の組も全組列挙する)")
        all_voters = [v for e in entries for v in e["voters"]]
        if len(all_voters) != len(set(all_voters)):
            errs.append("同一審査員が複数回投票している")
        unknown = [v for v in all_voters if v not in judge_order]
        if unknown:
            errs.append(f"judges に無い審査員名: {unknown}")
        if not errs:
            for row in final_round:
                e = by_name[_norm_name(row["name"])]
                if row.get("votes") is not None and len(e["voters"]) != row["votes"]:
                    errs.append(f"{row['name']}: voters {len(e['voters'])}名 ≠ votes {row['votes']}")
        if errs:
            problems.extend(f"{year}: {e}" for e in errs)
            continue
        for row in final_round:
            row["voters"] = sorted(
                by_name[_norm_name(row["name"])]["voters"], key=judge_order.__getitem__
            )
    for p in problems:
        print(f"[build] final_votes整合性警告: {p}")
    return problems


def _load_finals_extra() -> dict:
    """overrides/finals_extra.json(2001〜2010の出番順・敗者復活、出典=Wikipedia本体記事)を読む。"""
    path = OVERRIDES_DIR / "finals_extra.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def merge_finals_extra(all_finals: list[dict], extra_by_year: dict) -> list[str]:
    """finals へ出番順(firstRoundOrder/finalOrder)をマージする。

    手入力ミス検知のため年×フィールド単位で検証し、不整合があればそのフィールドを
    スキップして警告する。検証: NFKC名前セットが当該ラウンドと一致し、値が
    1..N の順列であること。override は既存の order より優先する。
    """
    problems = []
    finals_by_year = {f["year"]: f for f in all_finals}
    for year_str, extra in sorted(extra_by_year.items()):
        year = int(year_str)
        finals = finals_by_year.get(year)
        if finals is None:
            problems.append(f"{year}: finals データが存在しない")
            continue
        for field, round_key in (("firstRoundOrder", "firstRound"), ("finalOrder", "finalRound")):
            orders = extra.get(field)
            if orders is None:
                continue
            rows = finals.get(round_key, [])
            by_name = {_norm_name(n): v for n, v in orders.items()}
            if set(by_name) != {_norm_name(r["name"]) for r in rows}:
                problems.append(f"{year}: {field} のコンビ名集合が {round_key} と一致しない")
                continue
            if sorted(by_name.values()) != list(range(1, len(rows) + 1)):
                problems.append(f"{year}: {field} の値が 1..{len(rows)} の順列でない")
                continue
            for row in rows:
                row["order"] = by_name[_norm_name(row["name"])]
    for p in problems:
        print(f"[build] finals_extra整合性警告: {p}")
    return problems


def annotate_revivals(
    all_finals: list[dict], year_files: dict[int, dict], extra_by_year: dict
) -> list[str]:
    """finals の firstRound の敗者復活組に revival: true を付与する。

    2015年以降は years の playoff 結果(pass がその年の敗者復活勝者)から自動導出し、
    2002〜2010は overrides/finals_extra.json の revival(出典=Wikipedia)を使う。
    敗者復活戦の無い2001年はどちらも無いので付与なし。改名等で決勝行と照合できない
    場合は警告してスキップする(誤マークより未マークを優先)。
    """
    problems = []
    for finals in all_finals:
        year = finals["year"]
        rows = finals.get("firstRound", [])
        target_id = None
        target_name = extra_by_year.get(str(year), {}).get("revival")
        if target_name is None:
            yf = year_files.get(year)
            if yf is None:
                continue
            winners = [
                e for e in yf["entries"] if e.get("results", {}).get("playoff") == "pass"
            ]
            if not winners:
                continue
            if len(winners) > 1:
                problems.append(f"{year}: playoff pass が {len(winners)} 組ある")
                continue
            target_id = winners[0].get("id")
            target_name = winners[0]["name"]
        row = None
        if target_id is not None:
            row = next((r for r in rows if r.get("combiId") == target_id), None)
        if row is None:
            nm = _norm_name(target_name)
            row = next((r for r in rows if _norm_name(r["name"]) == nm), None)
        if row is None:
            problems.append(f"{year}: 敗者復活 {target_name} が firstRound に見つからない")
            continue
        row["revival"] = True
    for p in problems:
        print(f"[build] revival整合性警告: {p}")
    return problems


def _find_champion_first_round(finals: dict) -> dict | None:
    """その年の優勝コンビの firstRound 行を返す(combiId優先、次にNFKC名で照合)。"""
    champ = next((r for r in finals.get("finalRound", []) if r.get("champion")), None)
    if champ is None:
        return None
    rows = finals.get("firstRound", [])
    if champ.get("combiId") is not None:
        row = next((r for r in rows if r.get("combiId") == champ["combiId"]), None)
        if row is not None:
            return row
    nm = _norm_name(champ["name"])
    return next((r for r in rows if _norm_name(r["name"]) == nm), None)


def build_finals_stats(all_finals: list[dict], records: list[dict], champions: dict) -> dict:
    """決勝データ横断の統計(data/finals_stats.json)を集計する。

    出番順・順位・偏差値は各年 finals から、結成年数は merge_archive_history 後の
    records から、優勝系列は champions.json(2001〜2010の結成年補完済み)から算出。
    出番順が不明(order null)の行・結成年不明の組は分母から除外する。
    """
    by_id = {r["id"]: r for r in records}
    finals_sorted = sorted(all_finals, key=lambda f: f["year"])

    # --- B1: 1本目出番順別(分母=orderが判明している行のみ) ---
    first_order: dict[int, dict] = defaultdict(
        lambda: {"appearances": 0, "finalists": 0, "wins": 0, "winners": []}
    )
    # --- B2: 最終決戦出番順別 ---
    final_order: dict[int, dict] = defaultdict(
        lambda: {"appearances": 0, "wins": 0, "winners": []}
    )
    # --- B3: 王者の1本目順位別 ---
    champ_rank: dict[int, dict] = defaultdict(lambda: {"count": 0, "winners": []})
    # --- B9: 敗者復活 vs ストレート(制度のある2002年以降が分母) ---
    revival_winners = []
    revival_bucket = {"appearances": 0, "finalists": 0, "wins": 0}
    straight_bucket = {"appearances": 0, "finalists": 0, "wins": 0}
    # --- B10: 通算N回目の決勝で優勝(finalAppearance注釈から) ---
    champ_nth: dict[int, dict] = defaultdict(lambda: {"count": 0, "winners": []})

    for finals in finals_sorted:
        year = finals["year"]
        finalist_ids = {
            r["combiId"] for r in finals.get("finalRound", []) if r.get("combiId") is not None
        }
        finalist_names = {_norm_name(r["name"]) for r in finals.get("finalRound", [])}
        champ_row = _find_champion_first_round(finals)
        for row in finals.get("firstRound", []):
            is_finalist = (
                row.get("combiId") in finalist_ids or _norm_name(row["name"]) in finalist_names
            )
            if year >= 2002:  # 2001年は敗者復活戦なし
                bucket = revival_bucket if row.get("revival") else straight_bucket
                bucket["appearances"] += 1
                bucket["finalists"] += is_finalist
                if row is champ_row:
                    bucket["wins"] += 1
                    if row.get("revival"):
                        revival_winners.append(
                            {"year": year, "name": row["name"], "combiId": row.get("combiId")}
                        )
            order = row.get("order")
            if order is None:
                continue
            slot = first_order[order]
            slot["appearances"] += 1
            slot["finalists"] += is_finalist
            if row is champ_row:
                slot["wins"] += 1
                slot["winners"].append(
                    {"year": year, "name": row["name"], "combiId": row.get("combiId")}
                )
        for row in finals.get("finalRound", []):
            order = row.get("order")
            if order is None:
                continue
            slot = final_order[order]
            slot["appearances"] += 1
            if row.get("champion"):
                slot["wins"] += 1
                slot["winners"].append(
                    {"year": year, "name": row["name"], "combiId": row.get("combiId")}
                )
        if champ_row is not None and champ_row.get("rank") is not None:
            r = champ_rank[champ_row["rank"]]
            r["count"] += 1
            r["winners"].append(
                {"year": year, "name": champ_row["name"], "combiId": champ_row.get("combiId")}
            )
        if champ_row is not None and champ_row.get("finalAppearance"):
            n = champ_row["finalAppearance"]
            champ_nth[n]["count"] += 1
            champ_nth[n]["winners"].append(
                {"year": year, "name": champ_row["name"], "combiId": champ_row.get("combiId")}
            )

    # --- B4: 結成年数別(結成N年 = 大会年 − 結成年。出場資格と同じ数え方) ---
    formation: dict[str, dict[int, int]] = {r: defaultdict(int) for r in ADVANCER_TIERS}
    unknown_formed = {r: 0 for r in ADVANCER_TIERS}
    for rec in records:
        formed = rec.get("formed")
        for year_str, entry in rec.get("history", {}).items():
            res = entry.get("results", {})
            for round_key in ADVANCER_TIERS:
                if round_key not in res:
                    continue
                span = int(year_str) - formed if formed is not None else None
                if span is None or span < 0:
                    unknown_formed[round_key] += 1
                else:
                    formation[round_key][span] += 1
    champion_formation: dict[int, dict] = defaultdict(lambda: {"count": 0, "combis": []})
    for ch in champions.get("champions", []):
        if ch.get("formed") is None:
            continue
        span = ch["year"] - ch["formed"]
        champion_formation[span]["count"] += 1
        champion_formation[span]["combis"].append({"year": ch["year"], "name": ch["name"]})

    # --- B5: 得点偏差値(各年firstRound内で標準化、丸め後に同点判定) ---
    deviations = []
    for finals in finals_sorted:
        rows = [r for r in finals.get("firstRound", []) if r.get("total") is not None]
        totals = [r["total"] for r in rows]
        if len(totals) < 2:
            continue
        mean = statistics.fmean(totals)
        sd = statistics.pstdev(totals)
        if sd == 0:
            continue
        for row in rows:
            deviations.append(
                {
                    "year": finals["year"],
                    "name": row["name"],
                    "combiId": row.get("combiId"),
                    "total": row["total"],
                    "deviation": round(50 + 10 * (row["total"] - mean) / sd, 1),
                    "firstRoundRank": row.get("rank"),
                }
            )
    deviations.sort(key=lambda d: (-d["deviation"], d["year"], d["name"]))
    rank = 0
    for i, d in enumerate(deviations):
        if i == 0 or d["deviation"] != deviations[i - 1]["deviation"]:
            rank = i + 1
        d["rank"] = rank

    # --- B6: 最終決戦進出回数(combiId優先、null行はNFKC名キー) ---
    fr_count: dict = defaultdict(lambda: {"value": 0, "years": [], "name": None, "id": None})
    for finals in finals_sorted:
        for row in finals.get("finalRound", []):
            cid = row.get("combiId")
            key = cid if cid is not None else f"name:{_norm_name(row['name'])}"
            slot = fr_count[key]
            slot["value"] += 1
            slot["years"].append(finals["year"])
            slot["id"] = cid
            # 表示名は公式DBの現行名(改名反映)。無ければ finals の表記
            rec = by_id.get(cid) if cid is not None else None
            slot["name"] = rec["name"] if rec else row["name"]
    fr_ranked = sorted(fr_count.values(), key=lambda s: (-s["value"], s["name"]))
    most_final_rounds = _top_with_ties(fr_ranked, 30)

    # --- B8: 全期間(2001〜)の決勝進出回数と無冠の帝王 ---
    # rankings.json の通算記録(2015年以降)と違い、決勝は全期間データが揃うのでここで集計する
    identity = _make_final_identity(all_finals)
    fa_count: dict = defaultdict(
        lambda: {"value": 0, "years": [], "wins": 0, "name": None, "id": None}
    )
    for finals in finals_sorted:
        champ = next((r for r in finals.get("finalRound", []) if r.get("champion")), None)
        champ_key = identity(champ) if champ is not None else None
        for row in finals.get("firstRound", []):
            key = identity(row)
            slot = fa_count[key]
            slot["value"] += 1
            slot["years"].append(finals["year"])
            if key == champ_key:
                slot["wins"] += 1
            cid = key if isinstance(key, int) else None
            slot["id"] = cid
            # 表示名は公式DBの現行名(改名反映)。無ければ finals の表記
            rec = by_id.get(cid) if cid is not None else None
            slot["name"] = rec["name"] if rec else row["name"]
    fa_ranked = sorted(fa_count.values(), key=lambda s: (-s["value"], s["name"]))
    most_finals_all = _top_with_ties(fa_ranked, 30)
    # 無冠の帝王: 複数回決勝に進みながら優勝なし(1回のみの組は多すぎるので対象外)
    uncrowned = [s for s in fa_ranked if s["wins"] == 0 and s["value"] >= 2]

    # --- B11: 初出場で決勝進出 ---
    # 第1回(2001年)は全組が初出場のため対象外。records は merge_archive_history 後なので
    # 2001〜2010の出場も(記録に残る範囲で)history に含まれる。1回戦敗退が記録に残らない
    # 2001〜2010に出場しえた組(結成が2010年以前)は recordedOnly=true で注記する。
    debut = []
    for finals in finals_sorted:
        year = finals["year"]
        if year == 2001:  # 第1回は全組が初出場
            continue
        for row in finals.get("firstRound", []):
            if row.get("finalAppearance") != 1:
                continue
            rec = by_id.get(row.get("combiId"))
            if rec is None or not rec.get("history"):
                continue
            if min(int(y) for y in rec["history"]) != year:
                continue
            formed = rec.get("formed")
            eligible_from = formed if formed is not None else 2001
            # 出場しえた過去大会(結成年以降)に記録不完全な2001〜2010が含まれるか
            recorded_only = max(eligible_from, 2001) <= min(2010, year - 1)
            debut.append(
                {
                    "year": year,
                    "name": row["name"],
                    "combiId": row.get("combiId"),
                    "recordedOnly": recorded_only,
                }
            )

    # --- B7: 事務所別 延べ決勝進出(belongの現行表記で集計) ---
    agency: dict[str, dict] = defaultdict(lambda: {"value": 0, "ids": set()})
    agency_excluded = 0
    for finals in finals_sorted:
        for row in finals.get("firstRound", []):
            cid = row.get("combiId")
            rec = by_id.get(cid) if cid is not None else None
            if rec is None:
                agency_excluded += 1
                continue
            belong = rec.get("belong")
            if belong is None:
                name = "不明"
            else:
                m = re.fullmatch(r"プロ（(.+)）", belong)
                name = m.group(1) if m else belong
            agency[name]["value"] += 1
            agency[name]["ids"].add(cid)
    agency_rows = [
        {"agency": name, "value": s["value"], "combis": len(s["ids"])}
        for name, s in agency.items()
    ]
    agency_rows.sort(key=lambda a: (-a["value"], a["agency"]))

    # --- B13: コンビ名の文字数と成績(「短い名前ほど優勝する」説の検証) ---
    def _name_len(name: str) -> int:
        return len(_norm_name(name).replace(" ", ""))

    name_len_counts: dict[int, dict] = defaultdict(
        lambda: {"entrants": 0, "finalists": 0, "champions": 0}
    )
    for rec in records:
        name_len_counts[_name_len(rec["name"])]["entrants"] += 1
    for slot in fa_ranked:
        ln = name_len_counts[_name_len(slot["name"])]
        ln["finalists"] += 1
        ln["champions"] += slot["wins"] > 0
    name_length_rows = [{"length": ln, **name_len_counts[ln]} for ln in sorted(name_len_counts)]

    # --- B12: 1本目の1位と2位の点差(大接戦/大差の年) ---
    margins = []
    for finals in finals_sorted:
        rows = sorted(
            (r for r in finals.get("firstRound", []) if r.get("total") is not None),
            key=lambda r: -r["total"],
        )
        if len(rows) < 2:
            continue
        margins.append(
            {
                "year": finals["year"],
                "first": {
                    "name": rows[0]["name"],
                    "combiId": rows[0].get("combiId"),
                    "total": rows[0]["total"],
                },
                "second": {
                    "name": rows[1]["name"],
                    "combiId": rows[1].get("combiId"),
                    "total": rows[1]["total"],
                },
                "margin": rows[0]["total"] - rows[1]["total"],
            }
        )

    def _slots(counter: dict[int, dict]) -> list[dict]:
        return [{"order": o, **counter[o]} for o in sorted(counter)]

    return {
        "firstRoundOrderStats": _slots(first_order),
        "finalOrderStats": _slots(final_order),
        "championFirstRoundRank": [
            {"rank": r, **champ_rank[r]} for r in sorted(champ_rank)
        ],
        "formationYears": {
            "champion": [
                {"years": y, **champion_formation[y]} for y in sorted(champion_formation)
            ],
            **{
                round_key: [
                    {"years": y, "count": c}
                    for y, c in sorted(formation[round_key].items())
                ]
                for round_key in ("final", "semifinal", "quarterfinal")
            },
            "unknownFormed": unknown_formed,
        },
        "deviationScores": deviations,
        "mostFinalRoundAppearances": most_final_rounds,
        "mostFinalAppearances": most_finals_all,
        "uncrownedKings": uncrowned,
        "championNthFinal": [{"n": n, **champ_nth[n]} for n in sorted(champ_nth)],
        "revivalStats": {
            "sinceYear": 2002,
            "winners": revival_winners,
            "revival": revival_bucket,
            "straight": straight_bucket,
        },
        "debutFinalists": debut,
        "firstRoundMargins": margins,
        "nameLengthStats": name_length_rows,
        "agencyFinals": agency_rows,
        "agencyFinalsExcluded": agency_excluded,
    }


def _parse_birth(s: str | None) -> tuple[int, int, int] | None:
    """和式の生年月日 "1970年12月04日" を (年, 月, 日) にパースする。不正は None。"""
    if not s:
        return None
    m = re.fullmatch(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s.strip())
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return None
    return (y, mo, d)


def _age_at(birth: tuple[int, int, int], on: tuple[int, int, int]) -> int:
    """on 時点の満年齢(誕生日前なら1引く)。"""
    age = on[0] - birth[0]
    if (on[1], on[2]) < (birth[1], birth[2]):
        age -= 1
    return age


def _load_finals_dates() -> dict[int, tuple[int, int, int]]:
    """overrides/finals_dates.json(年→決勝開催日、出典=Wikipedia)を読む。

    検証: キー年と日付の年が一致し、月が11または12であること。不整合は警告してスキップ。
    """
    path = OVERRIDES_DIR / "finals_dates.json"
    if not path.exists():
        return {}
    out = {}
    problems = []
    for year_str, date_str in json.loads(path.read_text(encoding="utf-8")).items():
        if year_str.startswith("_"):  # _comment 等
            continue
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", str(date_str))
        if not m:
            problems.append(f"{year_str}: 日付形式が不正: {date_str}")
            continue
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y != int(year_str) or mo not in (11, 12) or not (1 <= d <= 31):
            problems.append(f"{year_str}: 開催日 {date_str} が年と不整合")
            continue
        out[int(year_str)] = (y, mo, d)
    for p in problems:
        print(f"[build] finals_dates整合性警告: {p}")
    return out


def _best_round_key(rec: dict) -> str | None:
    """history 全年での最高到達ラウンド(キー表記)。到達なしは None。

    判定は best_round() に一本化してある。以前はここに同じロジックの写しがあったが、
    索引(combi/index.json の5要素目)と人物統計で定義が食い違う余地があったため統合した。
    """
    best = best_round(rec)
    return MAIN_ROUNDS[best - 1] if best else None


def build_people_stats(
    records: list[dict],
    all_finals: list[dict],
    champ_overrides: dict[str, dict],
    finals_dates: dict[int, tuple[int, int, int]],
) -> dict:
    """人物・キャリア統計(data/people_stats.json)を集計する。

    年齢は公式コンビDBの生年月日(自己申告・和式表記)から。出場時年齢は
    「エントリー年 − 生年」(年末時点の満年齢と同義の近似)、決勝・優勝時は
    overrides/finals_dates.json の開催日基準で誕生日込みの厳密な満年齢。
    10〜90歳のサニティ範囲外(冗談登録など)は除外し ageExcluded で件数を報告。
    最年少/最年長は人物単位で極値1件に集約(同一人物が複数年で並ばないように)。
    ageGap(コンビ内年齢差)は自己申告ノイズを避けるため準々決勝以上到達組のみ。
    records は merge_archive_history 後を渡すこと(2001〜2010の決勝も対象になる)。
    """
    by_id = {r["id"]: r for r in records}
    excluded_keys: set = set()
    AGE_MIN, AGE_MAX = 10, 90

    def sane(age: int, key) -> bool:
        if AGE_MIN <= age <= AGE_MAX:
            return True
        excluded_keys.add(key)
        return False

    def keep(store: dict, key, row: dict, smaller: bool):
        cur = store.get(key)
        if cur is None or (row["age"] < cur["age"] if smaller else row["age"] > cur["age"]):
            store[key] = row

    # --- 出場時の最年少/最年長(人物の極値は初出場年と最終出場年だけ見れば十分) ---
    app_min: dict = {}
    app_max: dict = {}
    for rec in records:
        years = sorted(int(y) for y in rec.get("history", {}))
        if not years:
            continue
        for m in rec.get("members", []):
            b = _parse_birth(m.get("birth"))
            if b is None:
                continue
            key = (m.get("name"), m.get("birth"))
            for year, store, smaller in ((years[0], app_min, True), (years[-1], app_max, False)):
                age = year - b[0]
                if not sane(age, (key, year)):
                    continue
                keep(
                    store,
                    key,
                    {
                        "age": age,
                        "member": m.get("name"),
                        "combi": rec["name"],
                        "combiId": rec["id"],
                        "year": year,
                    },
                    smaller,
                )

    # --- 決勝進出時・優勝時の最年少/最年長(開催日基準の厳密な満年齢) ---
    fin_min: dict = {}
    fin_max: dict = {}
    ch_min: dict = {}
    ch_max: dict = {}
    for finals in sorted(all_finals, key=lambda f: f["year"]):
        year = finals["year"]
        on = finals_dates.get(year, (year, 12, 31))
        champ = next((r for r in finals.get("finalRound", []) if r.get("champion")), None)
        for row in finals.get("firstRound", []):
            rec = by_id.get(row.get("combiId"))
            is_champ = champ is not None and (
                (row.get("combiId") is not None and row.get("combiId") == champ.get("combiId"))
                or _norm_name(row["name"]) == _norm_name(champ["name"])
            )
            members = rec.get("members") if rec else None
            if not members and is_champ:
                # 2001〜2010の王者で公式DB未収録の組は champions_meta.json で補完
                members = (champ_overrides.get(str(year)) or {}).get("members")
            for m in members or []:
                b = _parse_birth(m.get("birth"))
                if b is None:
                    continue
                age = _age_at(b, on)
                key = (m.get("name"), m.get("birth"))
                if not sane(age, (key, year)):
                    continue
                age_row = {
                    "age": age,
                    "member": m.get("name"),
                    "combi": row["name"],
                    "combiId": row.get("combiId"),
                    "year": year,
                }
                keep(fin_min, key, age_row, True)
                keep(fin_max, key, age_row, False)
                if is_champ:
                    keep(ch_min, key, age_row, True)
                    keep(ch_max, key, age_row, False)

    def _tops(store: dict, smaller: bool) -> list[dict]:
        rows = sorted(
            store.values(),
            key=lambda r: (r["age"] if smaller else -r["age"], r["year"], r["member"] or ""),
        )
        return _top_with_ties(rows, 10, key=lambda r: r["age"])

    # --- コンビ内の年齢差(準々決勝以上到達組のみ) ---
    gaps = []
    for rec in records:
        best = _best_round_key(rec)
        if best not in ("quarterfinal", "semifinal", "final"):
            continue
        births = [(m, _parse_birth(m.get("birth"))) for m in rec.get("members", [])]
        births = [(m, b) for m, b in births if b is not None]
        if len(births) < 2:
            continue
        births.sort(key=lambda mb: mb[1])
        first_year = min(int(y) for y in rec["history"])
        if not all(
            AGE_MIN <= first_year - b[0] <= AGE_MAX for _, b in (births[0], births[-1])
        ):
            continue
        gaps.append(
            {
                "id": rec["id"],
                "name": rec["name"],
                # 年下メンバーが生まれた時点での年上メンバーの満年齢
                "gapYears": _age_at(births[0][1], births[-1][1]),
                "older": births[0][0].get("name"),
                "younger": births[-1][0].get("name"),
                "bestRound": best,
            }
        )
    gaps.sort(key=lambda g: (-g["gapYears"], g["name"]))
    gaps = _top_with_ties(gaps, 10, key=lambda g: g["gapYears"])

    def _reach_years(rec: dict, round_key: str) -> list[int]:
        return sorted(
            {int(y) for y, e in rec["history"].items() if round_key in e.get("results", {})}
        )

    # --- アマチュアの最高到達(準々決勝以上) ---
    amateurs = []
    for rec in records:
        if rec.get("belong") != "アマチュア":
            continue
        best = _best_round_key(rec)
        if best not in ("quarterfinal", "semifinal", "final"):
            continue
        amateurs.append(
            {
                "id": rec["id"],
                "name": rec["name"],
                "bestRound": best,
                "years": _reach_years(rec, best),
            }
        )
    amateurs.sort(
        key=lambda a: (-MAIN_ROUNDS.index(a["bestRound"]), a["years"][0], a["name"])
    )

    # --- 職業別の最高到達(メンバーの job 単位。コンビは各メンバーの職業すべてに計上) ---
    jobs: dict[str, dict] = {}
    for rec in records:
        rec_jobs = {m.get("job") for m in rec.get("members", []) if m.get("job")}
        if not rec_jobs:
            continue
        best = _best_round_key(rec)
        if best is None:
            continue
        bi = MAIN_ROUNDS.index(best)
        for job in rec_jobs:
            slot = jobs.setdefault(job, {"job": job, "bestRound": best, "combis": []})
            cur = MAIN_ROUNDS.index(slot["bestRound"])
            if bi > cur:
                slot["bestRound"] = best
                slot["combis"] = []
            if bi >= cur:
                slot["combis"].append(
                    {"id": rec["id"], "name": rec["name"], "year": _reach_years(rec, best)[0]}
                )
    jobs_rows = []
    for slot in jobs.values():
        slot["combis"].sort(key=lambda c: (c["year"], c["name"]))
        slot["count"] = len(slot["combis"])
        slot["combis"] = slot["combis"][:10]
        jobs_rows.append(slot)
    jobs_rows.sort(key=lambda s: (-MAIN_ROUNDS.index(s["bestRound"]), s["job"]))

    # --- トリオ(3人組)の最高成績(3回戦以上到達のみ、4人以上のユニットは対象外) ---
    trios = []
    for rec in records:
        if len(rec.get("members", [])) != 3:
            continue
        best = _best_round_key(rec)
        if best is None or MAIN_ROUNDS.index(best) < MAIN_ROUNDS.index("third"):
            continue
        trios.append(
            {
                "id": rec["id"],
                "name": rec["name"],
                "bestRound": best,
                "years": _reach_years(rec, best),
            }
        )
    trios.sort(key=lambda t: (-MAIN_ROUNDS.index(t["bestRound"]), t["years"][0], t["name"]))
    trios = _top_with_ties(trios, 30, key=lambda t: MAIN_ROUNDS.index(t["bestRound"]))

    return {
        "ageRecords": {
            "appearance": {"youngest": _tops(app_min, True), "oldest": _tops(app_max, False)},
            "final": {"youngest": _tops(fin_min, True), "oldest": _tops(fin_max, False)},
            "champion": {"youngest": _tops(ch_min, True), "oldest": _tops(ch_max, False)},
        },
        "ageExcluded": len(excluded_keys),
        "ageGap": gaps,
        "amateur": amateurs,
        "jobs": jobs_rows,
        "trio": trios,
    }


def _load_judges_overrides() -> dict:
    """overrides/judges.json(審査員名の名寄せ・会場票列。出典=各年Wikipedia等)を読む。"""
    path = OVERRIDES_DIR / "judges.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def build_judges_stats(all_finals: list[dict], judges_ov: dict | None = None) -> dict:
    """審査員統計(data/judges_stats.json)を集計する。

    年またぎの通算(career)は overrides/judges.json の正規名で名寄せする。未収録の
    表記は警告して生表記のまま扱う(ビルドは止めない。新シーズンの新審査員検知を
    兼ねる)。2001年の会場票(大阪/札幌/福岡)は venues 指定で個人審査員の統計から
    除外する。辛口/甘口(diff)は「自分の点 − その組への個人審査員平均」の平均で、
    満点や採点の甘さが違う年をまたいでも比較できる相対値。行内の最高点/最低点は
    タイなら全員に計上。最終決戦の投票集計(votes/champVotes)は voters がマージ
    されている年のみが分母(finalVotes の満場一致/票差は votes から全年分)。
    """
    ov = judges_ov if judges_ov is not None else _load_judges_overrides()
    names_map = ov.get("names", {})
    by_year_map = ov.get("byYear", {})
    venues = ov.get("venues", {})
    problems: list[str] = []
    unresolved: set[str] = set()

    def canonical(year: int, raw: str) -> str:
        hit = by_year_map.get(f"{year}:{raw}")
        if hit is None:
            hit = names_map.get(raw) or names_map.get(_norm_name(raw))
        if hit is not None:
            return hit
        if raw not in unresolved:
            unresolved.add(raw)
            problems.append(f"{year}: 審査員名寄せ未収録: {raw} (生表記のまま集計)")
        return raw

    career: dict[str, dict] = defaultdict(
        lambda: {
            "years": set(),
            "scored": 0,
            "diff_sum": 0.0,
            "topCount": 0,
            "lowCount": 0,
            "votes": 0,
            "champVotes": 0,
        }
    )
    by_year_rows = []
    final_votes_rows = []

    for finals in sorted(all_finals, key=lambda f: f["year"]):
        year = finals["year"]
        venue_set = set(venues.get(str(year), []))
        cols = [
            (i, raw, canonical(year, raw))
            for i, raw in enumerate(finals.get("judges", []))
            if raw not in venue_set
        ]
        per_col: dict[int, dict] = {
            i: {"scores": [], "diffs": [], "top": 0, "low": 0} for i, _, _ in cols
        }
        for row in finals.get("firstRound", []):
            scores = row.get("scores") or []
            vals = [
                (i, scores[i]) for i, _, _ in cols if i < len(scores) and scores[i] is not None
            ]
            if len(vals) < 2:
                continue
            row_mean = statistics.fmean(v for _, v in vals)
            mx = max(v for _, v in vals)
            mn = min(v for _, v in vals)
            for i, v in vals:
                pc = per_col[i]
                pc["scores"].append(v)
                pc["diffs"].append(v - row_mean)
                pc["top"] += v == mx
                pc["low"] += v == mn
        year_judges = []
        all_scores = [v for pc in per_col.values() for v in pc["scores"]]
        for i, raw, canon in cols:
            pc = per_col[i]
            if not pc["scores"]:
                continue
            year_judges.append(
                {
                    "name": raw,
                    "canonical": canon,
                    "mean": round(statistics.fmean(pc["scores"]), 1),
                    "diff": round(statistics.fmean(pc["diffs"]), 1),
                    "top": pc["top"],
                    "low": pc["low"],
                    "max": max(pc["scores"]),
                    "min": min(pc["scores"]),
                }
            )
            c = career[canon]
            c["years"].add(year)
            c["scored"] += len(pc["scores"])
            c["diff_sum"] += sum(pc["diffs"])
            c["topCount"] += pc["top"]
            c["lowCount"] += pc["low"]
        if year_judges:
            by_year_rows.append(
                {
                    "year": year,
                    "judgeMean": round(statistics.fmean(all_scores), 1),
                    "judges": year_judges,
                }
            )
        final_round = finals.get("finalRound", [])
        champ = next((r for r in final_round if r.get("champion")), None)
        votes_list = sorted(
            (r["votes"] for r in final_round if r.get("votes") is not None), reverse=True
        )
        if champ is not None and votes_list:
            final_votes_rows.append(
                {
                    "year": year,
                    "champion": champ["name"],
                    "championCombiId": champ.get("combiId"),
                    "votes": votes_list,
                    "unanimous": votes_list[0] == sum(votes_list),
                    "margin": votes_list[0] - (votes_list[1] if len(votes_list) > 1 else 0),
                }
            )
        if final_round and all("voters" in r for r in final_round):
            for r in final_round:
                for v in r["voters"]:
                    c = career[canonical(year, v)]
                    c["votes"] += 1
                    c["champVotes"] += bool(r.get("champion"))

    career_rows = []
    for name, c in sorted(career.items()):
        career_rows.append(
            {
                "name": name,
                "years": sorted(c["years"]),
                "yearCount": len(c["years"]),
                "scored": c["scored"],
                "avgDiff": round(c["diff_sum"] / c["scored"], 2) if c["scored"] else None,
                "topCount": c["topCount"],
                "lowCount": c["lowCount"],
                "votes": c["votes"],
                "champVotes": c["champVotes"],
            }
        )
    career_rows.sort(key=lambda r: (-r["yearCount"], r["name"]))

    for p in problems:
        print(f"[build] judges整合性警告: {p}")

    return {
        "career": career_rows,
        "byYear": by_year_rows,
        "finalVotes": final_votes_rows,
        "venueColumns": venues,
    }


def _make_linker(records: list[dict]):
    """コンビ名 → ID の紐付け。一意に決まる場合のみ返す(誤リンクより未リンクを優先)。"""
    by_name: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        by_name[rec["name"]].append(rec)

    overrides_path = OVERRIDES_DIR / "name_links.json"
    overrides: dict[str, int | None] = {}
    if overrides_path.exists():
        overrides = json.loads(overrides_path.read_text(encoding="utf-8"))

    def link(name: str, year: int | None = None) -> int | None:
        nm = _norm_name(name)
        # 手動リンク(name_links.json)は生名・正規化名の両方で照合(全半角/改名の吸収)
        for key in (f"{year}:{name}", name, f"{year}:{nm}", nm):
            if key in overrides:
                return overrides[key]
        cands = by_name.get(name, [])
        if year is not None:
            cands = [r for r in cands if not r.get("formed") or r["formed"] <= year]
        return cands[0]["id"] if len(cands) == 1 else None

    return link


def build():
    records = _load_combi_records()
    print(f"[build] コンビ {len(records)}件")

    # 2001〜2010の著名コンビ(公式DB未収録)を合成レコードとして投入。
    # _make_linker より前に追加することで、アーカイブ参加が名前で紐付き、
    # merge_archive_history で history が満たされ、シャード/索引に詳細ページが生成される。
    legacy_records = _load_legacy_combis()
    records.extend(legacy_records)
    legacy_by_norm = {_norm_name(r["name"]): r for r in legacy_records}
    for r in legacy_records:
        for alias in r.get("aliases", []):
            legacy_by_norm.setdefault(_norm_name(alias), r)
    if legacy_records:
        print(f"[build] 合成コンビ(2001〜2010) {len(legacy_records)}件を投入")

    year_files = build_years(records)
    link = _make_linker(records)

    # 旧アーカイブ年度(work/archive_years.json)をマージし、名前でコンビIDを紐付け
    archive_path = WORK_DIR / "archive_years.json"
    if archive_path.exists():
        photo_by_id = {r["id"]: r["photo"] for r in records if r.get("photo")}
        formed_by_id = {r["id"]: r["formed"] for r in records if r.get("formed") is not None}
        archive_years = json.loads(archive_path.read_text(encoding="utf-8"))
        for year_str, yf in archive_years.items():
            linked = 0
            for e in yf["entries"]:
                e["id"] = link(e["name"], int(year_str))
                # 名前が全半角違いで link() が外した場合、合成コンビには正規化名で紐付ける
                # (結成年より前の年=同名別コンビ/アーカイブのノイズは弾く)
                if e["id"] is None:
                    lr = legacy_by_norm.get(_norm_name(e["name"]))
                    if lr is not None and (not lr.get("formed") or lr["formed"] <= int(year_str)):
                        e["id"] = lr["id"]
                linked += e["id"] is not None
                if e["id"] in photo_by_id:
                    e["photo"] = photo_by_id[e["id"]]
                if e["id"] in formed_by_id:
                    e["formed"] = formed_by_id[e["id"]]
            year_files[int(year_str)] = yf
            print(f"[build] {year_str}: アーカイブ {len(yf['entries'])}組 (ID紐付け {linked}組)")

    validate_years({y: yf for y, yf in year_files.items() if yf["source"] == "official-db"})

    # ランキングはアーカイブ統合前に集計(「2015年以降の通算記録」の意味を維持)
    rankings = build_rankings(records)
    # 2001〜2010のアーカイブ参加を該当コンビの history に逆マージ(詳細ページで pre-2015 を表示)
    merged = merge_archive_history(records, year_files)
    print(f"[build] アーカイブ参加を {merged} 行 combi履歴へ統合")

    # 準々決勝以上の進出コンビを最高到達ラウンド別に集計(2001〜2010のマージ済み history を含める)
    advancers = build_advancers(records)

    if DATA_DIR.exists():
        shutil.rmtree(DATA_DIR)

    for year, yf in year_files.items():
        _write(DATA_DIR / "years" / f"{year}.json", yf)

    # 検索用索引と詳細シャード
    sorted_records = sorted(records, key=lambda r: r["id"])
    index = []
    shards: dict[int, dict] = defaultdict(dict)
    for rec in sorted_records:
        entered_years = sorted(int(y) for y in rec["history"])
        index.append([rec["id"], rec["name"], rec["kana"], entered_years, best_round(rec)])
        shard = {
            "name": rec["name"],
            "kana": rec["kana"],
            "formed": rec.get("formed"),
            "formedRaw": rec.get("formedRaw"),
            "belong": rec.get("belong"),
            "members": rec.get("members", []),
            "photo": rec.get("photo"),
            "history": rec["history"],
        }
        if rec.get("legacy"):
            # 合成コンビ(2001〜2010)は公式コンビページが無いのでWikipediaへ誘導
            shard["legacy"] = True
            shard["wikipedia"] = rec.get("wikipedia")
        else:
            shard["officialUrl"] = f"https://www.m-1gp.com/combi/{rec['id']}.html"
        shards[rec["id"] % SHARD_COUNT][str(rec["id"])] = shard
    _write(DATA_DIR / "combi" / "index.json", index)

    # 芸人名検索用のメンバー索引。index.json と位置対応なので行数がずれたら致命的
    member_index, dropped_members = build_member_index(sorted_records)
    if len(member_index) != len(index):
        raise SystemExit(
            f"[build] members.json と index.json の行数がずれています "
            f"({len(member_index)} != {len(index)})"
        )
    _write(DATA_DIR / "combi" / "members.json", member_index)

    # best_round と build_advancers は「準々決勝以上」の判定を独立に持つので、
    # 定義がずれたら気付けるよう組数の一致を検証する(どちらも 578 組のはず)
    adv_count = sum(len(t["combis"]) for t in advancers["tiers"])
    idx_count = sum(1 for row in index if row[4] >= 4)
    if adv_count != idx_count:
        raise SystemExit(
            f"[build] 準々決勝以上の組数が advancers.json({adv_count})と "
            f"index.json の最高到達({idx_count})で食い違っています"
        )
    print(
        f"[build] メンバー索引 {sum(len(r) // 2 for r in member_index):,}人 / "
        f"{len(member_index):,}組 (名前なしで除外 {dropped_members}人)"
    )

    for nn, shard in shards.items():
        _write(DATA_DIR / "combi" / f"{nn}.json", shard)

    _write(DATA_DIR / "rankings.json", rankings)
    _write(DATA_DIR / "stats.json", build_stats(year_files))

    pop_path = WORK_DIR / "popularity.json"
    if pop_path.exists():
        pop = json.loads(pop_path.read_text(encoding="utf-8"))
        # ids は再集計用の作業データなので配信には含めない
        for hit in pop.get("hits", {}).values():
            hit.pop("ids", None)
        _write(DATA_DIR / "popularity.json", pop)

    finals_dir = WORK_DIR / "finals"
    finals_years = []
    all_finals = []
    if finals_dir.exists():
        for f in sorted(finals_dir.glob("*.json")):
            override = OVERRIDES_DIR / "finals" / f.name
            src = override if override.exists() else f
            finals = json.loads(src.read_text(encoding="utf-8"))
            for row in finals.get("firstRound", []) + finals.get("finalRound", []):
                row["combiId"] = link(row["name"], finals["year"])
            finals_years.append(int(f.stem))
            all_finals.append(finals)
        # 全年ロード後の注釈(通算進出回数は年横断の情報が必要)
        annotate_final_appearances(all_finals)
        merge_final_votes(all_finals, _load_final_votes())
        finals_extra = _load_finals_extra()
        merge_finals_extra(all_finals, finals_extra)
        annotate_revivals(all_finals, year_files, finals_extra)
        for finals in all_finals:
            _write(DATA_DIR / "finals" / f"{finals['year']}.json", finals)

    # 歴代王者(優勝者)の集計。出身地/結成年/生年月日は公式コンビDB(2015年以降)由来のため、
    # 2001〜2010は overrides/champions_meta.json で補完する
    combi_by_id = {r["id"]: r for r in records}
    champ_meta_path = OVERRIDES_DIR / "champions_meta.json"
    champ_overrides = (
        json.loads(champ_meta_path.read_text(encoding="utf-8")) if champ_meta_path.exists() else {}
    )
    champions_data = build_champions(all_finals, combi_by_id, champ_overrides)
    _write(DATA_DIR / "champions.json", champions_data)
    _write(DATA_DIR / "advancers.json", advancers)

    # 人物・キャリア統計(年齢記録・コンビ内年齢差・アマチュア・職業別・トリオ)
    _write(
        DATA_DIR / "people_stats.json",
        build_people_stats(records, all_finals, champ_overrides, _load_finals_dates()),
    )

    # 決勝データ横断の統計(出番順・順位・偏差値・最終決戦進出・事務所別)
    if all_finals:
        _write(
            DATA_DIR / "finals_stats.json",
            build_finals_stats(all_finals, records, champions_data),
        )
        # 審査員統計(名寄せ・採点傾向・最終決戦の投票)
        _write(DATA_DIR / "judges_stats.json", build_judges_stats(all_finals))

    _write(
        DATA_DIR / "meta.json",
        {
            "schemaVersion": SCHEMA_VERSION,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "years": sorted(year_files),
            "latestYear": max(year_files) if year_files else None,
            "finalsYears": finals_years,
        },
    )
    print("[build] 完了")
