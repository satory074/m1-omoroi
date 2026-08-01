"""YouTube検索ベースの「注目度」の取得。

指標の変遷: Google CSEヒット件数(CSEのウェブ全体検索が2027-01廃止予定で断念)
→ Wikipedia閲覧数(記事のある348組しかカバーできない)
→ M-1公式ネタ動画の再生数(シーズン終了後に全動画が非公開化されるため断念)
→ 現方式: YouTube Data API v3 で「コンビ名 漫才」を検索し、上位10本の再生数を合計する。
  「漫才」の限定語で同名の別対象への誤ヒットはほぼ解消される(一般名詞コンビ名で検証済み)。

- 対象: 準々決勝以上に進出経験のあるコンビ(数百組)
- search.list は100units/回、無料枠10,000units/日 → 約95組/日。
  枠の目安に達したら保存して中断し、翌日の再実行でレジュームする
- APIキー必須: 環境変数 YOUTUBE_API_KEY (GCPで YouTube Data API v3 を有効化して発行)
- work/popularity.json はコミット対象(CIビルドでも使われる)
"""

import json
import os
import time
from datetime import date

import httpx

from .config import USER_AGENT, WORK_DIR

SOURCE = "youtube-search-views"
SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
SEARCH_SUFFIX = " 漫才"
TOP_N = 10

# search=100units + videos.list=1unit。9,500で止めて他用途の余地を残す
UNITS_PER_COMBI = 101
DAILY_UNIT_BUDGET = 9_500


class QuotaExceeded(Exception):
    """YouTube APIの1日クォータ超過(403 quotaExceeded)。"""


def select_targets() -> list[dict]:
    """準々決勝以上の経験があるコンビを抽出。"""
    combi_path = WORK_DIR / "combi.jsonl"
    if not combi_path.exists():
        raise SystemExit(f"{combi_path} がありません。先に `m1 parse-combi` を実行してください")
    targets = []
    for line in combi_path.open(encoding="utf-8"):
        rec = json.loads(line)
        if any(
            rk in entry["results"]
            for entry in rec["history"].values()
            for rk in ("quarterfinal", "semifinal", "final")
        ):
            targets.append({"id": rec["id"], "name": rec["name"]})
    return targets


def _raise_if_quota_exceeded(resp: httpx.Response) -> None:
    if resp.status_code != 403:
        return
    try:
        errors = resp.json().get("error", {}).get("errors", [])
    except ValueError:
        return
    if any(e.get("reason") == "quotaExceeded" for e in errors):
        raise QuotaExceeded


def search_video_ids(client: httpx.Client, api_key: str, name: str) -> list[str]:
    """「コンビ名 漫才」で検索し、関連度順の上位動画IDを返す。"""
    resp = client.get(
        SEARCH_URL,
        params={
            "part": "id",
            "q": name + SEARCH_SUFFIX,
            "type": "video",
            "maxResults": str(TOP_N),
            "regionCode": "JP",
            "relevanceLanguage": "ja",
            "key": api_key,
        },
    )
    _raise_if_quota_exceeded(resp)
    resp.raise_for_status()
    return [
        item["id"]["videoId"]
        for item in resp.json().get("items", [])
        if item.get("id", {}).get("videoId")
    ]


def fetch_view_counts(client: httpx.Client, api_key: str, video_ids: list[str]) -> list[int]:
    """動画IDごとの再生数。非公開化等で統計が取れないものは除外される。"""
    views = []
    for i in range(0, len(video_ids), 50):
        resp = client.get(
            VIDEOS_URL,
            params={
                "part": "statistics",
                "id": ",".join(video_ids[i : i + 50]),
                "key": api_key,
            },
        )
        _raise_if_quota_exceeded(resp)
        resp.raise_for_status()
        for item in resp.json().get("items", []):
            count = item.get("statistics", {}).get("viewCount")
            if count is not None:
                views.append(int(count))
    return views


def fetch_popularity(limit: int | None = None):
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        raise SystemExit(
            "環境変数 YOUTUBE_API_KEY が未設定です。"
            "GCPで YouTube Data API v3 を有効化してAPIキーを発行してください"
        )

    pop_path = WORK_DIR / "popularity.json"
    data = {"source": SOURCE, "hits": {}}
    if pop_path.exists():
        prev = json.loads(pop_path.read_text(encoding="utf-8"))
        if prev.get("source") == data["source"]:
            data = prev

    targets = select_targets()
    todo = [t for t in targets if str(t["id"]) not in data["hits"]]
    if limit:
        todo = todo[:limit]
    print(f"[fetch-popularity] 対象 {len(targets)}組 / 今回 {len(todo)}組 (YouTube再生数)")

    today = date.today().isoformat()
    units = 0
    done = 0
    with httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT}) as client:
        for n, t in enumerate(todo, 1):
            if units + UNITS_PER_COMBI > DAILY_UNIT_BUDGET:
                print(
                    f"[fetch-popularity] 無料枠の目安({DAILY_UNIT_BUDGET}units)に到達。"
                    "翌日再実行してください"
                )
                break
            try:
                video_ids = search_video_ids(client, api_key, t["name"])
                units += 100
                views = fetch_view_counts(client, api_key, video_ids)
                units += (len(video_ids) + 49) // 50
            except QuotaExceeded:
                print("[fetch-popularity] APIクォータ超過。翌日再実行してください")
                break
            except httpx.HTTPError as e:
                print(f"[fetch-popularity] {t['name']}: 取得失敗 ({e}) スキップ")
                time.sleep(2)
                continue
            data["hits"][str(t["id"])] = {"n": sum(views), "at": today, "v": len(views)}
            done += 1
            if n % 25 == 0 or n == len(todo):
                pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                print(f"[fetch-popularity] {n}/{len(todo)}", flush=True)
            time.sleep(0.2)

    pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(
        f"[fetch-popularity] 完了: {len(data['hits'])}/{len(targets)}組"
        f" (今回{done}組, 約{units}units消費) -> {pop_path}"
    )
