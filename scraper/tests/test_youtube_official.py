"""公式YouTube動画の取得・紐付けの不変条件。

壊れたら困るのは「別のコンビの動画にリンクする」ことと「APIの一時的な異常でリンクが全部消える」こと。
"""

import json

import httpx
import pytest

from m1scraper.youtube_official import (
    PLAYLIST_ITEMS_URL,
    PLAYLISTS_URL,
    extract_names,
    fetch_official_videos,
    match_official_videos,
)

# 実物(2026-11 取得)の説明文・タイトル
DESC_THIRD = """3回戦ネタ　M-1グランプリ2026
11/3 (火) [東京] KANDA SQUARE HALL

1組目：バイバイスプリット
2組目：yozora
3組目：ぽんぽこ

※準々決勝進出者は除く"""
DESC_TOP3 = """1回戦TOP3　M-1グランプリ2026
9/27(日) [東京] シダックスカルチャーホール

1位通過：フインキ
2位通過：2013
3位通過：き展"""


def test_extract_names_formats():
    # 3回戦ネタ: 説明文の「N組目」を出番順に
    assert [n["name"] for n in extract_names("x", DESC_THIRD)] == ["バイバイスプリット", "yozora", "ぽんぽこ"]
    assert extract_names("x", DESC_THIRD)[1]["label"] == "2組目"
    # 1回戦TOP3: タイトルは誤字(2013→「2023」)があるので説明文の「N位通過」を優先する
    names = extract_names("【1回戦TOP３】 フインキ/ 2023 /き展【M-1グランプリ2026】", DESC_TOP3)
    assert [(n["name"], n["label"]) for n in names] == [
        ("フインキ", "1位通過"),
        ("2013", "2位通過"),
        ("き展", "3位通過"),
    ]
    # 説明文に出演者行が無いものはタイトルから(アマチュア賞のキャッチ・インタビューの【】を除く)
    assert [n["name"] for n in extract_names("【ナイスアマチュア賞】 離婚前 ＜つかみから目が離せない！＞ 【M-1グランプリ2026】", "")] == ["離婚前"]
    assert [n["name"] for n in extract_names("【M-1グランプリ2026】 素敵じゃないか 【2回戦直撃インタビュー】", "")] == ["素敵じゃないか"]
    # 複数組の総集編は1組に紐付けない
    assert extract_names("【M-1グランプリ2025】2回戦直撃！インタビューまとめ【東京編】", "") == []


def _entry(cid, name, **results):
    return {"id": cid, "name": name, "results": results}


def _work(videos, kind="3回戦ネタ", round_key="third"):
    return {
        "fetchedAt": "2026-11-12",
        "playlists": [
            {
                "id": "PL",
                "title": f"{kind} 2026",
                "year": 2026,
                "round": round_key,
                "kind": kind,
                "count": len(videos),
                "videos": videos,
            }
        ],
    }


def _ids(data, year="2026"):
    return {cid for cid in data["years"].get(year, {}).get("combis", {})}


def test_links_only_to_entrants_of_that_round_and_never_guesses_same_name():
    year_files = {
        2026: {
            "entries": [
                _entry(1, "ナナ", first="pass", second="pass", third="fail"),
                _entry(2, "ナナ", first="fail"),  # 同名・3回戦に出ていない → 照合相手から外れる
                _entry(3, "黄昏", first="fail"),
                _entry(4, "黄昏", first="fail"),  # 同名・どちらも1回戦敗退 → 決め手なし
                _entry(5, "TOKYO COOL", first="pass", second="pass", third="fail"),
                _entry(6, "準々組", first="pass", second="pass", third="pass"),
            ]
        }
    }
    third = _work(
        [{"id": "v1", "year": 2026, "round": "third", "names": [{"name": "ナナ", "label": "1組目"}, {"name": "TOKYO  COOL", "label": "2組目"}]}]
    )
    data, _ = match_official_videos(third, year_files)
    assert _ids(data) == {"1", "5"}  # 二重スペースは吸収、同名の1回戦敗退組には付かない

    amateur = _work(
        [{"id": "v2", "year": 2026, "round": "first", "names": [{"name": "黄昏", "label": None}]}],
        kind="ナイスアマチュア賞",
        round_key="first",
    )
    data, report = match_official_videos(amateur, year_files)
    assert _ids(data) == set()  # どちらか分からないなら付けない
    assert report[(2026, "first")]["ambiguous"]
    # 会場JSONで確かめた override があればそれに従う
    data, _ = match_official_videos(amateur, year_files, {"byVideo": {"v2": {"黄昏": 4}}})
    assert _ids(data) == {"4"}
    # override 先がその回戦に出ていなければ採用しない
    data, _ = match_official_videos(third | {}, year_files, {"byVideo": {"v1": {"ナナ": 2}}})
    assert "2" not in _ids(data)


def test_top3_same_name_resolved_by_first_round_pass():
    year_files = {2026: {"entries": [_entry(10, "すかんぴん", first="fail"), _entry(11, "すかんぴん", first="pass", second="fail")]}}
    work = _work(
        [{"id": "v", "year": 2026, "round": "first", "names": [{"name": "すかんぴん", "label": None}]}],
        kind="1回戦TOP3",
        round_key="first",
    )
    data, _ = match_official_videos(work, year_files)
    assert _ids(data) == {"11"}


def _api(playlists, items_by_pl):
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.startswith(PLAYLISTS_URL):
            return httpx.Response(200, json={"items": playlists})
        if url.startswith(PLAYLIST_ITEMS_URL):
            return httpx.Response(200, json={"items": items_by_pl[request.url.params["playlistId"]]})
        raise AssertionError(url)

    return httpx.Client(transport=httpx.MockTransport(handler))


def _item(vid, title, privacy="public", description=""):
    return {
        "snippet": {"title": title, "description": description, "resourceId": {"videoId": vid}},
        "status": {"privacyStatus": privacy},
    }


def test_fetch_drops_private_videos_and_unrelated_playlists(tmp_path, monkeypatch):
    monkeypatch.setenv("YOUTUBE_API_KEY", "KEY")
    playlists = [
        {"id": "P3", "snippet": {"title": "3回戦ネタ 2026"}},
        {"id": "PR", "snippet": {"title": "M-1ラジオ 2026"}},  # 回戦と無関係 → 中身も取りに行かない
    ]
    items = {
        "P3": [
            _item("pub", "【3回戦ネタ】A/B【M-1グランプリ2026】"),
            _item("priv", "Private video", privacy="private"),
            _item("del", "Deleted video", privacy="privacyStatusUnspecified"),
        ]
    }
    out = tmp_path / "official_videos.json"
    with _api(playlists, items) as client:
        fetch_official_videos(client=client, out_path=out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert [p["id"] for p in data["playlists"]] == ["P3"]
    assert [v["id"] for v in data["playlists"][0]["videos"]] == ["pub"]


def test_fetch_keeps_previous_file_when_nothing_found(tmp_path, monkeypatch):
    monkeypatch.setenv("YOUTUBE_API_KEY", "KEY")
    out = tmp_path / "official_videos.json"
    out.write_text('{"previous": true}', encoding="utf-8")
    with _api([], {}) as client:
        with pytest.raises(SystemExit):
            fetch_official_videos(client=client, out_path=out)
    assert out.read_text(encoding="utf-8") == '{"previous": true}'
