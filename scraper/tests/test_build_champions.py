from m1scraper.build_json import build_champions


def test_build_champions_from_combi_records():
    finals = [
        {
            "year": 2025,
            "finalRound": [
                {"name": "たくろう", "combiId": 4021, "champion": True},
                {"name": "ヨネダ2000", "combiId": 9999, "champion": False},
            ],
        }
    ]
    combi_by_id = {
        4021: {
            "formed": 2016,
            "members": [
                {"name": "赤木裕", "from": "滋賀県", "birth": "1991年10月24日"},
                {"name": "きむらバンド", "from": "愛媛県", "birth": "1990年01月28日"},
            ],
        }
    }

    out = build_champions(finals, combi_by_id, {})
    champs = out["champions"]
    assert len(champs) == 1
    c = champs[0]
    assert c["year"] == 2025
    assert c["name"] == "たくろう"
    assert c["id"] == 4021  # 優勝タブのリンク用にIDをパススルー
    assert c["formed"] == 2016
    # 年齢 = 優勝年 − 生年
    assert c["members"] == [
        {"name": "赤木裕", "from": "滋賀県", "age": 34},
        {"name": "きむらバンド", "from": "愛媛県", "age": 35},
    ]


def test_build_champions_falls_back_to_overrides():
    # combiId=null(2001〜2010) は overrides で補完する
    finals = [
        {
            "year": 2001,
            "finalRound": [{"name": "中川家", "combiId": None, "champion": True}],
        }
    ]
    overrides = {
        "2001": {
            "formed": 1992,
            "members": [
                {"name": "中川剛", "from": "大阪府", "birth": "1970年09月08日"},
                {"name": "中川礼二", "from": "大阪府", "birth": "1972年03月03日"},
            ],
        }
    }

    out = build_champions(finals, {}, overrides)
    c = out["champions"][0]
    assert c["id"] is None  # 未リンク王者は id null(UIは非リンク表示)
    assert c["formed"] == 1992
    assert c["members"] == [
        {"name": "中川剛", "from": "大阪府", "age": 31},
        {"name": "中川礼二", "from": "大阪府", "age": 29},
    ]


def test_build_champions_sorted_and_skips_yearless_winners():
    finals = [
        {"year": 2016, "finalRound": [{"name": "銀シャリ", "combiId": 1928, "champion": True}]},
        {"year": 2015, "finalRound": [{"name": "トレンディエンジェル", "combiId": 2311, "champion": True}]},
        {"year": 2026, "finalRound": []},  # 決勝未実施 → 王者なし
    ]
    combi_by_id = {
        1928: {"formed": 2005, "members": []},
        2311: {"formed": 2005, "members": []},
    }
    out = build_champions(finals, combi_by_id, {})
    years = [c["year"] for c in out["champions"]]
    assert years == [2015, 2016]  # 年昇順・王者なしの年は除外


def test_build_champions_handles_missing_birth():
    finals = [{"year": 2010, "finalRound": [{"name": "笑い飯", "combiId": None, "champion": True}]}]
    overrides = {
        "2010": {"formed": 2000, "members": [{"name": "哲夫", "from": "奈良県"}]}
    }
    out = build_champions(finals, {}, overrides)
    m = out["champions"][0]["members"][0]
    assert m["age"] is None
    assert m["from"] == "奈良県"
