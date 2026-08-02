import json

import httpx
import pytest

from m1scraper import youtube_popularity
from m1scraper.youtube_popularity import (
    QuotaExceeded,
    _mentions_name,
    fetch_view_counts,
    search_video_ids,
    select_targets,
)


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _quota_response() -> httpx.Response:
    return httpx.Response(
        403,
        json={"error": {"errors": [{"reason": "quotaExceeded"}]}},
    )


def _video(view_count, title="", description="", channel="", tags=None):
    return {
        "statistics": {"viewCount": str(view_count)},
        "snippet": {
            "title": title,
            "description": description,
            "channelTitle": channel,
            **({"tags": tags} if tags else {}),
        },
    }


def test_search_video_ids():
    def handler(request):
        assert request.url.params["q"] == "真空ジェシカ 漫才"
        assert request.url.params["type"] == "video"
        return httpx.Response(
            200,
            json={
                "items": [
                    {"id": {"kind": "youtube#video", "videoId": "abc"}},
                    {"id": {"kind": "youtube#video", "videoId": "def"}},
                    {"id": {"kind": "youtube#channel"}},  # videoIdなしは除外
                ]
            },
        )

    with _client(handler) as client:
        assert search_video_ids(client, "KEY", "真空ジェシカ") == ["abc", "def"]


def test_search_quota_exceeded():
    with _client(lambda request: _quota_response()) as client:
        with pytest.raises(QuotaExceeded):
            search_video_ids(client, "KEY", "カベポスター")


def test_429_is_quota_error():
    def handler(request):
        return httpx.Response(429, json={"error": {"code": 429}})

    with _client(handler) as client:
        with pytest.raises(QuotaExceeded):
            search_video_ids(client, "KEY", "ミキ")


def test_mentions_name_fields_and_normalization():
    # タイトル一致
    assert _mentions_name(_video(1, title="真空ジェシカ 寄り添いサーカス"), "真空ジェシカ")
    # 説明文一致(タイトルにコンビ名がない公式ネタ動画を想定)
    assert _mentions_name(
        _video(1, title="【敗者復活戦ネタ】恋煩い", description="出演: ドンデコルテ"),
        "ドンデコルテ",
    )
    # チャンネル名一致
    assert _mentions_name(_video(1, channel="金属バットの車窓から"), "金属バット")
    # タグ一致
    assert _mentions_name(_video(1, tags=["漫才", "カベポスター"]), "カベポスター")
    # 大文字小文字・全角半角・空白の揺れを吸収 (THIS IS パン → This is パン)
    assert _mentions_name(_video(1, title="This is パン 単独ライブ"), "THIS IS パン")
    # 無関係な動画は不一致
    assert not _mentions_name(
        _video(1, title="干ししいたけの白味噌バター炒め", channel="河崎紘一郎"),
        "スーパー土瓶",
    )


def test_fetch_view_counts_filters_unrelated():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "items": [
                    _video(1000, title="まっかちん 漫才"),
                    _video(3_440_022, title="呂布カルマが選ぶラッパーTOP5"),  # 無関係
                    _video(500, description="天の声まっかちん出演"),
                ]
            },
        )

    with _client(handler) as client:
        assert fetch_view_counts(client, "KEY", ["a", "b", "c"], "まっかちん") == [1000, 500]


def test_fetch_view_counts_batches_and_sums():
    calls = []

    def handler(request):
        ids = request.url.params["id"].split(",")
        calls.append(len(ids))
        assert request.url.params["part"] == "statistics,snippet"
        return httpx.Response(
            200,
            json={"items": [_video(i, title="和牛 漫才") for i, _ in enumerate(ids, 1)]},
        )

    video_ids = [f"v{i}" for i in range(60)]  # 50件/バッチで2回に分割される
    with _client(handler) as client:
        views = fetch_view_counts(client, "KEY", video_ids, "和牛")

    assert calls == [50, 10]
    assert len(views) == 60
    assert sum(views) == sum(range(1, 51)) + sum(range(1, 11))


def test_fetch_view_counts_skips_missing_statistics():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "items": [
                    _video(1000, title="吉田たち 漫才"),
                    {"statistics": {}, "snippet": {"title": "吉田たち 漫才"}},  # 統計非公開
                ]
            },
        )

    with _client(handler) as client:
        assert fetch_view_counts(client, "KEY", ["a", "b"], "吉田たち") == [1000]


def test_select_targets_third_round_or_higher(tmp_path, monkeypatch):
    records = [
        {"id": 1, "name": "3回戦止まり", "history": {"2024": {"results": {"third": "fail"}}}},
        {"id": 2, "name": "2回戦止まり", "history": {"2024": {"results": {"second": "fail"}}}},
        {"id": 3, "name": "決勝進出", "history": {"2023": {"results": {"final": "pass"}}}},
        {"id": 4, "name": "成績なし", "history": {}},
    ]
    (tmp_path / "combi.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8"
    )
    monkeypatch.setattr(youtube_popularity, "WORK_DIR", tmp_path)

    assert [t["id"] for t in select_targets()] == [1, 3]


def test_plain_403_is_not_quota_error():
    def handler(request):
        return httpx.Response(403, json={"error": {"errors": [{"reason": "forbidden"}]}})

    with _client(handler) as client:
        with pytest.raises(httpx.HTTPStatusError):
            search_video_ids(client, "KEY", "ダイヤモンド")
