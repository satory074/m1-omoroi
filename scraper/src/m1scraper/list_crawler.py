"""list.php の全コンビ列挙と差分検出。

一覧は20件/頁。行 = コンビID(リンク) / コンビ名 / 最新ステータス / 結成年。
"""

import json
import math
import re

from bs4 import BeautifulSoup

from .config import CACHE_DIR, COMBI_LIST_URL, STATE_DIR, WORK_DIR
from .http import Fetcher, decode_html

PER_PAGE = 20
_TOTAL_RE = re.compile(r"([\d,]+)件")
_ID_RE = re.compile(r"(\d+)\.html")


def list_url(page: int, year: int | None = None) -> str:
    url = COMBI_LIST_URL
    if year:
        url += f"&search_holdyear={year}"
    return url + f"&page={page}"


def parse_list_page(html: str) -> tuple[int | None, list[dict]]:
    """(総件数, [{id, name, status, formed}]) を返す。"""
    soup = BeautifulSoup(html, "lxml")
    total = None
    tm = _TOTAL_RE.search(soup.get_text())
    if tm:
        total = int(tm.group(1).replace(",", ""))

    rows = []
    table = soup.select_one("table.footable")
    if table:
        for tr in table.select("tbody tr"):
            tds = tr.find_all("td")
            if len(tds) < 3:
                continue
            link = tds[0].find("a")
            if not link or not link.get("href"):
                continue
            idm = _ID_RE.search(link["href"])
            if not idm:
                continue
            status_span = tds[1].find("span")
            rows.append(
                {
                    "id": int(idm.group(1)),
                    "name": link.get_text(strip=True),
                    "status": status_span.get_text(strip=True) if status_span else None,
                    "formed": tds[2].get_text(strip=True),
                }
            )
    return total, rows


def crawl_list(fetcher: Fetcher, year: int | None = None, refresh: bool = False) -> list[dict]:
    """全ページを巡回して行を集める。結果は work/list[_{year}].jsonl にも保存。"""
    tag = str(year) if year else "all"
    cache_dir = CACHE_DIR / "list" / tag

    first = decode_html(fetcher.get(list_url(1, year), cache_dir / "page_0001.html", force=refresh))
    total, rows = parse_list_page(first)
    if total is None:
        raise RuntimeError("総件数が取得できません(ページ構造変更?)")
    pages = math.ceil(total / PER_PAGE)
    print(f"[crawl-list {tag}] {total}件 / {pages}頁")

    all_rows = list(rows)
    for page in range(2, pages + 1):
        html = decode_html(
            fetcher.get(list_url(page, year), cache_dir / f"page_{page:04d}.html", force=refresh)
        )
        _, rows = parse_list_page(html)
        all_rows.extend(rows)
        if page % 100 == 0 or page == pages:
            print(f"[crawl-list {tag}] {page}/{pages}頁 ({len(all_rows)}件)")

    # 稀にページ境界で重複するため ID で一意化
    seen: dict[int, dict] = {}
    for r in all_rows:
        seen[r["id"]] = r
    result = sorted(seen.values(), key=lambda r: r["id"])

    if len(result) != total:
        print(f"[crawl-list {tag}] 警告: 取得 {len(result)}件 != 表示総数 {total}件")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    out = WORK_DIR / (f"list_{year}.jsonl" if year else "list.jsonl")
    with out.open("w", encoding="utf-8") as f:
        for r in result:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"[crawl-list {tag}] -> {out}")
    return result


def detect_changed(rows: list[dict], year: int) -> list[int]:
    """最新ステータスのスナップショットと比較し、変化したIDを返す(シーズン中の差分更新用)。"""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state_path = STATE_DIR / f"list_status_{year}.json"
    prev: dict[str, str] = {}
    if state_path.exists():
        prev = json.loads(state_path.read_text(encoding="utf-8"))

    current = {str(r["id"]): (r["status"] or "") for r in rows}
    changed = [int(cid) for cid, status in current.items() if prev.get(cid) != status]

    state_path.write_text(
        json.dumps(current, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8"
    )
    print(f"[detect-changed {year}] 変化: {len(changed)}件 (前回スナップショット: {len(prev)}件)")
    return changed
