"""公式日程の取得の不変条件。

壊れたら困るのは「別の回戦・別の日の日程を出す」「コンビに違う日の出番を付ける」
「公式の一時的な異常で日程が消える(一部の会場だけ欠ける)」こと。
素材は 2026-11-14 に取得した実物(meetlist.json・897〜902.json)を数組に縮めたもの。
"""

import json

import httpx
import pytest

from m1scraper.official_schedule import MEETLIST_URL, VENUE_URL, fetch_schedule


def _meet(vid, day):
    return {"id": vid, "holdyear": "2026", "meet_day": day, "button": 1}


def _venue(war, meet_day, place, entrants=(), week="水", start="1830", mc="ギャロップ"):
    return {
        "war": war,
        "meet_day": meet_day,
        "week": week,
        "open_time": "1800",
        "start_time": start,
        "place": place,
        "place_mc": mc,
        "entrant": [{"id": str(i), "group": "", "name": f"組{i}", "result": "出場予定"} for i in entrants],
    }


MEETLIST = {
    "3": [_meet("896", "2026年11月04日")],  # 3回戦は取りに行かない
    "4": [_meet("897", "2026年11月18日"), _meet("898", "2026年11月19日")],
    "5": [_meet("900", "2026年12月03日")],
    "6": [_meet("901", "2026年12月20日")],
    "7": [_meet("902", "2026年12月20日")],
}
VENUES = {
    "897": _venue("準々決勝", "20261118", "[大阪] なんばグランド花月", [39881, 28372]),
    "898": _venue("準々決勝", "20261119", "[東京] ルミネtheよしもと", [4134, 766], week="木", start="1700"),
    "900": _venue("準決勝", "20261203", "[東京] NEW PIER HALL", week="木", start="1600"),
    "901": _venue("敗者復活戦", "20261220", "[東京] 調整中", week="日", start="", mc="未定"),
    "902": _venue("決勝", "20261220", "[東京] テレビ朝日", week="日", start="", mc="未定"),
}


def _site(meetlist, venues, fail=()):
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == MEETLIST_URL:
            return httpx.Response(200, json=meetlist)
        for vid, body in venues.items():
            if url == VENUE_URL.format(id=vid):
                if vid in fail:
                    return httpx.Response(404)
                return httpx.Response(200, json=body)
        raise AssertionError(f"取りに行くはずのないURL: {url}")

    return httpx.Client(transport=httpx.MockTransport(handler))


def _fetch(tmp_path, meetlist=MEETLIST, venues=VENUES, fail=()):
    out = tmp_path / "schedule.json"
    with _site(meetlist, venues, fail) as client:
        fetch_schedule(client=client, out_path=out, interval=0, backoff=0)
    return json.loads(out.read_text(encoding="utf-8"))


def test_real_shape(tmp_path):
    data = _fetch(tmp_path)
    assert data["year"] == 2026
    qf = data["rounds"]["quarterfinal"]
    assert [(v["date"], v["wd"], v["start"], v["area"], v["place"], v["entrants"]) for v in qf] == [
        ("2026-11-18", "水", "18:30", "大阪", "なんばグランド花月", 2),
        ("2026-11-19", "木", "17:00", "東京", "ルミネtheよしもと", 2),
    ]
    # 調整中・未定・空は「決まっていない」(null)
    pl = data["rounds"]["playoff"][0]
    assert (pl["place"], pl["mc"], pl["start"]) == (None, None, None)
    assert data["combis"]["766"] == {"quarterfinal": "898"}


def test_round_needs_both_number_and_war_to_agree(tmp_path):
    # 準決勝の番号(5)なのに war が準々決勝の会場は、どちらの回戦にも入れない
    venues = {**VENUES, "900": _venue("準々決勝", "20261203", "[東京] NEW PIER HALL", [111])}
    data = _fetch(tmp_path, venues=venues)
    assert "semifinal" not in data["rounds"]
    assert all(v["id"] != "900" for v in data["rounds"]["quarterfinal"])
    assert "111" not in data["combis"]


def test_dates_are_real_in_hold_year_and_weekday_comes_from_date(tmp_path):
    venues = {
        **VENUES,
        "897": _venue("準々決勝", "20261118", "[大阪] なんばグランド花月", [1], week="月"),  # 公式の曜日の誤り
        "898": _venue("準々決勝", "20251119", "[東京] ルミネtheよしもと", [2]),  # 開催年と違う
        "900": _venue("準決勝", "20261332", "[東京] NEW PIER HALL"),  # 実在しない日
    }
    data = _fetch(tmp_path, venues=venues)
    assert [(v["id"], v["wd"]) for v in data["rounds"]["quarterfinal"]] == [("897", "水")]
    assert "semifinal" not in data["rounds"]
    for vs in data["rounds"].values():
        for v in vs:
            assert v["date"].startswith("2026-")


def test_combi_in_two_venues_of_one_round_gets_no_venue(tmp_path):
    venues = {
        **VENUES,
        "897": _venue("準々決勝", "20261118", "[大阪] なんばグランド花月", [10, 20]),
        "898": _venue("準々決勝", "20261119", "[東京] ルミネtheよしもと", [20, 30]),
    }
    data = _fetch(tmp_path, venues=venues)
    assert "20" not in data["combis"]
    assert data["combis"]["10"] == {"quarterfinal": "897"}
    assert data["combis"]["30"] == {"quarterfinal": "898"}


@pytest.mark.parametrize(
    "meetlist,fail",
    [
        (MEETLIST, ("898",)),  # 1会場でも取れなければ、欠けた日程を書かない
        ({"1": [_meet("800", "2026年08月01日")]}, ()),  # 準々決勝以降の会場が無い
    ],
)
def test_keeps_previous_file_when_fetch_is_incomplete(tmp_path, meetlist, fail):
    out = tmp_path / "schedule.json"
    out.write_text('{"previous": true}', encoding="utf-8")
    with _site(meetlist, VENUES, fail) as client:
        with pytest.raises(SystemExit):
            fetch_schedule(client=client, out_path=out, interval=0, backoff=0)
    assert out.read_text(encoding="utf-8") == '{"previous": true}'
