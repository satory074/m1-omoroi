"""IDレンジ内で年度別一覧に現れなかったIDを直接叩いて実在するコンビを拾う。

年度別一覧(search_holdyear)の合算は、参加年が記録されていないコンビを取りこぼす
可能性がある(全件一覧の総数41,018 > 年度合算39,5xx)。存在しないIDは404ページに
リダイレクトされるため、取得後にコンビ名が取れるかで実在判定し、
実在すれば cache/combi/ に残す(次の parse-combi で取り込まれる)。

実行: uv run python scripts/probe_gaps.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from m1scraper.combi_parser import parse_combi_page
from m1scraper.config import CACHE_DIR, COMBI_DETAIL_URL, WORK_DIR
from m1scraper.http import Fetcher, decode_html

known = {json.loads(line)["id"] for line in (WORK_DIR / "list.jsonl").open(encoding="utf-8")}
max_id = max(known)
gaps = [i for i in range(1, max_id + 1) if i not in known]
cache_dir = CACHE_DIR / "combi"
todo = [i for i in gaps if not (cache_dir / f"{i}.html").exists()]
print(f"[probe-gaps] 欠けID {len(gaps)}件 / 未取得 {len(todo)}件 (max_id={max_id})")

found = 0
fetcher = Fetcher()
try:
    for n, combi_id in enumerate(todo, 1):
        path = cache_dir / f"{combi_id}.html"
        raw = fetcher.get(COMBI_DETAIL_URL.format(id=combi_id), path)
        rec = parse_combi_page(combi_id, decode_html(raw))
        if rec["name"] is None:
            path.unlink()  # 404ページはキャッシュに残さない
        else:
            found += 1
        if n % 200 == 0 or n == len(todo):
            print(f"[probe-gaps] {n}/{len(todo)} (実在 {found})", flush=True)
finally:
    fetcher.close()
print(f"[probe-gaps] 完了: 実在コンビ {found}件をキャッシュに追加")
