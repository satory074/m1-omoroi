"""TVer いいね数の取得と配信の不変条件。

壊れたら困るのは「違う組にいいね数を付ける」「伸びを実在しない標本から作る」
「締切後も数が動き続けて最終値が残らない」「取得の一部失敗で一部の組だけ古い数が混ざる」こと。
素材は 2026-11-23 に取得したシリーズのページ・エピソードの形を数組に縮めたもの。
"""

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from m1scraper.tver_likes import (
    EPISODE_URL,
    SERIES_URL,
    build_tver_likes,
    fetch_tver_likes,
    growth,
)

CONFIG = {
    "2026": {
        "start": "2026-11-22T12:00+09:00",
        "deadline": "2026-11-29T23:59+09:00",
        "series": "sryg1lm5fy",
        "section": "準々決勝",
    }
}
JST = timezone(timedelta(hours=9))


def _series(eps):
    return {
        "floor": {
            "sections": [
                {"section_template_id": "episode-list", "title": "準決勝進出者発表", "items": [
                    {"item_type": "episode", "id": "epnotice", "title": "準決勝進出者発表！"}
                ]},
                {"section_template_id": "episode-list", "title": "準々決勝 ら行 ※準決勝進出者は除く", "items": [
                    {"item_type": "episode", "id": eid, "title": t} for eid, t in eps.items()
                ]},
            ]
        }
    }


def _site(eps, likes, fail=()):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        calls.append(url)
        assert request.headers.get("x-tver-platform-type") == "web"
        if url == SERIES_URL.format(id="sryg1lm5fy"):
            return httpx.Response(200, json=_series(eps))
        for eid, t in eps.items():
            if url == EPISODE_URL.format(id=eid):
                if eid in fail:
                    return httpx.Response(404)
                return httpx.Response(200, json={"episode": {"id": eid, "title": t, "like_count": likes[eid]}})
        raise AssertionError(f"取りに行くはずのないURL: {url}")

    client = httpx.Client(transport=httpx.MockTransport(handler), headers={"x-tver-platform-type": "web"})
    return client, calls


EPS = {"ep1": "ラパルフェ", "ep2": "ﾚﾅﾁｮ"}


def _fetch(tmp_path, now, likes, fail=()):
    client, calls = _site(EPS, likes, fail)
    out = tmp_path / "tver_likes.json"
    fetch_tver_likes(client=client, out_path=out, config=CONFIG, now=now, interval=0, backoff=0)
    return out, calls


def _year(entries):
    return {2026: {"entries": entries}}


def _entry(cid, name, qf):
    return {"id": cid, "name": name, "results": {"third": "pass", "quarterfinal": qf}}


def test_links_only_to_one_quarterfinal_entrant_per_video():
    work = {
        "year": 2026,
        "final": False,
        "episodes": {
            "ep1": {"title": "ラパルフェ", "samples": [[100, 5]]},
            "ep2": {"title": "ﾚﾅﾁｮ", "samples": [[100, 3]]},  # 半角カナでも紐付く
            "ep3": {"title": "同名", "samples": [[100, 9]]},  # 準々決勝に同名2組 → 付けない
            "ep4": {"title": "3回戦止まり", "samples": [[100, 7]]},  # 準々決勝に居ない組 → 付けない
        },
    }
    years = _year(
        [
            _entry(1, "ラパルフェ", "fail"),
            _entry(2, "レナチョ", "fail"),
            _entry(3, "同名", "fail"),
            _entry(4, "同名", "fail"),
            {"id": 5, "name": "3回戦止まり", "results": {"third": "fail"}},
        ]
    )
    data, report = build_tver_likes(work, years, CONFIG)
    assert set(data["items"]) == {"1", "2"}
    assert data["items"]["1"]["ep"] == "ep1" and data["items"]["2"]["ep"] == "ep2"
    assert report["ambiguous"] and report["unmatched"]
    # 1本の動画は高々1組、1組に付く動画も1本
    eps = [it["ep"] for it in data["items"].values()]
    assert len(eps) == len(set(eps))


def test_growth_uses_a_real_sample_at_least_24h_old_and_reports_its_span():
    h = 60
    # 毎時取れていれば、ちょうど24時間前の標本との差
    hourly = [[i * h, i * 10] for i in range(30)]
    assert growth(hourly) == (24 * 10, 24 * h)
    # CI が止まって 3時間 → 25時間 → 最新(27時間後) と空いたら、24時間以上前で一番新しい 3時間 の標本を使い、幅は24時間
    gappy = [[0, 0], [3 * h, 30], [25 * h, 200], [27 * h, 260]]
    assert growth(gappy) == (230, 24 * h)
    # 24時間以上前の標本が無ければ伸びは出さない(でっち上げない)
    assert growth([[0, 0], [23 * h, 50]]) is None


def test_after_deadline_one_final_fetch_then_no_more(tmp_path):
    before = datetime(2026, 11, 29, 22, 17, tzinfo=JST)
    out, _ = _fetch(tmp_path, before, {"ep1": 10, "ep2": 20})
    assert json.loads(out.read_text())["final"] is False

    after = datetime(2026, 11, 30, 1, 17, tzinfo=JST)
    out, _ = _fetch(tmp_path, after, {"ep1": 11, "ep2": 21})
    work = json.loads(out.read_text())
    assert work["final"] is True
    assert work["episodes"]["ep1"]["samples"][-1][1] == 11

    # 最終値を取った後は TVer に取りに行かず、標本も増えない
    later = datetime(2026, 11, 30, 2, 17, tzinfo=JST)
    out, calls = _fetch(tmp_path, later, {"ep1": 99, "ep2": 99})
    assert calls == []
    assert json.loads(out.read_text()) == work

    data, _ = build_tver_likes(work, _year([_entry(1, "ラパルフェ", "fail")]), CONFIG)
    assert data["final"] is True and "d" not in data["items"]["1"]


def test_partial_failure_keeps_previous_work(tmp_path):
    t0 = datetime(2026, 11, 23, 12, 17, tzinfo=JST)
    out, _ = _fetch(tmp_path, t0, {"ep1": 10, "ep2": 20})
    first = out.read_text()
    with pytest.raises(SystemExit):
        _fetch(tmp_path, t0 + timedelta(hours=1), {"ep1": 11, "ep2": 21}, fail={"ep2"})
    assert out.read_text() == first
