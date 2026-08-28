from m1scraper.build_json import ADVANCER_TIERS, build_advancers


def _rec(id_, name, history, **extra):
    return {"id": id_, "name": name, "history": history, **extra}


def _combis(out, round_key):
    return next(t["combis"] for t in out["tiers"] if t["round"] == round_key)


def test_tiers_are_mutually_exclusive():
    # 決勝到達組は決勝グループにだけ入る(準々決勝・準決勝にも到達しているが重複させない)
    rec = _rec(
        1,
        "決勝組",
        {
            "2018": {"results": {"quarterfinal": "pass", "semifinal": "pass", "final": "fail"}},
        },
    )
    out = build_advancers([rec])
    assert [c["name"] for c in _combis(out, "final")] == ["決勝組"]
    assert _combis(out, "semifinal") == []
    assert _combis(out, "quarterfinal") == []
    assert [t["round"] for t in out["tiers"]] == ["final", "semifinal", "quarterfinal"]


def test_excludes_combis_below_quarterfinal():
    rec = _rec(1, "3回戦止まり", {"2019": {"results": {"first": "pass", "third": "fail"}}})
    out = build_advancers([rec])
    assert all(t["combis"] == [] for t in out["tiers"])


def test_reach_count_and_first_year_use_best_round_only():
    # 準決勝に2回到達 → reachCount=2 / firstYear=最初に準決勝へ届いた年
    rec = _rec(
        1,
        "準決勝組",
        {
            "2016": {"results": {"third": "fail"}},
            "2017": {"results": {"semifinal": "fail"}},
            "2019": {"results": {"semifinal": "fail"}},
        },
    )
    (c,) = _combis(build_advancers([rec]), "semifinal")
    assert c["firstYear"] == 2017
    assert c["reachCount"] == 2


def test_entry_years_covers_all_participations_sorted():
    # entryYears は最高ラウンドと無関係に全出場年(準々決勝未満の年も)を昇順で持つ
    rec = _rec(
        1,
        "出場多数",
        {
            "2019": {"results": {"quarterfinal": "fail"}},
            "2015": {"results": {"first": "fail"}},
            "2017": {"results": {}},
        },
    )
    (c,) = _combis(build_advancers([rec]), "quarterfinal")
    assert c["entryYears"] == [2015, 2017, 2019]


def test_missing_formed_and_members_are_kept_as_none():
    rec = _rec(1, "結成年不明", {"2020": {"results": {"quarterfinal": "fail"}}})
    (c,) = _combis(build_advancers([rec]), "quarterfinal")
    assert c["formed"] is None
    assert c["members"] == []


def test_member_age_is_first_reach_year_minus_birth_year():
    rec = _rec(
        1,
        "年齢あり",
        {"2020": {"results": {"semifinal": "fail"}}},
        formed=2010,
        members=[
            {"name": "A", "birth": "1990年01月02日", "from": "東京都"},
            {"name": "B", "from": "大阪府"},
        ],
    )
    (c,) = _combis(build_advancers([rec]), "semifinal")
    assert c["formed"] == 2010
    assert c["members"] == [
        {"name": "A", "from": "東京都", "age": 30},
        {"name": "B", "from": "大阪府", "age": None},
    ]


def test_empty_history_is_ignored():
    assert build_advancers([_rec(1, "履歴なし", {})]) == {
        "tiers": [{"round": r, "combis": []} for r in ["final", "semifinal", "quarterfinal"]]
    }


def test_sorted_by_first_year_then_name():
    recs = [
        _rec(1, "ん", {"2016": {"results": {"quarterfinal": "fail"}}}),
        _rec(2, "あ", {"2016": {"results": {"quarterfinal": "fail"}}}),
        _rec(3, "先", {"2015": {"results": {"quarterfinal": "fail"}}}),
    ]
    assert [c["name"] for c in _combis(build_advancers(recs), "quarterfinal")] == ["先", "あ", "ん"]


def test_advancer_tiers_order():
    # ADVANCER_TIERS は昇順(final が最上位)。max_r の判定が逆走査に依存している
    assert ADVANCER_TIERS == ["quarterfinal", "semifinal", "final"]
