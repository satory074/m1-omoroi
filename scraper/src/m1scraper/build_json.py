"""work/* + overrides/* から配信用JSON(data/*)を生成し、整合性を検証する。

生成物:
  meta.json            スキーマ版・生成日時・年度一覧
  years/{year}.json    年度×回戦の主データ
  combi/index.json     検索用索引 [[id, 名前, かな, [出場年...]], ...]
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


def build_rankings(records: list[dict]) -> dict:
    def top(counter: dict[int, int], names: dict[int, str], n=30):
        ranked = sorted(counter.items(), key=lambda kv: (-kv[1], names.get(kv[0], "")))
        return _top_with_ties(
            [{"id": cid, "name": names[cid], "value": v} for cid, v in ranked], n
        )

    # 「敗退」判定は明示的な fail に加えて推定敗退(fail_inferred)も数える。
    # ランキングはアーカイブ統合前の2015年以降データで集計するため現状 fail_inferred は
    # 出現しないが、集計対象が変わっても「そのラウンドで負けた回数」の意味がぶれないようにしておく。
    FAILED = ("fail", "fail_inferred")

    names = {r["id"]: r["name"] for r in records}
    semifinal_fails: dict[int, int] = defaultdict(int)
    quarterfinal_up: dict[int, int] = defaultdict(int)
    finals: dict[int, int] = defaultdict(int)
    first_fails: dict[int, int] = defaultdict(int)

    for rec in records:
        for entry in rec["history"].values():
            res = entry["results"]
            if res.get("semifinal") in FAILED:
                semifinal_fails[rec["id"]] += 1
            if "quarterfinal" in res:
                quarterfinal_up[rec["id"]] += 1
            if "final" in res:
                finals[rec["id"]] += 1
            if res.get("first") in FAILED:
                first_fails[rec["id"]] += 1

    return {
        "mostSemifinalFails": top(semifinal_fails, names),
        "mostQuarterfinals": top(quarterfinal_up, names),
        "mostFinals": top(finals, names),
        "mostFirstRoundFails": top(first_fails, names),
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


ADVANCER_TIERS = ["quarterfinal", "semifinal", "final"]  # 昇順(final が最上位)


def build_advancers(records: list[dict]) -> dict:
    """準々決勝以上に到達したコンビを最高到達ラウンド別に集計する。

    最高到達ラウンド(準々決勝/準決勝/決勝)で相互排他に3グループへ分割する
    (決勝到達組は決勝グループのみ)。準々決勝の独立ラウンドは毎年あるわけでは
    ないため「到達」は3キーの有無で判定する(合否は問わない)。
    出身地・生年は公式コンビDB(2015年以降)/レガシー由来のため、それ以外は欠損のまま。
    age は「初めてその最高ラウンドに到達した年 − 生年」で算出する。
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

    for finals in finals_sorted:
        year = finals["year"]
        finalist_ids = {
            r["combiId"] for r in finals.get("finalRound", []) if r.get("combiId") is not None
        }
        finalist_names = {_norm_name(r["name"]) for r in finals.get("finalRound", [])}
        champ_row = _find_champion_first_round(finals)
        for row in finals.get("firstRound", []):
            order = row.get("order")
            if order is None:
                continue
            slot = first_order[order]
            slot["appearances"] += 1
            is_finalist = (
                row.get("combiId") in finalist_ids or _norm_name(row["name"]) in finalist_names
            )
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
        "agencyFinals": agency_rows,
        "agencyFinalsExcluded": agency_excluded,
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
    index = []
    shards: dict[int, dict] = defaultdict(dict)
    for rec in sorted(records, key=lambda r: r["id"]):
        entered_years = sorted(int(y) for y in rec["history"])
        index.append([rec["id"], rec["name"], rec["kana"], entered_years])
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

    # 決勝データ横断の統計(出番順・順位・偏差値・最終決戦進出・事務所別)
    if all_finals:
        _write(
            DATA_DIR / "finals_stats.json",
            build_finals_stats(all_finals, records, champions_data),
        )

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
