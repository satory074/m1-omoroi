"""Wikipedia「M-1グランプリ{year}」記事から決勝の得点表を取得する。

ファーストラウンド: ヘッダに「コンビ名」と得点系の列を持つ表
最終決戦:           ヘッダに「得票数」系の列を持つ表
表の構成は年により揺れるため、パース不能年は work/finals_report.json に記録し
overrides/finals/{year}.json の手動データで上書きできる(build時に優先)。
"""

import json
import re

from bs4 import BeautifulSoup

from .config import CACHE_DIR, WIKIPEDIA_API_URL, WORK_DIR
from .http import Fetcher

# 2001〜2010年は個別記事がリダイレクトのみのため、公式アーカイブ final.htm から取る(archive_parser)
FINALS_YEARS = list(range(2015, 2026))

# 検証用: 既知の優勝コンビ
KNOWN_CHAMPIONS = {
    2001: "中川家", 2002: "ますだおかだ", 2003: "フットボールアワー",
    2004: "アンタッチャブル", 2005: "ブラックマヨネーズ", 2006: "チュートリアル",
    2007: "サンドウィッチマン", 2008: "NON STYLE", 2009: "パンクブーブー",
    2010: "笑い飯", 2015: "トレンディエンジェル", 2016: "銀シャリ",
    2017: "とろサーモン", 2018: "霜降り明星", 2019: "ミルクボーイ",
    2020: "マヂカルラブリー", 2021: "錦鯉", 2022: "ウエストランド",
    2023: "令和ロマン", 2024: "令和ロマン", 2025: "たくろう",
}

# 2001〜2010の最終決戦の得票。公式アーカイブ final.htm に票数表が無いため手動補完する
# (archive_parser.parse_archive_finals が使用)。出典=各年 Wikipedia「M-1グランプリ{year}」。
# 各年 合計=7票(審査員7名。2001は特別審査員7名のみ投票、会場審査は最終決戦では投票せず)。
# 配列は得票降順・同票は1本目順位が上を先に(表示の準優勝/3位が正しく並ぶ)。championは得票最多から算出。
KNOWN_FINAL_ROUNDS: dict[int, list[dict]] = {
    2001: [{"name": "中川家", "votes": 6}, {"name": "ハリガネロック", "votes": 1}],
    2002: [{"name": "ますだおかだ", "votes": 5}, {"name": "フットボールアワー", "votes": 2}, {"name": "笑い飯", "votes": 0}],
    2003: [{"name": "フットボールアワー", "votes": 4}, {"name": "笑い飯", "votes": 3}, {"name": "アンタッチャブル", "votes": 0}],
    2004: [{"name": "アンタッチャブル", "votes": 6}, {"name": "南海キャンディーズ", "votes": 1}, {"name": "麒麟", "votes": 0}],
    2005: [{"name": "ブラックマヨネーズ", "votes": 4}, {"name": "笑い飯", "votes": 3}, {"name": "麒麟", "votes": 0}],
    2006: [{"name": "チュートリアル", "votes": 7}, {"name": "フットボールアワー", "votes": 0}, {"name": "麒麟", "votes": 0}],
    2007: [{"name": "サンドウィッチマン", "votes": 4}, {"name": "トータルテンボス", "votes": 2}, {"name": "キングコング", "votes": 1}],
    2008: [{"name": "NON STYLE", "votes": 5}, {"name": "オードリー", "votes": 2}, {"name": "ナイツ", "votes": 0}],
    2009: [{"name": "パンクブーブー", "votes": 7}, {"name": "笑い飯", "votes": 0}, {"name": "NON STYLE", "votes": 0}],
    2010: [{"name": "笑い飯", "votes": 4}, {"name": "スリムクラブ", "votes": 3}, {"name": "パンクブーブー", "votes": 0}],
}

_ORDER_LABELS = {"出番順", "出順", "ネタ順", "順番"}
_RANK_LABELS = {"順位", "結果"}
_TOTAL_LABELS = {"得点計", "得点合計", "合計", "総合得点", "合計点", "得点"}
_VOTE_LABELS = {"得票数", "票数", "得票"}


def _clean(text: str) -> str:
    """空白をすべて除去(ヘッダ比較用。縦書き<br>の審査員名を連結する)。"""
    text = re.sub(r"\[[^\]]*\]", "", text)  # [注 1] などの脚注
    return re.sub(r"[\s　\xa0]+", "", text)


def _squash(text: str) -> str:
    """空白を1つに正規化(コンビ名用。「NON STYLE」の空白を保持する)。"""
    text = re.sub(r"\[[^\]]*\]", "", text)
    return re.sub(r"[\s　\xa0]+", " ", text).strip()


def _table_to_grid(table) -> list[list[str]]:
    """rowspan/colspan を展開して文字列の格子にする。"""
    cells_at: dict[tuple[int, int], str] = {}
    for r, tr in enumerate(table.find_all("tr")):
        c = 0
        for cell in tr.find_all(["th", "td"]):
            # ソート用の不可視スパンやルビを除去(「ギン/銀シャリ」のような混入を防ぐ)
            for hidden in cell.find_all(style=re.compile(r"display\s*:\s*none")):
                hidden.decompose()
            for ruby in cell.find_all(["rt", "rp"]):
                ruby.decompose()
            while (r, c) in cells_at:
                c += 1
            text = _squash(cell.get_text())
            rowspan = int(cell.get("rowspan", 1) or 1)
            colspan = int(cell.get("colspan", 1) or 1)
            for dr in range(rowspan):
                for dc in range(colspan):
                    cells_at[(r + dr, c + dc)] = text
            c += colspan
    if not cells_at:
        return []
    n_rows = max(r for r, _ in cells_at) + 1
    n_cols = max(c for _, c in cells_at) + 1
    return [[cells_at.get((r, c), "") for c in range(n_cols)] for r in range(n_rows)]


def _to_int(text: str) -> int | None:
    m = re.search(r"\d+", text.replace(",", ""))
    return int(m.group(0)) if m else None


def parse_finals_page(year: int, html: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    first_round = None
    final_round = None
    judges: list[str] = []

    for table in soup.find_all("table"):
        grid = _table_to_grid(table)
        if len(grid) < 2:
            continue
        # ヘッダ比較は空白除去後の文字列で行う(「名 前」「縦書き審査員名」対策)
        header = [_clean(h) for h in grid[0]]
        vote_col = next((i for i, h in enumerate(header) if h in _VOTE_LABELS), None)
        total_col = next((i for i, h in enumerate(header) if h in _TOTAL_LABELS), None)
        if "コンビ名" in header:
            name_col = header.index("コンビ名")
        elif total_col is not None and header[0] == "" and len(header) >= 3:
            # 2009年公式final.htm形式: 先頭セルが空白でコンビ名列にヘッダがない
            name_col = 0
        else:
            continue

        if vote_col is not None and final_round is None:
            rows = []
            for row in grid[1:]:
                name = row[name_col]
                if not name or name == "コンビ名":
                    continue
                rows.append({"name": name, "votes": _to_int(row[vote_col])})
            if rows:
                max_votes = max((r["votes"] or 0) for r in rows)
                for r in rows:
                    r["champion"] = r["votes"] == max_votes and max_votes > 0
                final_round = rows
            continue

        if total_col is not None and first_round is None:
            order_col = next((i for i, h in enumerate(header) if h in _ORDER_LABELS), None)
            rank_col = next((i for i, h in enumerate(header) if h in _RANK_LABELS), None)
            known = {name_col, total_col, order_col, rank_col}
            judge_cols = [
                i
                for i, h in enumerate(header)
                if i not in known and h and h not in _ORDER_LABELS | _RANK_LABELS
            ]
            judges = [header[i] for i in judge_cols]
            rows = []
            for row in grid[1:]:
                name = row[name_col]
                if not name or name == "コンビ名":
                    continue
                total = _to_int(row[total_col])
                if total is None:
                    continue
                rows.append(
                    {
                        "order": _to_int(row[order_col]) if order_col is not None else None,
                        "name": name,
                        "scores": [_to_int(row[i]) for i in judge_cols],
                        "total": total,
                        "rank": _to_int(row[rank_col]) if rank_col is not None else None,
                    }
                )
            if rows:
                if all(r["rank"] is None for r in rows):
                    for rank, r in enumerate(
                        sorted(rows, key=lambda r: -(r["total"] or 0)), start=1
                    ):
                        r["rank"] = rank
                first_round = rows

    if not first_round:
        return None
    return {
        "year": year,
        "judges": judges,
        "firstRound": first_round,
        "finalRound": final_round or [],
        "source": f"https://ja.wikipedia.org/wiki/M-1グランプリ{year}",
    }


def crawl_finals(fetcher: Fetcher, years: list[int] | None = None):
    out_dir = WORK_DIR / "finals"
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {}
    for year in years or FINALS_YEARS:
        cache_path = CACHE_DIR / "wikipedia" / f"{year}.json"
        url = (
            f"{WIKIPEDIA_API_URL}?action=parse&page=M-1グランプリ{year}"
            "&prop=text&format=json&formatversion=2"
        )
        raw = fetcher.get(url, cache_path)
        payload = json.loads(raw)
        if "parse" not in payload:
            report[year] = "記事が取得できません"
            print(f"[crawl-finals] {year}: 記事なし")
            continue
        data = parse_finals_page(year, payload["parse"]["text"])
        if data is None:
            report[year] = "得点表をパースできません"
            print(f"[crawl-finals] {year}: パース失敗(overrides/finals/{year}.json で補完してください)")
            continue

        champion = next((r["name"] for r in data["finalRound"] if r.get("champion")), None)
        expected = KNOWN_CHAMPIONS.get(year)
        if expected and champion != expected:
            report[year] = f"優勝者不一致: 期待={expected} 取得={champion}"
            print(f"[crawl-finals] {year}: 警告 {report[year]}")

        (out_dir / f"{year}.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        n_final = len(data["finalRound"])
        print(
            f"[crawl-finals] {year}: 審査員{len(data['judges'])}名 "
            f"1st {len(data['firstRound'])}組 / 最終 {n_final}組 / 優勝 {champion}"
        )

    (WORK_DIR / "finals_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    if report:
        print(f"[crawl-finals] 要確認: {report}")
