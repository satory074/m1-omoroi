from m1scraper.build_json import build_judges_stats

OV = {
    "venues": {"2001": ["大阪", "札幌", "福岡"]},
    "names": {
        "オ｜ル巨人": "オール巨人",
        "巨人": "オール巨人",
        "松本人志": "松本人志",
        "松本": "松本人志",
    },
    "byYear": {},
}


def _finals(year, judges, first, final=()):
    return {
        "year": year,
        "judges": judges,
        "firstRound": [dict(r) for r in first],
        "finalRound": [dict(r) for r in final],
    }


def test_venue_columns_excluded_and_diff_top_low():
    y = _finals(
        2001,
        ["大阪", "札幌", "福岡", "松本人志", "オ｜ル巨人"],
        [
            # 会場票(先頭3列)は個人審査員の統計から除外される
            {"name": "A", "combiId": 1, "scores": [100, 100, 100, 90, 80], "total": 470},
            {"name": "B", "combiId": 2, "scores": [50, 50, 50, 80, 70], "total": 300},
        ],
    )
    s = build_judges_stats([y], OV)
    yr = s["byYear"][0]
    assert [j["canonical"] for j in yr["judges"]] == ["松本人志", "オール巨人"]
    # 松本: [90, 80] 行平均 [85, 75] → diff +5.0、全行で最高点
    matsu = yr["judges"][0]
    assert matsu["mean"] == 85.0 and matsu["diff"] == 5.0
    assert matsu["top"] == 2 and matsu["low"] == 0
    assert matsu["max"] == 90 and matsu["min"] == 80
    # 会場票のみの平均ではなく個人審査員全体平均
    assert yr["judgeMean"] == 80.0
    assert s["venueColumns"] == {"2001": ["大阪", "札幌", "福岡"]}


def test_career_merges_raw_names_across_years():
    y1 = _finals(
        2007,
        ["オ｜ル巨人"],
        [],
    )
    y2 = _finals(
        2016,
        ["巨人", "松本"],
        [
            {"name": "A", "combiId": 1, "scores": [92, 90], "total": 182},
            {"name": "B", "combiId": 2, "scores": [88, 90], "total": 178},
        ],
    )
    s = build_judges_stats([y1, y2], OV)
    kyojin = next(c for c in s["career"] if c["name"] == "オール巨人")
    # 2007年は採点行なし → years に入らない(scored 0)。2016年分のみ
    assert kyojin["years"] == [2016]
    assert kyojin["scored"] == 2
    # 巨人: [92, 88] 行平均 [91, 89] → diff (+1 -1)/2 = 0.0、A行で最高点・B行で最低点
    assert kyojin["avgDiff"] == 0.0
    assert kyojin["topCount"] == 1 and kyojin["lowCount"] == 1


def test_unknown_judge_name_passes_through():
    y = _finals(
        2030,
        ["新人審査員", "松本"],
        [
            {"name": "A", "combiId": 1, "scores": [90, 92], "total": 182},
            {"name": "B", "combiId": 2, "scores": [95, 91], "total": 186},
        ],
    )
    s = build_judges_stats([y], OV)
    # 名寄せ未収録は警告して生表記のまま集計(ビルドは止めない)
    assert [j["canonical"] for j in s["byYear"][0]["judges"]] == ["新人審査員", "松本人志"]
    assert any(c["name"] == "新人審査員" for c in s["career"])


def test_final_votes_unanimous_and_margin():
    y1 = _finals(
        2010,
        ["松本人志"],
        [],
        [
            {"name": "A", "combiId": 1, "votes": 7, "champion": True},
            {"name": "B", "combiId": 2, "votes": 0, "champion": False},
        ],
    )
    y2 = _finals(
        2020,
        ["松本"],
        [],
        [
            {"name": "C", "combiId": 3, "votes": 4, "champion": True},
            {"name": "D", "combiId": 4, "votes": 3, "champion": False},
        ],
    )
    s = build_judges_stats([y1, y2], OV)
    fv = {r["year"]: r for r in s["finalVotes"]}
    assert fv[2010]["unanimous"] is True and fv[2010]["margin"] == 7
    assert fv[2020]["unanimous"] is False and fv[2020]["margin"] == 1
    assert fv[2020]["champion"] == "C"


def test_career_votes_only_when_voters_merged():
    y1 = _finals(  # voters 未マージ年 → votes 集計対象外
        2005,
        ["松本人志"],
        [],
        [{"name": "A", "combiId": 1, "votes": 4, "champion": True}],
    )
    y2 = _finals(
        2020,
        ["松本", "巨人"],
        [],
        [
            {"name": "C", "combiId": 3, "votes": 1, "champion": True, "voters": ["松本"]},
            {"name": "D", "combiId": 4, "votes": 1, "champion": False, "voters": ["巨人"]},
        ],
    )
    s = build_judges_stats([y1, y2], OV)
    career = {c["name"]: c for c in s["career"]}
    assert career["松本人志"]["votes"] == 1 and career["松本人志"]["champVotes"] == 1
    assert career["オール巨人"]["votes"] == 1 and career["オール巨人"]["champVotes"] == 0
