"""Google Custom Search JSON API でコンビ名の検索ヒット件数を取得する。

- 対象: 準々決勝以上に進出経験のあるコンビのみ(全41k組は費用的に不可)
- クエリ: "コンビ名" M-1 (同名の一般語と混ざるのを避ける)
- 日次予算(--budget)に達したら即停止。取得済みはスキップするので
  無料枠(100/日)でも数日に分けて完走できる
- 認証: scraper/.env の GOOGLE_CSE_KEY / GOOGLE_CSE_CX
"""

import json
import time
from datetime import date

import httpx

from .config import SCRAPER_ROOT, WORK_DIR

CSE_URL = "https://www.googleapis.com/customsearch/v1"


def _load_env() -> dict[str, str]:
    env = {}
    env_path = SCRAPER_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip().strip('"')
    return env


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


def fetch_popularity(budget: int = 95):
    env = _load_env()
    key = env.get("GOOGLE_CSE_KEY")
    cx = env.get("GOOGLE_CSE_CX")
    if not key or not cx:
        raise SystemExit(
            "scraper/.env に GOOGLE_CSE_KEY と GOOGLE_CSE_CX を設定してください\n"
            "(https://programmablesearchengine.google.com/ で検索エンジンを作成し、\n"
            " https://developers.google.com/custom-search/v1/introduction でAPIキーを取得)"
        )

    pop_path = WORK_DIR / "popularity.json"
    data = {"hits": {}}
    if pop_path.exists():
        data = json.loads(pop_path.read_text(encoding="utf-8"))

    targets = select_targets()
    todo = [t for t in targets if str(t["id"]) not in data["hits"]]
    print(f"[fetch-popularity] 対象 {len(targets)}組 / 未取得 {len(todo)}組 / 今回の予算 {budget}件")

    today = date.today().isoformat()
    used = 0
    with httpx.Client(timeout=30.0) as client:
        for t in todo:
            if used >= budget:
                print(f"[fetch-popularity] 予算 {budget}件に達したため停止(残り {len(todo) - used}組)")
                break
            resp = client.get(
                CSE_URL,
                params={"key": key, "cx": cx, "q": f'"{t["name"]}" M-1', "num": 1},
            )
            used += 1
            if resp.status_code == 429:
                print("[fetch-popularity] APIのレート制限(429)。本日はここまでにします")
                break
            resp.raise_for_status()
            total = int(resp.json().get("searchInformation", {}).get("totalResults", 0))
            data["hits"][str(t["id"])] = {"n": total, "at": today}
            pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            print(f"[fetch-popularity] {t['name']}: {total:,}件 ({used}/{min(budget, len(todo))})")
            time.sleep(1.0)

    done = sum(1 for t in targets if str(t["id"]) in data["hits"])
    print(f"[fetch-popularity] 進捗 {done}/{len(targets)}組 -> {pop_path}")
