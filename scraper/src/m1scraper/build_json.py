"""work/* + overrides/* から配信用JSON(data/*)を生成し、整合性を検証する。

生成物:
  meta.json            スキーマ版・生成日時・年度一覧
  years/{year}.json    年度×回戦の主データ
  combi/index.json     検索用索引 [[id, 名前, かな, [出場年...]], ...]
  combi/{NN}.json      詳細シャード (NN = id % 100)
  rankings.json        記録ランキング(事前集計)
  stats.json           年度別統計(事前集計)
  popularity.json      CSEヒット件数 (work/popularity.json があれば)
  finals/{year}.json   決勝得点表 (work/finals/ があれば)
"""

import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone

from .config import DATA_DIR, DB_YEARS, OVERRIDES_DIR, WORK_DIR
from .models import ROUND_KEYS

SCHEMA_VERSION = 1
SHARD_COUNT = 100

PASSING = {"pass", "seed_pass", "champion"}


def _load_combi_records() -> list[dict]:
    path = WORK_DIR / "combi.jsonl"
    if not path.exists():
        raise SystemExit(f"{path} がありません。先に `m1 parse-combi` を実行してください")
    return [json.loads(line) for line in path.open(encoding="utf-8")]


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
            if entry.get("raw"):
                row["raw"] = entry["raw"]
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
        # 敗者復活戦は本線と人数が独立なので単調性チェックから除外
        chain = [rk for rk in ROUND_KEYS if rk != "playoff" and appeared[rk] > 0]
        for a, b in zip(chain, chain[1:]):
            if appeared[b] > passed[a]:
                problems.append(
                    f"{year}: {b} 出場 {appeared[b]}人 > {a} 通過 {passed[a]}人"
                )
    if problems:
        for p in problems:
            print(f"[build] 整合性警告: {p}")
    else:
        print("[build] 整合性チェックOK(回戦人数の単調減少)")
    return problems


def build_rankings(records: list[dict]) -> dict:
    def top(counter: dict[int, int], names: dict[int, str], n=30):
        ranked = sorted(counter.items(), key=lambda kv: (-kv[1], names.get(kv[0], "")))[:n]
        return [{"id": cid, "name": names[cid], "value": v} for cid, v in ranked]

    names = {r["id"]: r["name"] for r in records}
    appearances: dict[int, int] = defaultdict(int)
    semifinal_fails: dict[int, int] = defaultdict(int)
    quarterfinal_up: dict[int, int] = defaultdict(int)
    finals: dict[int, int] = defaultdict(int)
    first_fails: dict[int, int] = defaultdict(int)

    for rec in records:
        for entry in rec["history"].values():
            res = entry["results"]
            appearances[rec["id"]] += 1
            if res.get("semifinal") == "fail":
                semifinal_fails[rec["id"]] += 1
            if "quarterfinal" in res:
                quarterfinal_up[rec["id"]] += 1
            if "final" in res:
                finals[rec["id"]] += 1
            if res.get("first") == "fail":
                first_fails[rec["id"]] += 1

    return {
        "mostAppearances": top(appearances, names),
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
        key = f"{year}:{name}" if year is not None else name
        if key in overrides:
            return overrides[key]
        if name in overrides:
            return overrides[name]
        cands = by_name.get(name, [])
        if year is not None:
            cands = [r for r in cands if not r.get("formed") or r["formed"] <= year]
        return cands[0]["id"] if len(cands) == 1 else None

    return link


def build():
    records = _load_combi_records()
    print(f"[build] コンビ {len(records)}件")

    year_files = build_years(records)
    link = _make_linker(records)

    # 旧アーカイブ年度(work/archive_years.json)をマージし、名前でコンビIDを紐付け
    archive_path = WORK_DIR / "archive_years.json"
    if archive_path.exists():
        archive_years = json.loads(archive_path.read_text(encoding="utf-8"))
        for year_str, yf in archive_years.items():
            linked = 0
            for e in yf["entries"]:
                e["id"] = link(e["name"], int(year_str))
                linked += e["id"] is not None
            year_files[int(year_str)] = yf
            print(f"[build] {year_str}: アーカイブ {len(yf['entries'])}組 (ID紐付け {linked}組)")

    validate_years({y: yf for y, yf in year_files.items() if yf["source"] == "official-db"})

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
        shards[rec["id"] % SHARD_COUNT][str(rec["id"])] = {
            "name": rec["name"],
            "kana": rec["kana"],
            "formed": rec.get("formed"),
            "formedRaw": rec.get("formedRaw"),
            "belong": rec.get("belong"),
            "members": rec.get("members", []),
            "history": rec["history"],
            "officialUrl": f"https://www.m-1gp.com/combi/{rec['id']}.html",
        }
    _write(DATA_DIR / "combi" / "index.json", index)
    for nn, shard in shards.items():
        _write(DATA_DIR / "combi" / f"{nn}.json", shard)

    _write(DATA_DIR / "rankings.json", build_rankings(records))
    _write(DATA_DIR / "stats.json", build_stats(year_files))

    pop_path = WORK_DIR / "popularity.json"
    if pop_path.exists():
        _write(DATA_DIR / "popularity.json", json.loads(pop_path.read_text(encoding="utf-8")))

    finals_dir = WORK_DIR / "finals"
    finals_years = []
    if finals_dir.exists():
        for f in sorted(finals_dir.glob("*.json")):
            override = OVERRIDES_DIR / "finals" / f.name
            src = override if override.exists() else f
            finals = json.loads(src.read_text(encoding="utf-8"))
            for row in finals.get("firstRound", []) + finals.get("finalRound", []):
                row["combiId"] = link(row["name"], finals["year"])
            _write(DATA_DIR / "finals" / f.name, finals)
            finals_years.append(int(f.stem))

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
