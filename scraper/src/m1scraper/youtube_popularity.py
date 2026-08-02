"""YouTube検索ベースの「注目度」の取得。

指標の変遷: Google CSEヒット件数(CSEのウェブ全体検索が2027-01廃止予定で断念)
→ Wikipedia閲覧数(記事のある348組しかカバーできない)
→ M-1公式ネタ動画の再生数(シーズン終了後に全動画が非公開化されるため断念)
→ 現方式: YouTube Data API v3 で「コンビ名 漫才」を検索し、上位10本のうち
  タイトル・説明文・チャンネル名・タグのいずれかにコンビ名を含む動画の再生数を合計する。
  このフィルタがないと、動画の少ないマイナーコンビで検索結果が無関係な
  高再生動画で埋まり、合計が桁違いに膨らむ(まっかちん5,200万回など)。

- 対象: 3回戦以上に出場経験のあるコンビ(約1,300組)
- search.list は100units/回、無料枠10,000units/日 → 約95組/日。
  枠の目安に達したら保存して中断し、翌日の再実行でレジュームする
- ローリング更新: 未取得の組を優先し、残りは取得日の古い順に再取得する。
  GitHub Actions (update-popularity.yml) が毎日実行するため、
  全組が約2週間周期で自動的に更新され続ける
- APIキー必須: 環境変数 YOUTUBE_API_KEY (GCPで YouTube Data API v3 を有効化して発行)
- work/popularity.json はコミット対象(CIビルドでも使われる)
"""

import json
import os
import time
import unicodedata
from datetime import date

import httpx

from .config import USER_AGENT, WORK_DIR

SOURCE = "youtube-search-views-v2"
SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
SEARCH_SUFFIX = " 漫才"
TOP_N = 10

# search=100units + videos.list=1unit。9,500で止めて他用途の余地を残す
UNITS_PER_COMBI = 101
DAILY_UNIT_BUDGET = 9_500


class QuotaExceeded(Exception):
    """YouTube APIの1日クォータ超過(403 quotaExceeded)。"""


TARGET_ROUNDS = ("third", "quarterfinal", "semifinal", "playoff", "final")


def select_targets() -> list[dict]:
    """3回戦以上の出場経験があるコンビを抽出。"""
    combi_path = WORK_DIR / "combi.jsonl"
    if not combi_path.exists():
        raise SystemExit(f"{combi_path} がありません。先に `m1 parse-combi` を実行してください")
    targets = []
    for line in combi_path.open(encoding="utf-8"):
        rec = json.loads(line)
        if any(
            rk in entry["results"]
            for entry in rec["history"].values()
            for rk in TARGET_ROUNDS
        ):
            targets.append({"id": rec["id"], "name": rec["name"]})
    return targets


def plan_todo(targets: list[dict], hits: dict) -> list[dict]:
    """未取得の組を先頭に、取得済みの組を取得日の古い順で並べる。"""
    missing = [t for t in targets if str(t["id"]) not in hits]
    stale = sorted(
        (t for t in targets if str(t["id"]) in hits),
        key=lambda t: hits[str(t["id"])]["at"],
    )
    return missing + stale


def _raise_if_quota_exceeded(resp: httpx.Response) -> None:
    # 枠切れ時は 403 quotaExceeded のほか 429 も返る。どちらも即中断して翌日に回す
    # (1組ずつスキップ扱いにすると全434組へ無駄なリクエストを撃ち続けてしまう)
    if resp.status_code == 429:
        raise QuotaExceeded
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


def _normalize(s: str) -> str:
    return unicodedata.normalize("NFKC", s).casefold().replace(" ", "")


def _mentions_name(item: dict, name: str) -> bool:
    sn = item.get("snippet", {})
    haystack = " ".join(
        [sn.get("title", ""), sn.get("description", ""), sn.get("channelTitle", "")]
        + sn.get("tags", [])
    )
    return _normalize(name) in _normalize(haystack)


def fetch_view_counts(
    client: httpx.Client, api_key: str, video_ids: list[str], name: str
) -> list[int]:
    """コンビ名を含む動画の再生数のみ。統計非公開の動画は除外される。"""
    views = []
    for i in range(0, len(video_ids), 50):
        resp = client.get(
            VIDEOS_URL,
            params={
                "part": "statistics,snippet",
                "id": ",".join(video_ids[i : i + 50]),
                "key": api_key,
            },
        )
        _raise_if_quota_exceeded(resp)
        resp.raise_for_status()
        for item in resp.json().get("items", []):
            count = item.get("statistics", {}).get("viewCount")
            if count is not None and _mentions_name(item, name):
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
    todo = plan_todo(targets, data["hits"])
    if limit:
        todo = todo[:limit]
    n_missing = sum(1 for t in targets if str(t["id"]) not in data["hits"])
    print(
        f"[fetch-popularity] 対象 {len(targets)}組"
        f" (未取得 {n_missing} / 更新待ち {len(targets) - n_missing}) (YouTube再生数)"
    )

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
                views = fetch_view_counts(client, api_key, video_ids, t["name"])
                units += (len(video_ids) + 49) // 50
            except QuotaExceeded:
                print("[fetch-popularity] APIクォータ超過。翌日再実行してください")
                break
            except httpx.HTTPError as e:
                print(f"[fetch-popularity] {t['name']}: 取得失敗 ({e}) スキップ")
                time.sleep(2)
                continue
            # ids は検索結果全件(フィルタ前)。フィルタ規則の変更時に
            # videos.list だけで再集計できるよう保持する(searchの100unitsを再消費しない)
            data["hits"][str(t["id"])] = {
                "n": sum(views),
                "at": today,
                "v": len(views),
                "ids": video_ids,
            }
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
