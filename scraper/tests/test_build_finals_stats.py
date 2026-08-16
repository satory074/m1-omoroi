from m1scraper.build_json import _top_with_ties, build_finals_stats, build_rankings


def test_top_with_ties_extends_boundary():
    items = [{"value": v} for v in (5, 4, 3, 3, 3, 2)]
    assert _top_with_ties(items, 3) == [{"value": v} for v in (5, 4, 3, 3, 3)]


def test_top_with_ties_passthrough_when_short():
    items = [{"value": 1}]
    assert _top_with_ties(items, 30) is items


def test_top_with_ties_exact_cut_without_tie():
    items = [{"value": v} for v in (5, 4, 3, 2)]
    assert _top_with_ties(items, 2) == [{"value": 5}, {"value": 4}]


def test_build_rankings_top_includes_boundary_ties():
    # 30位の値と同値の組は31位以降でもすべて含まれる
    records = []
    for i in range(40):
        records.append(
            {
                "id": i,
                "name": f"c{i:02d}",
                # 上位5組は2回、残り35組は1回準々決勝進出
                "history": {
                    "2020": {"results": {"quarterfinal": "fail"}},
                    **({"2021": {"results": {"quarterfinal": "fail"}}} if i < 5 else {}),
                },
            }
        )
    quarters = build_rankings(records)["mostQuarterfinals"]
    assert len(quarters) == 40  # 30で切らず、境界値1の同値35組を全部含む
    assert quarters[0]["value"] == 2 and quarters[-1]["value"] == 1


def test_build_rankings_longest_streaks():
    records = [
        {
            "id": 1,
            "name": "A",
            "history": {
                y: {"results": {"first": "fail"}}
                for y in ("2015", "2016", "2017", "2019", "2020")
            },
        },
        {"id": 2, "name": "B", "history": {"2018": {"results": {"first": "pass"}}}},
    ]
    r = build_rankings(records)
    streaks = {x["name"]: x for x in r["longestStreaks"]}
    # 2018欠場で途切れる → 最長は2015〜2017の3年
    assert streaks["A"] == {"id": 1, "name": "A", "value": 3, "start": 2015, "end": 2017}
    assert streaks["B"] == {"id": 2, "name": "B", "value": 1, "start": 2018, "end": 2018}


def _finals(year, first, final, judges=None):
    return {
        "year": year,
        "judges": judges or [],
        "firstRound": [dict(r) for r in first],
        "finalRound": [dict(r) for r in final],
    }


def _stats(all_finals, records=None, champions=None):
    return build_finals_stats(all_finals, records or [], champions or {"champions": []})


def test_order_stats_denominator_skips_unknown_order_years():
    y1 = _finals(
        2005,
        [
            {"name": "A", "combiId": 1, "order": None, "total": 650, "rank": 1},
            {"name": "B", "combiId": 2, "order": None, "total": 640, "rank": 2},
        ],
        [{"name": "A", "combiId": 1, "votes": 4, "champion": True}],
    )
    y2 = _finals(
        2020,
        [
            {"name": "C", "combiId": 3, "order": 1, "total": 660, "rank": 1},
            {"name": "D", "combiId": 4, "order": 2, "total": 640, "rank": 2},
        ],
        [{"name": "C", "combiId": 3, "votes": 4, "champion": True, "order": 1}],
    )
    s = _stats([y1, y2])
    # order不明の2005年は分母に入らない
    assert [(r["order"], r["appearances"], r["finalists"], r["wins"]) for r in s["firstRoundOrderStats"]] == [
        (1, 1, 1, 1),
        (2, 1, 0, 0),
    ]
    assert s["firstRoundOrderStats"][0]["winners"] == [{"year": 2020, "name": "C", "combiId": 3}]
    assert [(r["order"], r["appearances"], r["wins"]) for r in s["finalOrderStats"]] == [(1, 1, 1)]


def test_champion_first_round_rank_distribution():
    years = []
    for year, rank in ((2001, 1), (2002, 1), (2003, 3)):
        rows = [
            {"name": f"w{year}", "combiId": year, "order": 1, "total": 650, "rank": rank},
            {"name": f"x{year}", "combiId": year * 10, "order": 2, "total": 660, "rank": 1 if rank != 1 else 2},
        ]
        years.append(
            _finals(year, rows, [{"name": f"w{year}", "combiId": year, "votes": 4, "champion": True}])
        )
    s = _stats(years)
    assert [(r["rank"], r["count"]) for r in s["championFirstRoundRank"]] == [(1, 2), (3, 1)]
    assert s["championFirstRoundRank"][1]["winners"] == [{"year": 2003, "name": "w2003", "combiId": 2003}]


def test_deviation_scores_and_rounded_tie_cut():
    # [660, 650, 640] → 偏差値 62.2 / 50.0 / 37.8
    y = _finals(
        2019,
        [
            {"name": "A", "combiId": 1, "order": 1, "total": 660, "rank": 1},
            {"name": "B", "combiId": 2, "order": 2, "total": 650, "rank": 2},
            {"name": "C", "combiId": 3, "order": 3, "total": 640, "rank": 3},
        ],
        [{"name": "A", "combiId": 1, "votes": 7, "champion": True}],
    )
    s = _stats([y])
    devs = {d["name"]: d["deviation"] for d in s["deviationScores"]}
    assert devs == {"A": 62.2, "B": 50.0, "C": 37.8}
    ranks = {d["name"]: d["rank"] for d in s["deviationScores"]}
    assert ranks == {"A": 1, "B": 2, "C": 3}


def test_deviation_same_rounded_value_shares_rank():
    # 同一年内で全組同点はσ=0でスキップ、2年構成で丸め後同値の順位共有を検証
    y1 = _finals(
        2001,
        [
            {"name": "A", "combiId": 1, "order": 1, "total": 660, "rank": 1},
            {"name": "B", "combiId": 2, "order": 2, "total": 640, "rank": 2},
        ],
        [],
    )
    y2 = _finals(
        2002,
        [
            {"name": "C", "combiId": 3, "order": 1, "total": 880, "rank": 1},
            {"name": "D", "combiId": 4, "order": 2, "total": 860, "rank": 2},
        ],
        [],
    )
    s = _stats([y1, y2])
    top = s["deviationScores"]
    # 2組ずつの年はどちらも 60.0 / 40.0 → 丸め後同値で順位共有
    assert [(d["deviation"], d["rank"]) for d in top] == [(60.0, 1), (60.0, 1), (40.0, 3), (40.0, 3)]


def test_deviation_scores_include_all_rows():
    # 全件表示: 上位20で切らない(3年×10組=30行がすべて残る)
    years = []
    for year in (2019, 2020, 2021):
        rows = [
            {"name": f"c{year}-{i}", "combiId": year * 100 + i, "order": i, "total": 600 + i, "rank": 11 - i}
            for i in range(1, 11)
        ]
        years.append(_finals(year, rows, []))
    s = _stats(years)
    assert len(s["deviationScores"]) == 30
    # 3年とも同じ得点分布なので各偏差値が3行ずつ同値 → 最下位グループは順位28
    assert s["deviationScores"][-1]["rank"] == 28


def test_deviation_skips_zero_sd_year():
    y = _finals(
        2003,
        [
            {"name": "A", "combiId": 1, "order": 1, "total": 650, "rank": 1},
            {"name": "B", "combiId": 2, "order": 2, "total": 650, "rank": 1},
        ],
        [],
    )
    assert _stats([y])["deviationScores"] == []


def test_final_round_appearances_combi_id_and_name_fallback():
    y1 = _finals(2002, [], [{"name": "笑い飯", "combiId": 900021, "votes": 0, "champion": False}])
    y2 = _finals(2003, [], [{"name": "笑い飯", "combiId": 900021, "votes": 3, "champion": False}])
    y3 = _finals(2004, [], [{"name": "無名コンビ", "combiId": None, "votes": 0, "champion": False}])
    records = [{"id": 900021, "name": "笑い飯", "history": {}}]
    s = _stats([y1, y2, y3], records)
    rows = {r["name"]: r for r in s["mostFinalRoundAppearances"]}
    assert rows["笑い飯"] == {"value": 2, "years": [2002, 2003], "name": "笑い飯", "id": 900021}
    assert rows["無名コンビ"]["value"] == 1 and rows["無名コンビ"]["id"] is None


def test_most_final_appearances_all_time_and_uncrowned():
    y1 = _finals(
        2002,
        [
            {"name": "笑い飯", "combiId": 900021, "total": 600, "rank": 1},
            {"name": "ドツボ", "combiId": 7, "total": 590, "rank": 2},
            {"name": "一発屋", "combiId": 9, "total": 580, "rank": 3},
        ],
        [{"name": "笑い飯", "combiId": 900021, "votes": 4, "champion": True}],
    )
    y2 = _finals(
        2003,
        [
            # combiId欠損でも全年からの名前逆引きが一意なら同一コンビに統合される
            {"name": "笑い飯", "combiId": None, "total": 610, "rank": 1},
            {"name": "ドツボ", "combiId": 7, "total": 605, "rank": 2},
        ],
        [{"name": "笑い飯", "combiId": None, "votes": 5, "champion": True}],
    )
    s = _stats([y1, y2], [{"id": 900021, "name": "笑い飯", "history": {}}])
    rows = {r["name"]: r for r in s["mostFinalAppearances"]}
    assert rows["笑い飯"] == {
        "value": 2, "years": [2002, 2003], "wins": 2, "name": "笑い飯", "id": 900021,
    }
    assert rows["ドツボ"]["wins"] == 0 and rows["一発屋"]["value"] == 1
    # 無冠の帝王: 2回以上進出かつ優勝なしのみ(1回きりの一発屋・優勝済みの笑い飯は対象外)
    assert [r["name"] for r in s["uncrownedKings"]] == ["ドツボ"]


def test_final_round_appearances_displays_current_db_name():
    # 改名(インディアンス→ちょんまげラーメン): 表示名は公式DBの現行名
    y = _finals(2021, [], [{"name": "インディアンス", "combiId": 649, "votes": 1, "champion": False}])
    records = [{"id": 649, "name": "ちょんまげラーメン", "history": {}}]
    s = _stats([y], records)
    assert s["mostFinalRoundAppearances"][0]["name"] == "ちょんまげラーメン"


def test_agency_normalization_and_excluded_count():
    y = _finals(
        2020,
        [
            {"name": "A", "combiId": 1, "order": 1, "total": 650, "rank": 1},
            {"name": "B", "combiId": 2, "order": 2, "total": 640, "rank": 2},
            {"name": "C", "combiId": 3, "order": 3, "total": 630, "rank": 3},
            {"name": "D", "combiId": None, "order": 4, "total": 620, "rank": 4},
        ],
        [],
    )
    records = [
        {"id": 1, "name": "A", "belong": "プロ（吉本興業）", "history": {}},
        {"id": 2, "name": "B", "belong": "吉本興業", "history": {}},  # レガシー生文字列
        {"id": 3, "name": "C", "belong": "アマチュア", "history": {}},
    ]
    s = _stats([y], records)
    rows = {r["agency"]: r for r in s["agencyFinals"]}
    assert rows["吉本興業"] == {"agency": "吉本興業", "value": 2, "combis": 2}
    assert rows["アマチュア"]["value"] == 1
    assert s["agencyFinalsExcluded"] == 1


def test_formation_years_spans_and_unknown():
    records = [
        {
            "id": 1,
            "name": "A",
            "formed": 2010,
            "history": {
                "2015": {"results": {"semifinal": "fail", "quarterfinal": "pass"}},
                "2020": {"results": {"final": "fail", "semifinal": "pass", "quarterfinal": "pass"}},
            },
        },
        {
            "id": 2,
            "name": "B",
            "formed": None,  # 結成年不明
            "history": {"2015": {"results": {"semifinal": "fail"}}},
        },
    ]
    champions = {"champions": [{"year": 2018, "name": "霜降り明星", "formed": 2013, "id": 9}]}
    s = _stats([], records, champions)
    f = s["formationYears"]
    assert f["final"] == [{"years": 10, "count": 1}]
    assert f["semifinal"] == [{"years": 5, "count": 1}, {"years": 10, "count": 1}]
    assert f["quarterfinal"] == [{"years": 5, "count": 1}, {"years": 10, "count": 1}]
    assert f["unknownFormed"] == {"quarterfinal": 0, "semifinal": 1, "final": 0}
    assert f["champion"] == [
        {"years": 5, "count": 1, "combis": [{"year": 2018, "name": "霜降り明星"}]}
    ]
