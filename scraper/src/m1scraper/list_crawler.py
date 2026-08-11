"""list.php の全コンビ列挙と差分検出。

一覧は20件/頁。行 = コンビID(リンク) / コンビ名 / 最新ステータス / 結成年。
"""

import json
import math
import re

from bs4 import BeautifulSoup

from .config import CACHE_DIR, COMBI_LIST_URL, STATE_DIR, WORK_DIR
from .http import Fetcher, decode_html
from .models import ROUND_NAME_TO_KEY

PER_PAGE = 20
_TOTAL_RE = re.compile(r"([\d,]+)件")
_ID_RE = re.compile(r"(\d+)\.html")
# list.php の最新ステータス "2026年 １回戦：敗退" から (年, 回戦名, 結果) を取る
_STATUS_RE = re.compile(r"\s*(\d{4})年\s*(.+?)：(.+?)\s*$")
# list.php の結果表記 → 正規化キー。詳細ページの meta とは表記が違う点に注意
# (list は「シード通過」、meta は「シード権獲得により通過」)。未確定は scheduled で除外
_LIST_RESULT_TO_KEY = {
    "通過": "pass",
    "敗退": "fail",
    "シード通過": "seed_pass",
    "欠席": "absent",
    "優勝": "champion",
    "出場予定": "scheduled",
}


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


def parse_list_status(status: str | None, year: int) -> tuple[str, str] | None:
    """list.php の最新ステータスから対象年の (回戦キー, 結果キー) を返す。

    対象年でない・回戦が無い(「2026年 出場予定」)・表記が未知なら None。
    """
    if not status:
        return None
    m = _STATUS_RE.match(status)
    if not m or int(m.group(1)) != year:
        return None
    round_key = ROUND_NAME_TO_KEY.get(m.group(2).strip())
    result_key = _LIST_RESULT_TO_KEY.get(m.group(3).strip())
    if round_key is None or result_key is None:
        return None
    return round_key, result_key


def _load_parsed_results(year: int) -> dict[int, dict]:
    """combi.jsonl(無ければ .gz)から {id: {回戦: 結果}} を読む。"""
    import gzip

    jsonl = WORK_DIR / "combi.jsonl"
    gz = WORK_DIR / "combi.jsonl.gz"
    if jsonl.exists():
        opener = jsonl.open("rt", encoding="utf-8")
    elif gz.exists():
        opener = gzip.open(gz, "rt", encoding="utf-8")
    else:
        raise RuntimeError("combi.jsonl(.gz) がありません。先に parse-combi を実行してください")
    parsed: dict[int, dict] = {}
    with opener as f:
        for line in f:
            rec = json.loads(line)
            hist = rec.get("history", {}).get(str(year))
            if hist:
                parsed[rec["id"]] = hist.get("results", {})
    return parsed


def detect_stale(year: int) -> list[int]:
    """list.php が確定結果を示すのに、パース済み詳細が追随していないIDを返す。

    list.php は詳細ページ(meta description)より先に更新される。detect_changed は
    list ステータス文字列の変化しか見ないため『list が確定 → 後から詳細が確定』した組は
    list が既に確定済みで変化が起きず、取りこぼす。ここで詳細を実結果と突き合わせて回収する。
    """
    list_path = WORK_DIR / f"list_{year}.jsonl"
    if not list_path.exists():
        raise RuntimeError(f"{list_path} がありません。先に crawl-list --year {year} を実行してください")

    parsed = _load_parsed_results(year)
    stale: list[int] = []
    for line in list_path.open(encoding="utf-8"):
        row = json.loads(line)
        st = parse_list_status(row.get("status"), year)
        if st is None:
            continue
        round_key, result_key = st
        if result_key == "scheduled":  # 未確定は対象外
            continue
        if parsed.get(row["id"], {}).get(round_key) != result_key:
            stale.append(row["id"])

    out = WORK_DIR / f"stale_{year}.json"
    out.write_text(json.dumps(sorted(stale)), encoding="utf-8")
    print(f"[detect-stale {year}] 追随漏れ: {len(stale)}件 -> {out}")
    return stale
