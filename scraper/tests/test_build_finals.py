from m1scraper.build_json import (
    annotate_final_appearances,
    annotate_revivals,
    merge_final_votes,
    merge_finals_extra,
)


def _first(year, *rows):
    return {"year": year, "firstRound": [dict(r) for r in rows]}


def _appearances(finals_list, year):
    f = next(f for f in finals_list if f["year"] == year)
    return {r["name"]: r["finalAppearance"] for r in f["firstRound"]}


def test_annotate_appearances_by_combi_id():
    # 同一IDが年をまたいで通算される。入力の年順に依存しない(降順で渡す)
    finals = [
        _first(2025, {"name": "真空ジェシカ", "combiId": 766}),
        _first(2023, {"name": "真空ジェシカ", "combiId": 766}),
        _first(2021, {"name": "真空ジェシカ", "combiId": 766}),
    ]
    annotate_final_appearances(finals)
    assert _appearances(finals, 2021) == {"真空ジェシカ": 1}
    assert _appearances(finals, 2023) == {"真空ジェシカ": 2}
    assert _appearances(finals, 2025) == {"真空ジェシカ": 3}


def test_annotate_appearances_name_fallback():
    # combiId=null(インディアンス相当)は名前キーで通算
    finals = [
        _first(2019, {"name": "インディアンス", "combiId": None}),
        _first(2020, {"name": "インディアンス", "combiId": None}),
        _first(2021, {"name": "インディアンス", "combiId": None}),
    ]
    annotate_final_appearances(finals)
    assert _appearances(finals, 2021) == {"インディアンス": 3}


def test_annotate_appearances_nfkc_name_key():
    # 全半角違いは同一名前キーに正規化される
    finals = [
        _first(2003, {"name": "２丁拳銃", "combiId": None}),
        _first(2005, {"name": "2丁拳銃", "combiId": None}),
    ]
    annotate_final_appearances(finals)
    assert _appearances(finals, 2005) == {"2丁拳銃": 2}


def test_annotate_appearances_reverse_lookup_merges_null_into_id():
    # ある年はID付き・別の年はnullの同名 → IDへ統合して通算
    finals = [
        _first(2001, {"name": "ますだおかだ", "combiId": 555}),
        _first(2003, {"name": "ますだおかだ", "combiId": None}),
    ]
    annotate_final_appearances(finals)
    assert _appearances(finals, 2003) == {"ますだおかだ": 2}


def test_annotate_appearances_ambiguous_name_not_merged():
    # 同名が複数IDに紐づく場合、null行はどちらにも統合せず独立カウント(誤通算しない)
    finals = [
        _first(2008, {"name": "ダイヤモンド", "combiId": 1226}),
        _first(2015, {"name": "ダイヤモンド", "combiId": 6678}),
        _first(2022, {"name": "ダイヤモンド", "combiId": None}),
    ]
    annotate_final_appearances(finals)
    assert _appearances(finals, 2008) == {"ダイヤモンド": 1}
    assert _appearances(finals, 2015) == {"ダイヤモンド": 1}
    assert _appearances(finals, 2022) == {"ダイヤモンド": 1}


def _finals_2024():
    return {
        "year": 2024,
        "judges": ["大吉", "塙", "礼二"],
        "firstRound": [],
        "finalRound": [
            {"name": "令和ロマン", "votes": 2, "champion": True},
            {"name": "バッテリィズ", "votes": 1, "champion": False},
            {"name": "真空ジェシカ", "votes": 0, "champion": False},
        ],
    }


def test_merge_final_votes_ok_and_sorted_by_judges_order():
    finals = _finals_2024()
    votes = {
        "2024": [
            {"name": "令和ロマン", "voters": ["礼二", "大吉"]},
            {"name": "バッテリィズ", "voters": ["塙"]},
            {"name": "真空ジェシカ", "voters": []},
        ]
    }
    problems = merge_final_votes([finals], votes)
    assert problems == []
    rows = {r["name"]: r for r in finals["finalRound"]}
    # judges 配列の並び順に正規化される
    assert rows["令和ロマン"]["voters"] == ["大吉", "礼二"]
    assert rows["バッテリィズ"]["voters"] == ["塙"]
    assert rows["真空ジェシカ"]["voters"] == []


def test_merge_final_votes_matches_by_normalized_name():
    # finalRound側 combiId=null でも名前(NFKC)照合でマージできる
    finals = _finals_2024()
    finals["finalRound"][0]["name"] = "令和ロマン"  # 実データ相当(そのまま)
    votes = {
        "2024": [
            {"name": "令和ロマン", "voters": ["大吉", "礼二"]},
            {"name": "バッテリィズ", "voters": ["塙"]},
            {"name": "真空ジェシカ", "voters": []},
        ]
    }
    assert merge_final_votes([finals], votes) == []


def test_merge_final_votes_count_mismatch_skips_year():
    finals = _finals_2024()
    votes = {
        "2024": [
            {"name": "令和ロマン", "voters": ["大吉"]},  # votes=2 と不一致
            {"name": "バッテリィズ", "voters": ["塙"]},
            {"name": "真空ジェシカ", "voters": []},
        ]
    }
    problems = merge_final_votes([finals], votes)
    assert problems
    assert all("voters" not in r for r in finals["finalRound"])


def test_merge_final_votes_unknown_judge_skips_year():
    finals = _finals_2024()
    votes = {
        "2024": [
            {"name": "令和ロマン", "voters": ["博多大吉", "礼二"]},  # judges は短縮表記
            {"name": "バッテリィズ", "voters": ["塙"]},
            {"name": "真空ジェシカ", "voters": []},
        ]
    }
    problems = merge_final_votes([finals], votes)
    assert problems
    assert all("voters" not in r for r in finals["finalRound"])


def test_merge_final_votes_missing_row_skips_year():
    # 0票の組も含め全組列挙が必須
    finals = _finals_2024()
    votes = {
        "2024": [
            {"name": "令和ロマン", "voters": ["大吉", "礼二"]},
            {"name": "バッテリィズ", "voters": ["塙"]},
        ]
    }
    problems = merge_final_votes([finals], votes)
    assert problems
    assert all("voters" not in r for r in finals["finalRound"])


def test_merge_final_votes_duplicate_voter_skips_year():
    finals = _finals_2024()
    votes = {
        "2024": [
            {"name": "令和ロマン", "voters": ["大吉", "大吉"]},
            {"name": "バッテリィズ", "voters": ["塙"]},
            {"name": "真空ジェシカ", "voters": []},
        ]
    }
    problems = merge_final_votes([finals], votes)
    assert problems
    assert all("voters" not in r for r in finals["finalRound"])


def test_merge_final_votes_year_without_override_untouched():
    finals = _finals_2024()
    assert merge_final_votes([finals], {}) == []
    assert all("voters" not in r for r in finals["finalRound"])


def test_merge_final_votes_unknown_year_reports_problem():
    assert merge_final_votes([], {"1999": []})


def _finals_2005():
    return {
        "year": 2005,
        "judges": [],
        "firstRound": [
            {"name": "笑い飯", "combiId": 900021, "order": None},
            {"name": "ブラックマヨネーズ", "combiId": 900001, "order": None},
            {"name": "千鳥", "combiId": 900002, "order": None},
        ],
        "finalRound": [
            {"name": "ブラックマヨネーズ", "votes": 4, "champion": True},
            {"name": "笑い飯", "votes": 3, "champion": False},
        ],
    }


def test_merge_finals_extra_applies_orders_by_nfkc_name():
    finals = _finals_2005()
    extra = {
        "2005": {
            # 半角カナ表記(NFKC正規化)でも照合される
            "firstRoundOrder": {"笑い飯": 1, "ﾌﾞﾗｯｸﾏﾖﾈｰｽﾞ": 2, "千鳥": 3},
            "finalOrder": {"ブラックマヨネーズ": 2, "笑い飯": 1},
        }
    }
    assert merge_finals_extra([finals], extra) == []
    assert [r["order"] for r in finals["firstRound"]] == [1, 2, 3]
    assert [r["order"] for r in finals["finalRound"]] == [2, 1]


def test_merge_finals_extra_overrides_existing_order():
    finals = _finals_2005()
    finals["firstRound"][0]["order"] = 9
    extra = {"2005": {"firstRoundOrder": {"笑い飯": 1, "ブラックマヨネーズ": 2, "千鳥": 3}}}
    assert merge_finals_extra([finals], extra) == []
    assert finals["firstRound"][0]["order"] == 1


def test_merge_finals_extra_name_set_mismatch_skips_field_only():
    finals = _finals_2005()
    extra = {
        "2005": {
            "firstRoundOrder": {"笑い飯": 1, "ブラックマヨネーズ": 2},  # 千鳥が欠け
            "finalOrder": {"ブラックマヨネーズ": 1, "笑い飯": 2},
        }
    }
    problems = merge_finals_extra([finals], extra)
    assert problems and "firstRoundOrder" in problems[0]
    # firstRound はスキップ、finalOrder は適用される
    assert all(r["order"] is None for r in finals["firstRound"])
    assert [r["order"] for r in finals["finalRound"]] == [1, 2]


def test_merge_finals_extra_non_permutation_skips():
    finals = _finals_2005()
    extra = {"2005": {"firstRoundOrder": {"笑い飯": 1, "ブラックマヨネーズ": 1, "千鳥": 3}}}
    problems = merge_finals_extra([finals], extra)
    assert problems
    assert all(r["order"] is None for r in finals["firstRound"])


def test_merge_finals_extra_unknown_year_reports_problem():
    assert merge_finals_extra([], {"1999": {"revival": "誰か"}})


def _year_file(year, *entries):
    return {year: {"year": year, "entries": [dict(e) for e in entries]}}


def test_annotate_revivals_auto_by_combi_id():
    finals = _finals_2005()
    finals["year"] = 2024
    years = _year_file(
        2024,
        {"id": 900021, "name": "笑い飯", "results": {"playoff": "pass"}},
        {"id": 1, "name": "他", "results": {"playoff": "fail"}},
    )
    assert annotate_revivals([finals], years, {}) == []
    assert finals["firstRound"][0].get("revival") is True
    assert "revival" not in finals["firstRound"][1]


def test_annotate_revivals_auto_by_name_when_id_unlinked():
    finals = _finals_2005()
    finals["year"] = 2024
    finals["firstRound"][2]["combiId"] = None
    years = _year_file(2024, {"id": 777, "name": "千鳥", "results": {"playoff": "pass"}})
    assert annotate_revivals([finals], years, {}) == []
    assert finals["firstRound"][2].get("revival") is True


def test_annotate_revivals_override_wins_over_auto():
    finals = _finals_2005()
    years = _year_file(2005, {"id": 900021, "name": "笑い飯", "results": {"playoff": "pass"}})
    extra = {"2005": {"revival": "千鳥"}}
    assert annotate_revivals([finals], years, extra) == []
    assert finals["firstRound"][2].get("revival") is True
    assert "revival" not in finals["firstRound"][0]


def test_annotate_revivals_multiple_playoff_pass_skips_with_warning():
    finals = _finals_2005()
    years = _year_file(
        2005,
        {"id": 900021, "name": "笑い飯", "results": {"playoff": "pass"}},
        {"id": 900002, "name": "千鳥", "results": {"playoff": "pass"}},
    )
    problems = annotate_revivals([finals], years, {})
    assert problems
    assert all("revival" not in r for r in finals["firstRound"])


def test_annotate_revivals_winner_missing_from_first_round_warns():
    # 改名等で決勝行と照合できないケース(インディアンス回帰ガード)
    finals = _finals_2005()
    years = _year_file(2005, {"id": 649, "name": "インディアンス", "results": {"playoff": "pass"}})
    problems = annotate_revivals([finals], years, {})
    assert problems
    assert all("revival" not in r for r in finals["firstRound"])


def test_annotate_revivals_no_data_no_warning():
    # 敗者復活戦の無い年(2001)相当: playoffデータもoverrideも無ければ何もしない
    finals = _finals_2005()
    finals["year"] = 2001
    assert annotate_revivals([finals], _year_file(2001, {"id": 1, "name": "x", "results": {}}), {}) == []
    assert all("revival" not in r for r in finals["firstRound"])
