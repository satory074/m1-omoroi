import json

import httpx
import pytest

from m1scraper.youtube_popularity import (
    QuotaExceeded,
    fetch_view_counts,
    search_video_ids,
)


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _quota_response() -> httpx.Response:
    return httpx.Response(
        403,
        json={"error": {"errors": [{"reason": "quotaExceeded"}]}},
    )


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


def test_fetch_view_counts_batches_and_sums():
    calls = []

    def handler(request):
        ids = request.url.params["id"].split(",")
        calls.append(len(ids))
        return httpx.Response(
            200,
            json={
                "items": [
                    {"statistics": {"viewCount": str(i)}} for i, _ in enumerate(ids, 1)
                ]
            },
        )

    video_ids = [f"v{i}" for i in range(60)]  # 50件/バッチで2回に分割される
    with _client(handler) as client:
        views = fetch_view_counts(client, "KEY", video_ids)

    assert calls == [50, 10]
    assert len(views) == 60
    assert sum(views) == sum(range(1, 51)) + sum(range(1, 11))


def test_fetch_view_counts_skips_missing_statistics():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "items": [
                    {"statistics": {"viewCount": "1000"}},
                    {"statistics": {}},  # 統計非公開の動画
                ]
            },
        )

    with _client(handler) as client:
        assert fetch_view_counts(client, "KEY", ["a", "b"]) == [1000]


def test_plain_403_is_not_quota_error():
    def handler(request):
        return httpx.Response(403, json={"error": {"errors": [{"reason": "forbidden"}]}})

    with _client(handler) as client:
        with pytest.raises(httpx.HTTPStatusError):
            search_video_ids(client, "KEY", "ダイヤモンド")
