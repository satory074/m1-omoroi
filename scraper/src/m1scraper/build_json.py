"""work/* + overrides/* から配信用JSON(data/*)を生成し、整合性を検証する。

生成物:
  meta.json            スキーマ版・生成日時・年度一覧
  years/{year}.json    年度×回戦の主データ
  combi/index.json     検索用索引 [[id, 名前, かな, [出場年...]], ...]
  combi/{NN}.json      詳細シャード (NN = id % 100)
  rankings.json        記録ランキング(事前集計)
  stats.json           年度別統計(事前集計)
  popularity.json      YouTube再生数による注目度 (work/popularity.json があれば)
  finals/{year}.json   決勝得点表 (work/finals/ があれば)
"""

import json
import shutil
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

        out.append({"year": year, "name": champ["name"], "formed": formed, "members": members})

    return {"champions": out}


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
            _write(DATA_DIR / "finals" / f.name, finals)
            finals_years.append(int(f.stem))
            all_finals.append(finals)

    # 歴代王者(優勝者)の集計。出身地/結成年/生年月日は公式コンビDB(2015年以降)由来のため、
    # 2001〜2010は overrides/champions_meta.json で補完する
    combi_by_id = {r["id"]: r for r in records}
    champ_meta_path = OVERRIDES_DIR / "champions_meta.json"
    champ_overrides = (
        json.loads(champ_meta_path.read_text(encoding="utf-8")) if champ_meta_path.exists() else {}
    )
    _write(
        DATA_DIR / "champions.json",
        build_champions(all_finals, combi_by_id, champ_overrides),
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
