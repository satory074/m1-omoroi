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


def test_best_results_are_as_of_that_year():
    """年度エントリーの best は「その年まで(その年を含む)」の最高戦績。

    不変条件: ① 後の年の成績が前の年へ漏れない ② 年を追って減らない ③ その年自身の段階以上。
    """
    from m1scraper.build_json import BEST_CHAMPION, annotate_best_results

    hist = {
        "2016": {"results": {"first": "pass", "second": "fail"}},
        "2017": {"results": {"first": "fail"}},  # 前年より悪い年
        "2018": {"results": {"first": "pass", "semifinal": "pass", "final": "champion"}},
    }
    rec = {"id": 7, "history": hist}
    # 年度ファイルの行は build_years と同じく results を共有する
    year_files = {
        int(y): {"entries": [{"id": 7, "results": h["results"]}]} for y, h in hist.items()
    }
    # id の無いアーカイブ行は、その年の results だけで決まる
    year_files[2016]["entries"].append({"id": None, "results": {"third": "fail"}})

    annotate_best_results(year_files, [rec])
    best = {y: yf["entries"][0]["best"] for y, yf in year_files.items()}

    assert best[2016] == 2  # 2018年の優勝が2016年に漏れない
    assert best[2017] == 2  # 2017年は1回戦止まりでも、前年の2回戦を保つ(減らない)
    assert best[2018] == BEST_CHAMPION
    assert year_files[2016]["entries"][1]["best"] == 3
