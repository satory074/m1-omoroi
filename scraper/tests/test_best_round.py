from m1scraper.build_json import MAIN_ROUNDS, best_round


def _rec(history):
    return {"id": 1, "history": history}


def test_main_rounds_excludes_playoff():
    # 敗者復活戦は本線の到達段階として数えない(rounds.ts の furthestRound と同じ)
    assert MAIN_ROUNDS == ["first", "second", "third", "quarterfinal", "semifinal", "final"]


def test_unknown_when_no_round_data():
    assert best_round(_rec({})) == 0
    assert best_round({"id": 1}) == 0
    assert best_round(_rec({"2005": {"no": None, "results": {}}})) == 0


def test_first_round_only():
    assert best_round(_rec({"2019": {"results": {"first": "fail"}}})) == 1


def test_takes_max_across_years():
    rec = _rec(
        {
            "2015": {"results": {"first": "pass", "second": "fail"}},
            "2018": {"results": {"first": "pass", "second": "pass", "third": "fail"}},
            "2016": {"results": {"first": "fail"}},
        }
    )
    assert best_round(rec) == 3  # third


def test_reached_counts_regardless_of_result():
    # 「到達」は results にキーが在ることで判定し、合否は問わない
    assert best_round(_rec({"2021": {"results": {"final": "fail"}}})) == 6


def test_playoff_alone_is_not_counted():
    rec = _rec({"2017": {"results": {"first": "pass", "playoff": "fail"}}})
    assert best_round(rec) == 1


def test_playoff_does_not_outrank_semifinal():
    rec = _rec({"2017": {"results": {"semifinal": "fail", "playoff": "pass"}}})
    assert best_round(rec) == 5  # semifinal
