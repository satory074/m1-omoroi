from m1scraper.build_json import annotate_final_appearances, merge_final_votes


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
