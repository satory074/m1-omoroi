from m1scraper.build_json import _make_linker, _norm_name, merge_archive_history


def _rec(cid, name, history):
    return {"id": cid, "name": name, "kana": name, "history": history}


def test_merge_archive_appends_pre2015_rows():
    records = [_rec(72, "かまいたち", {"2015": {"no": 1, "results": {"first": "pass"}}})]
    year_files = {
        2015: {"source": "official-db", "entries": []},
        2010: {
            "source": "official-archive",
            "entries": [
                {"id": 72, "no": None, "results": {"first": "pass", "second": "fail"}},
                {"id": None, "name": "未リンク", "results": {"first": "fail"}},
            ],
        },
        2009: {
            "source": "official-archive",
            "entries": [{"id": 72, "no": None, "results": {"first": "pass"}}],
        },
    }
    added = merge_archive_history(records, year_files)
    assert added == 2  # id付きの2件のみ(未リンクは無視)

    hist = records[0]["history"]
    assert set(hist) == {"2015", "2010", "2009"}
    assert hist["2010"]["results"] == {"first": "pass", "second": "fail"}
    # 既存の2015行は保持される
    assert hist["2015"]["results"] == {"first": "pass"}


def test_merge_archive_ignores_official_db_years():
    records = [_rec(1, "テスト", {"2015": {"no": 1, "results": {"first": "pass"}}})]
    year_files = {
        2015: {
            "source": "official-db",
            "entries": [{"id": 1, "results": {"first": "seed_pass"}}],
        }
    }
    added = merge_archive_history(records, year_files)
    assert added == 0
    assert list(records[0]["history"]) == ["2015"]


def test_merge_archive_fills_empty_history():
    # 合成レコード(history 空)にもアーカイブ年が入る
    records = [_rec(900001, "笑い飯", {})]
    year_files = {
        2002: {"source": "official-archive", "entries": [{"id": 900001, "results": {"first": "pass"}}]},
    }
    added = merge_archive_history(records, year_files)
    assert added == 1
    assert records[0]["history"]["2002"]["results"] == {"first": "pass"}


def _link_archive(records, year_files):
    """build() のアーカイブ紐付け(通常link + 全半角フォールバック)を再現する。"""
    link = _make_linker(records)
    legacy_by_norm = {_norm_name(r["name"]): r for r in records if r.get("legacy")}
    for year, yf in year_files.items():
        if yf.get("source") != "official-archive":
            continue
        for e in yf["entries"]:
            e["id"] = link(e["name"], year)
            if e["id"] is None:
                lr = legacy_by_norm.get(_norm_name(e["name"]))
                if lr is not None and (not lr.get("formed") or lr["formed"] <= year):
                    e["id"] = lr["id"]


def test_legacy_record_links_exact_name_and_fills_history():
    legacy = {"id": 900001, "name": "笑い飯", "kana": "わらいめし", "formed": 2000,
              "members": [], "history": {}, "legacy": True}
    records = [legacy]
    year_files = {
        2002: {"source": "official-archive", "entries": [{"name": "笑い飯", "results": {"first": "pass"}}]},
        2010: {"source": "official-archive", "entries": [{"name": "笑い飯", "results": {"final": "fail"}}]},
    }
    _link_archive(records, year_files)
    merge_archive_history(records, year_files)
    assert sorted(legacy["history"]) == ["2002", "2010"]


def test_legacy_record_links_fullwidth_variant():
    # アーカイブ名が全角(ＮＯＮ ＳＴＹＬＥ)でも正規化フォールバックで紐付く
    legacy = {"id": 900002, "name": "NON STYLE", "kana": "のんすたいる", "formed": 2000,
              "members": [], "history": {}, "legacy": True}
    records = [legacy]
    year_files = {
        2007: {"source": "official-archive", "entries": [{"name": "ＮＯＮ ＳＴＹＬＥ", "results": {"third": "fail"}}]},
    }
    _link_archive(records, year_files)
    merge_archive_history(records, year_files)
    assert legacy["history"]["2007"]["results"] == {"third": "fail"}


def test_legacy_link_rejects_pre_formation_year():
    # 結成年より前のアーカイブ参加(同名別コンビ/ノイズ)は紐付けない
    legacy = {"id": 900015, "name": "ピース", "kana": "ぴーす", "formed": 2003,
              "members": [], "history": {}, "legacy": True}
    records = [legacy]
    year_files = {
        2001: {"source": "official-archive", "entries": [{"name": "ピース", "results": {"first": "fail"}}]},
        2004: {"source": "official-archive", "entries": [{"name": "ピース", "results": {"second": "fail"}}]},
    }
    _link_archive(records, year_files)
    merge_archive_history(records, year_files)
    # 2001(結成前)は付かず、2004のみ
    assert list(legacy["history"]) == ["2004"]


def test_norm_name_folds_width():
    assert _norm_name("ＮＯＮ ＳＴＹＬＥ") == "NON STYLE"
    assert _norm_name("ルート３３") == "ルート33"
