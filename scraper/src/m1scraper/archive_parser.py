"""2001〜2010年 公式アーカイブのパーサ。

ページ形式(全年共通の傾向):
  - 日付ページ <h1> に「8/30(土) １回戦 大阪１ base よしもと」のように回戦名を含む
  - 「■合格者一覧■」: テーブル行 = 通過者のみ(主に1回戦)
  - 「■出場者一覧■ 赤字が合格者です」: 赤字(<font color="#FF0000">) = 通過、黒字 = 敗退
  - final.htm: 決勝の得点表。1行目のコンビ = 優勝

1回戦の敗退者は公式記録がないため導出不能。2回戦以降で通過者のみの回戦は
「前回戦の通過者 − 当該回戦に登場した者」を fail_inferred として補完する。
"""

import json
import re

import httpx
from bs4 import BeautifulSoup

from .config import ARCHIVE_INDEX_URL, ARCHIVE_YEARS, BASE_URL, CACHE_DIR, WORK_DIR
from .http import Fetcher, decode_html
from .models import ROUND_KEYS, ROUND_NAME_TO_KEY

# 年によりURL形式が異なる: 0830.htm / 0902.html / 0830/index.htm / final.html / final/index.html
_PAGE_RE = re.compile(r'href="((?:\d{4}\w*|final)(?:/index)?\.html?)"', re.I)
_AGENCY_RE = re.compile(r"^(.*?)[（(]([^（()）]+)[)）]$")
_ROUND_IN_H1_RE = re.compile(r"(１回戦|1回戦|２回戦|2回戦|３回戦|3回戦|準々決勝|準決勝|敗者復活戦|決勝戦|決勝)")


def crawl_archive(fetcher: Fetcher, years: list[int] | None = None):
    for year in years or ARCHIVE_YEARS:
        cache_dir = CACHE_DIR / "archive" / str(year)
        index_url = ARCHIVE_INDEX_URL.format(year=year)
        index_html = decode_html(fetcher.get(index_url, cache_dir / "index.htm"))
        pages = sorted(set(_PAGE_RE.findall(index_html)))
        # 2010年のようにインデックスから未リンクの final.htm が存在する年がある
        if not any(p.startswith("final") for p in pages):
            pages.append("final.htm")
        print(f"[crawl-archive {year}] {len(pages)}ページ")
        for page in pages:
            try:
                fetcher.get(f"{BASE_URL}/archive/{year}/{page}", cache_dir / page.replace("/", "_"))
            except httpx.HTTPStatusError as e:
                print(f"[crawl-archive {year}] {page}: {e.response.status_code} スキップ")


def split_name_agency(cell_text: str) -> tuple[str, str | None]:
    text = re.sub(r"[\s　\xa0]+", " ", cell_text).strip()
    m = _AGENCY_RE.match(text)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return text, None


def parse_result_page(html: str) -> tuple[str | None, list[tuple[str, str | None, bool | None]]]:
    """日付ページ → (回戦キー, [(名前, 事務所, 通過フラグ or None)])。

    通過フラグ: 出場者一覧形式なら True/False、合格者一覧形式なら全員 True。
    結果テーブルでなければ (None, []) を返す。
    """
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.find("h1")
    if not h1:
        return None, []
    rm = _ROUND_IN_H1_RE.search(h1.get_text())
    if not rm:
        return None, []
    round_key = ROUND_NAME_TO_KEY[rm.group(1)]

    page_text = soup.get_text()
    is_marked = "赤字が合格者" in page_text
    is_pass_list = "合格者一覧" in page_text

    # 赤字は <font color="#FF0000"> のほか、CSSクラス(.style1 {color:#FF0000} 等)の年もある
    red_classes = set(re.findall(r"\.([\w-]+)\s*\{[^}]*color\s*:\s*#?FF0000", html, re.I))

    def is_red(td) -> bool:
        if td.find("font", attrs={"color": re.compile("#?FF0000", re.I)}):
            return True
        if red_classes:
            for el in td.find_all(class_=True):
                if red_classes & set(el.get("class", [])):
                    return True
        if td.find(attrs={"style": re.compile(r"color\s*:\s*#?FF0000", re.I)}):
            return True
        return False

    rows: list[tuple[str, str | None, bool | None]] = []
    for table in soup.find_all("table"):
        first_tr = table.find("tr")
        header = [td.get_text(strip=True) for td in first_tr.find_all("td")] if first_tr else []

        if len(header) >= 2 and any("合格者" in h for h in header):
            # 2003〜2005年形式: 出場者/名前 | 合格者(花マーク画像) [| インタビュー]
            pass_col = next(i for i, h in enumerate(header) if "合格者" in h)
            for tr in table.find_all("tr")[1:]:
                tds = tr.find_all("td")
                if len(tds) <= pass_col:
                    continue
                name, agency = split_name_agency(tds[0].get_text())
                if not name:
                    continue
                rows.append((name, agency, tds[pass_col].find("img") is not None))
            continue

        if not (is_marked or is_pass_list):
            continue
        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            # 1列(名前のみ) または 2列(グループ|名前, 2007年形式)。得点表などはスキップ
            if len(tds) not in (1, 2):
                continue
            td = tds[-1]
            text = td.get_text()
            name, agency = split_name_agency(text)
            if not name or name in ("名前", "グループ"):
                continue
            if is_marked:
                rows.append((name, agency, is_red(td)))
            else:
                rows.append((name, agency, True))
    return round_key, rows


def parse_archive_finals(year: int, html: str) -> dict | None:
    """final.htm の得点表を Wikipedia と同じスキーマにする。"""
    from .wikipedia_finals import KNOWN_CHAMPIONS, parse_finals_page

    data = parse_finals_page(year, html)
    if data is None:
        return None
    data["source"] = f"{BASE_URL}/archive/{year}/final.htm"
    champion = KNOWN_CHAMPIONS.get(year)
    if not data["finalRound"] and champion:
        data["finalRound"] = [{"name": champion, "votes": None, "champion": True}]
    return data


def parse_archive():
    """キャッシュ済みアーカイブから年度データを構築 → work/archive_years.json"""
    out: dict[str, dict] = {}
    for year in ARCHIVE_YEARS:
        cache_dir = CACHE_DIR / "archive" / str(year)
        if not cache_dir.exists():
            print(f"[parse-archive] {year}: キャッシュなし、スキップ")
            continue
        year_data = _parse_year(year, cache_dir)
        if year_data:
            out[str(year)] = year_data

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    path = WORK_DIR / "archive_years.json"
    path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"[parse-archive] -> {path}")


def _parse_year(year: int, cache_dir) -> dict | None:
    # 回戦ごとに (名前 → (事務所, 通過フラグ)) を集約
    passed: dict[str, dict[str, str | None]] = {}
    failed: dict[str, dict[str, str | None]] = {}
    marked_rounds: set[str] = set()

    for path in sorted(cache_dir.glob("*.htm*")):
        if path.name.startswith(("index", "final")):
            continue
        round_key, rows = parse_result_page(decode_html(path.read_bytes()))
        if not round_key or not rows:
            continue
        has_marks = any(flag is not None and not flag for _, _, flag in rows)
        if has_marks:
            marked_rounds.add(round_key)
        for name, agency, ok in rows:
            (passed if ok else failed).setdefault(round_key, {})[name] = agency

    final_path = next(
        (
            cache_dir / name
            for name in ("final.htm", "final.html", "final_index.html", "final_index.htm")
            if (cache_dir / name).exists()
        ),
        None,
    )
    finals_data = None
    if final_path:
        finals_data = parse_archive_finals(year, decode_html(final_path.read_bytes()))
        if finals_data:
            finals_dir = WORK_DIR / "finals"
            finals_dir.mkdir(parents=True, exist_ok=True)
            (finals_dir / f"{year}.json").write_text(
                json.dumps(finals_data, ensure_ascii=False, indent=1), encoding="utf-8"
            )
        else:
            print(f"[parse-archive] {year}: final.htm の得点表をパースできません")

    if not passed and not finals_data:
        print(f"[parse-archive] {year}: 結果ページが見つかりません")
        return None

    # 通過者しか載らない回戦の敗退者を前回戦の通過者から導出
    chain = [rk for rk in ROUND_KEYS if rk in passed or rk in failed]
    inferred: dict[str, set[str]] = {}
    for prev, cur in zip(chain, chain[1:]):
        if cur in marked_rounds or cur == "playoff":
            continue
        appeared = set(passed.get(cur, {})) | set(failed.get(cur, {}))
        inferred[cur] = set(passed.get(prev, {})) - appeared

    # 決勝: finalists のうち先頭が優勝
    results: dict[str, dict[str, str]] = {}
    agencies: dict[str, str] = {}

    def set_result(name: str, round_key: str, result: str, agency: str | None = None):
        results.setdefault(name, {})[round_key] = result
        if agency:
            agencies.setdefault(name, agency)

    for rk, members in passed.items():
        for name, agency in members.items():
            set_result(name, rk, "pass", agency)
    for rk, members in failed.items():
        for name, agency in members.items():
            set_result(name, rk, "fail", agency)
    for rk, names in inferred.items():
        for name in names:
            # 前回戦通過者が当該回戦に現れない = 敗退(推定)。棄権の可能性もあるため区別する
            set_result(name, rk, "fail_inferred")
    if finals_data:
        from .wikipedia_finals import KNOWN_CHAMPIONS

        champion = KNOWN_CHAMPIONS.get(year)
        for row in finals_data["firstRound"]:
            set_result(row["name"], "final", "champion" if row["name"] == champion else "fail")

    entries = [
        {
            "id": None,
            "no": None,
            "name": name,
            "kana": None,
            "agency": agencies.get(name),
            "results": res,
        }
        for name, res in results.items()
    ]
    entries.sort(key=lambda e: e["name"])

    counts = {rk: sum(1 for e in entries if rk in e["results"]) for rk in ROUND_KEYS}
    print(f"[parse-archive] {year}: {len(entries)}組 " + " ".join(f"{k}:{v}" for k, v in counts.items() if v))

    return {
        "year": year,
        "source": "official-archive",
        "rounds": ROUND_KEYS,
        "notes": "公式アーカイブ由来。1回戦で敗退したコンビは記録が残っていないため含まれません。",
        "entries": entries,
    }
