from m1scraper.build_json import _age_at, _parse_birth, build_people_stats


def test_parse_birth_formats():
    assert _parse_birth("1970年12月04日") == (1970, 12, 4)
    assert _parse_birth("1970年1月4日") == (1970, 1, 4)
    assert _parse_birth(None) is None
    assert _parse_birth("非公開") is None
    assert _parse_birth("1970年13月04日") is None


def test_age_at_birthday_boundary():
    birth = (1971, 12, 25)
    assert _age_at(birth, (2021, 12, 24)) == 49  # 誕生日前日
    assert _age_at(birth, (2021, 12, 25)) == 50  # 誕生日当日
    assert _age_at(birth, (2021, 12, 26)) == 50


def _rec(id, name, members, history, belong=None):
    return {"id": id, "name": name, "belong": belong, "members": members, "history": history}


def test_final_age_uses_finals_date_and_champion_override():
    # 12月25日生まれ × 12月19日開催 → 誕生日前なので 年差-1 歳
    records = [
        _rec(
            1,
            "錦鯉系",
            [{"name": "長谷川", "birth": "1971年12月25日"}],
            {"2021": {"results": {"final": "pass"}}},
        )
    ]
    finals = [
        {
            "year": 2021,
            "judges": [],
            "firstRound": [{"name": "錦鯉系", "combiId": 1, "total": 650, "rank": 1}],
            "finalRound": [{"name": "錦鯉系", "combiId": 1, "votes": 4, "champion": True}],
        }
    ]
    s = build_people_stats(records, finals, {}, {2021: (2021, 12, 19)})
    oldest = s["ageRecords"]["final"]["oldest"]
    assert oldest[0] == {"age": 49, "member": "長谷川", "combi": "錦鯉系", "combiId": 1, "year": 2021}
    assert s["ageRecords"]["champion"]["oldest"][0]["age"] == 49


def test_champion_members_from_overrides_when_no_record():
    # 2001〜2010の王者(combiId=null・公式DB未収録)は champions_meta で補完
    finals = [
        {
            "year": 2001,
            "judges": [],
            "firstRound": [{"name": "中川家", "combiId": None, "total": 829, "rank": 1}],
            "finalRound": [{"name": "中川家", "combiId": None, "votes": 6, "champion": True}],
        }
    ]
    ov = {"2001": {"members": [{"name": "剛", "birth": "1970年12月04日"}]}}
    s = build_people_stats([], finals, ov, {2001: (2001, 12, 25)})
    champ = s["ageRecords"]["champion"]["oldest"]
    assert champ[0]["age"] == 31 and champ[0]["member"] == "剛"


def test_appearance_age_and_sanity_exclusion():
    records = [
        _rec(
            1,
            "学生コンビ",
            [{"name": "若手", "birth": "2005年04月01日"}, {"name": "冗談", "birth": "1900年01月01日"}],
            {"2019": {"results": {"first": "fail"}}, "2024": {"results": {"first": "fail"}}},
        )
    ]
    s = build_people_stats(records, [], {}, {})
    young = s["ageRecords"]["appearance"]["youngest"]
    # 若手: 初出場2019年時点 14歳(年末基準)。人物単位で1件に集約
    assert young[0] == {"age": 14, "member": "若手", "combi": "学生コンビ", "combiId": 1, "year": 2019}
    assert len([r for r in young if r["member"] == "若手"]) == 1
    # 1900年生まれ(2019年時点119歳)はサニティ範囲外で除外
    assert all(r["member"] != "冗談" for r in young)
    assert s["ageExcluded"] >= 1


def test_age_gap_only_quarterfinal_and_above():
    records = [
        _rec(
            1,
            "歳の差",
            [{"name": "兄", "birth": "1960年06月01日"}, {"name": "弟", "birth": "1981年05月31日"}],
            {"2016": {"results": {"quarterfinal": "fail"}}},
        ),
        _rec(
            2,
            "無名",
            [{"name": "a", "birth": "1960年01月01日"}, {"name": "b", "birth": "1990年01月01日"}],
            {"2016": {"results": {"first": "fail"}}},  # 準々決勝未満は対象外
        ),
    ]
    s = build_people_stats(records, [], {}, {})
    assert [g["name"] for g in s["ageGap"]] == ["歳の差"]
    g = s["ageGap"][0]
    # 弟が生まれた時点(1981-05-31)で兄は20歳(誕生日前)
    assert g["gapYears"] == 20 and g["older"] == "兄" and g["younger"] == "弟"
    assert g["bestRound"] == "quarterfinal"


def test_amateur_jobs_trio():
    records = [
        _rec(
            1,
            "会社員コンビ",
            [{"name": "a", "job": "会社員"}, {"name": "b", "job": "会社員"}],
            {"2018": {"results": {"semifinal": "fail", "quarterfinal": "pass"}}},
            belong="アマチュア",
        ),
        _rec(
            2,
            "トリオ",
            [{"name": "x"}, {"name": "y"}, {"name": "z"}],
            {"2020": {"results": {"third": "fail"}}},
        ),
        _rec(
            3,
            "カルテット",  # 4人以上はトリオ対象外
            [{"name": "p"}, {"name": "q"}, {"name": "r"}, {"name": "s"}],
            {"2020": {"results": {"third": "fail"}}},
        ),
    ]
    s = build_people_stats(records, [], {}, {})
    assert s["amateur"] == [
        {"id": 1, "name": "会社員コンビ", "bestRound": "semifinal", "years": [2018]}
    ]
    kaisha = next(j for j in s["jobs"] if j["job"] == "会社員")
    assert kaisha["bestRound"] == "semifinal" and kaisha["count"] == 1
    assert [t["name"] for t in s["trio"]] == ["トリオ"]
