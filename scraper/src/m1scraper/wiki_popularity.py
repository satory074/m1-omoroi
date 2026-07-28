"""Wikipedia閲覧数による「注目度」の取得。

GoogleがProgrammable Search Engineの「ウェブ全体を検索」を廃止予定(2027-01)のため、
当初のGoogle検索ヒット件数の代わりに、日本語版Wikipedia記事の年間閲覧数を使う。

- 対象: 準々決勝以上に進出経験のあるコンビ(数百組)
- 記事の特定: 「コンビ名」「コンビ名 (お笑いコンビ)」等の候補をMediaWiki APIで照合し、
  カテゴリに「お笑い」「漫才」を含むものだけ採用(同名の別記事への誤リンク防止)
- 閲覧数: Wikimedia Pageviews REST APIで直近12か月の合計
- 記事がないコンビは未収載 → フロントでは五十音順で後ろに並ぶ(=無名寄りの扱い)
- APIキー不要。work/popularity.json はコミット対象(CIビルドでも使われる)
"""

import json
import time
import urllib.parse
from datetime import date, timedelta

import httpx

from .config import USER_AGENT, WIKIPEDIA_API_URL, WORK_DIR

PAGEVIEWS_URL = (
    "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
    "ja.wikipedia/all-access/user/{title}/monthly/{start}/{end}"
)

_COMEDY_HINTS = ("お笑い", "漫才", "コメディ")


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


def resolve_article(client: httpx.Client, name: str) -> str | None:
    """コンビ名からWikipedia記事タイトルを特定する。お笑い関連の記事のみ採用。"""
    candidates = [
        name,
        f"{name} (お笑いコンビ)",
        f"{name} (お笑いトリオ)",
        f"{name} (お笑い)",
    ]
    resp = client.get(
        WIKIPEDIA_API_URL,
        params={
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "titles": "|".join(candidates),
            "redirects": "1",
            "prop": "categories",
            "cllimit": "max",
        },
    )
    resp.raise_for_status()
    pages = resp.json().get("query", {}).get("pages", [])

    by_title = {}
    for page in pages:
        if page.get("missing") or page.get("invalid"):
            continue
        cats = " ".join(c.get("title", "") for c in page.get("categories", []))
        by_title[page["title"]] = any(h in cats for h in _COMEDY_HINTS)

    # リダイレクト解決後のタイトルで候補順に探す
    redirect_map = {}
    for r in resp.json().get("query", {}).get("redirects", []):
        redirect_map[r["from"]] = r["to"]
    for cand in candidates:
        title = redirect_map.get(cand, cand)
        if by_title.get(title):
            return title
    return None


def fetch_pageviews(client: httpx.Client, title: str) -> int | None:
    """直近12か月の閲覧数合計。"""
    today = date.today().replace(day=1)
    end = today - timedelta(days=1)  # 先月末
    start = (today - timedelta(days=365)).replace(day=1)
    url = PAGEVIEWS_URL.format(
        title=urllib.parse.quote(title.replace(" ", "_"), safe=""),
        start=start.strftime("%Y%m%d"),
        end=end.strftime("%Y%m%d"),
    )
    resp = client.get(url)
    if resp.status_code == 404:
        return None  # 期間内に閲覧データなし
    resp.raise_for_status()
    return sum(item.get("views", 0) for item in resp.json().get("items", []))


def fetch_popularity():
    pop_path = WORK_DIR / "popularity.json"
    data = {"source": "wikipedia-pageviews-12mo", "hits": {}}
    if pop_path.exists():
        prev = json.loads(pop_path.read_text(encoding="utf-8"))
        if prev.get("source") == data["source"]:
            data = prev

    targets = select_targets()
    todo = [t for t in targets if str(t["id"]) not in data["hits"]]
    print(f"[fetch-popularity] 対象 {len(targets)}組 / 未取得 {len(todo)}組 (Wikipedia閲覧数)")

    today = date.today().isoformat()
    found = 0
    with httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT}) as client:
        for n, t in enumerate(todo, 1):
            try:
                title = resolve_article(client, t["name"])
                views = fetch_pageviews(client, title) if title else None
            except httpx.HTTPError as e:
                print(f"[fetch-popularity] {t['name']}: 取得失敗 ({e}) スキップ")
                time.sleep(2)
                continue
            if title and views is not None:
                data["hits"][str(t["id"])] = {"n": views, "at": today, "title": title}
                found += 1
            if n % 25 == 0 or n == len(todo):
                pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                print(f"[fetch-popularity] {n}/{len(todo)} (記事あり {found})", flush=True)
            time.sleep(0.15)

    pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"[fetch-popularity] 完了: {len(data['hits'])}/{len(targets)}組に閲覧数 -> {pop_path}")
