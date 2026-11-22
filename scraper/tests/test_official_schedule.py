"""公式日程の取得の不変条件。

壊れたら困るのは「別の回戦・別の日の日程を出す」「コンビに違う日の出番を付ける」
「出番(N組目)がずれる」「公式の一時的な異常で日程が消える(一部の会場だけ欠ける)」こと。
素材は 2026-11-14 に取得した実物(meetlist.json・897〜902.json)を数組に縮めたもの。
"""

import json
from datetime import date

import httpx
import pytest

from m1scraper.official_schedule import (
    MEETLIST_URL,
    VENUE_URL,
    fetch_schedule,
    public_schedule,
    round_slots,
)

TODAY = date(2026, 11, 22)


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
    "3": [_meet("888", "2026年10月29日")],
    "4": [_meet("897", "2026年11月18日"), _meet("898", "2026年11月19日")],
    "5": [_meet("900", "2026年12月03日")],
    "6": [_meet("901", "2026年12月20日")],
    "7": [_meet("902", "2026年12月20日")],
}
VENUES = {
    # 公式の war は全角数字
    "888": _venue("３回戦", "20261029", "[大阪] ドーンセンター", [101, 102, 103], week="木", start="1700"),
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


def _fetch(tmp_path, meetlist=MEETLIST, venues=VENUES, fail=(), today=TODAY):
    out = tmp_path / "schedule.json"
    with _site(meetlist, venues, fail) as client:
        fetch_schedule(client=client, out_path=out, interval=0, backoff=0, today=today)
    return json.loads(out.read_text(encoding="utf-8"))


def test_real_shape(tmp_path):
    data = _fetch(tmp_path)
    assert data["year"] == 2026
    head, files = public_schedule(data)
    qf = head["rounds"]["quarterfinal"]
    assert [(v["date"], v["wd"], v["start"], v["area"], v["place"], v["entrants"]) for v in qf] == [
        ("2026-11-18", "水", "18:30", "大阪", "なんばグランド花月", 2),
        ("2026-11-19", "木", "17:00", "東京", "ルミネtheよしもと", 2),
    ]
    # 調整中・未定・空は「決まっていない」(null)
    pl = head["rounds"]["playoff"][0]
    assert (pl["place"], pl["mc"], pl["start"]) == (None, None, None)
    # 出番は公式の並びのまま(「３回戦」も3回戦として読む)
    assert files["third"] == {"888": [101, 102, 103]}
    assert files["quarterfinal"] == {"897": [39881, 28372], "898": [4134, 766]}
    # 配信の日程には出場者の列を載せない(年度ページが到着を待つので小さく保つ)
    assert all(isinstance(v["entrants"], int) for vs in head["rounds"].values() for v in vs)


def test_round_needs_both_number_and_war_to_agree(tmp_path):
    # 準決勝の番号(5)なのに war が準々決勝の会場は、どちらの回戦にも入れない
    venues = {**VENUES, "900": _venue("準々決勝", "20261203", "[東京] NEW PIER HALL", [111])}
    data = _fetch(tmp_path, venues=venues)
    assert "semifinal" not in data["rounds"]
    assert all(v["id"] != "900" for v in data["rounds"]["quarterfinal"])
    assert all(111 not in ids for lists in round_slots(data).values() for _, ids in lists)


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


def test_absent_is_not_counted_and_reentry_keeps_both_slots(tmp_path):
    reentry = _venue("１回戦", "20260915", "[東京] シダックスカルチャーホール", [10, 20, 30], week="火")
    reentry["entrant"][0]["result"] = "欠席"  # 10 は欠席: 出番に数えないので 20 が1組目
    meetlist = {**MEETLIST, "1": [_meet("797", "2026年08月01日"), _meet("880", "2026年09月15日")]}
    venues = {
        **VENUES,
        "797": _venue("１回戦", "20260801", "[東京] シダックスカルチャーホール", [20, 40], week="土"),
        "880": reentry,
    }
    data = _fetch(tmp_path, meetlist=meetlist, venues=venues)
    _, files = public_schedule(data)
    # 20 は8/1に敗退して9/15に再エントリー。どちらの出番も残す
    assert files["first"] == {"797": [20, 40], "880": [20, 30]}


def test_finished_venue_is_reused_and_recent_one_is_fetched_again(tmp_path):
    yesterday = _venue("準々決勝", "20261121", "[東京] ルミネtheよしもと", [4134, 766], week="土")
    first = _fetch(tmp_path, venues={**VENUES, "898": yesterday}, today=date(2026, 11, 17))
    assert first["rounds"]["third"][0]["entrants"] == ["101", "102", "103"]
    # 5日後: 終わって2日以上たつ 888(10/29)・897(11/18)は取りに行かない(取れば 404 で失敗する)。
    # 前日(11/21)の 898 は出場者が変わり得るので取り直す
    changed = {**yesterday, "entrant": yesterday["entrant"] + [{"id": "5", "group": "", "name": "組5"}]}
    data = _fetch(tmp_path, venues={**VENUES, "898": changed}, fail=("888", "897"), today=TODAY)
    assert data["rounds"]["third"][0]["entrants"] == ["101", "102", "103"]
    assert [(v["id"], v["entrants"]) for v in data["rounds"]["quarterfinal"]] == [
        ("897", ["39881", "28372"]),
        ("898", ["4134", "766", "5"]),
    ]


@pytest.mark.parametrize(
    "meetlist,fail",
    [
        (MEETLIST, ("898",)),  # 1会場でも取れなければ、欠けた日程を書かない
        ({}, ()),  # 会場が1つも無い
    ],
)
def test_keeps_previous_file_when_fetch_is_incomplete(tmp_path, meetlist, fail):
    out = tmp_path / "schedule.json"
    out.write_text('{"previous": true}', encoding="utf-8")
    with _site(meetlist, VENUES, fail) as client:
        with pytest.raises(SystemExit):
            fetch_schedule(client=client, out_path=out, interval=0, backoff=0, today=TODAY)
    assert out.read_text(encoding="utf-8") == '{"previous": true}'
