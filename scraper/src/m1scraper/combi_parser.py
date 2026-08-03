"""コンビ詳細ページのパーサ。

成績は <meta name="description"> に全年度分が埋め込まれている:
  漫才頂上決戦『M-1グランプリ』出場コンビ オズワルド
  [2026年 エントリーNo.4406] １回戦：シード権獲得により通過
  [2025年 エントリーNo.5372] １回戦：… ２回戦：通過 …
"""

import re

from bs4 import BeautifulSoup

from .models import ROUND_NAME_TO_KEY, normalize_result

_YEAR_BLOCK_RE = re.compile(r"\[(\d{4})年(?:\s*エントリーNo\.(\d+))?\]")
_ROUND_RE = re.compile(r"(１回戦|1回戦|２回戦|2回戦|３回戦|3回戦|準々決勝|準決勝|敗者復活戦|決勝戦|決勝)：")
_FORMED_YEAR_RE = re.compile(r"(\d{4})年")


def parse_history(description: str) -> dict[str, dict]:
    """meta description → {year: {"no": int|None, "results": {round: result}, "raw": {...}}}"""
    history: dict[str, dict] = {}
    blocks = list(_YEAR_BLOCK_RE.finditer(description))
    for i, m in enumerate(blocks):
        year = m.group(1)
        entry_no = int(m.group(2)) if m.group(2) else None
        seg_end = blocks[i + 1].start() if i + 1 < len(blocks) else len(description)
        segment = description[m.end() : seg_end]

        results: dict[str, str] = {}
        raws: dict[str, str] = {}
        rounds = list(_ROUND_RE.finditer(segment))
        for j, rm in enumerate(rounds):
            round_key = ROUND_NAME_TO_KEY[rm.group(1)]
            val_end = rounds[j + 1].start() if j + 1 < len(rounds) else len(segment)
            raw_value = segment[rm.end() : val_end]
            # 生HTMLフォールバック時は属性の切れ目やタグの手前までを値とする
            raw_value = re.split(r'["<\n]', raw_value)[0].strip()[:50]
            key, unknown_raw = normalize_result(raw_value)
            results[round_key] = key
            if unknown_raw is not None:
                raws[round_key] = unknown_raw
        entry: dict = {"no": entry_no, "results": results}
        if raws:
            entry["raw"] = raws
        history[year] = entry
    return history


def parse_combi_page(combi_id: int, html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")

    meta = soup.find("meta", attrs={"name": "description"})
    description = meta["content"] if meta else ""
    history = parse_history(description)
    if not history:
        # コンビ名にダブルクォートを含むとサイト側のmeta属性が壊れて成績が切れる
        # (例: 九州男子")。その場合は生HTML全体から年ブロックを拾う
        history = parse_history(html)

    name_el = soup.select_one(".name-txt-full")
    kana_el = soup.select_one(".name-txt-kana")

    # 宣材写真はog:imageに絶対URLで入っている。デフォルト画像(img_emptyPic)は写真なし扱い。
    # 配信JSONの肥大を抑えるためサイト共通プレフィックスを除いた相対パスで保存する
    photo = None
    og = soup.find("meta", attrs={"property": "og:image"})
    if og and og.get("content") and "image_cms" in og["content"]:
        photo = og["content"].removeprefix("https://www.m-1gp.com/combi/")

    formed_raw = None
    belong = None
    profile = soup.select_one(".profile-info dl")
    if profile:
        pairs = _parse_dl(profile)
        formed_raw = pairs.get("結成年")
        belong = pairs.get("所属")

    members = []
    for con in soup.select(".member-list-con dl"):
        pairs = _parse_dl(con)
        member = {
            "name": pairs.get("名前"),
            "kana": pairs.get("フリガナ"),
            "birth": pairs.get("生年月日"),
            "from": pairs.get("出身"),
            "job": pairs.get("職業"),
        }
        members.append({k: v for k, v in member.items() if v})

    formed_year = None
    if formed_raw:
        fm = _FORMED_YEAR_RE.search(formed_raw)
        if fm:
            formed_year = int(fm.group(1))

    return {
        "id": combi_id,
        "name": name_el.get_text(strip=True) if name_el else None,
        "kana": kana_el.get_text(strip=True) if kana_el else None,
        "formed": formed_year,
        "formedRaw": formed_raw,
        "belong": belong,
        "members": members,
        "photo": photo,
        "history": history,
    }


def _parse_dl(dl) -> dict[str, str]:
    pairs = {}
    key = None
    for el in dl.find_all(["dt", "dd"]):
        if el.name == "dt":
            key = el.get_text(strip=True)
        elif key:
            pairs[key] = el.get_text(strip=True)
            key = None
    return pairs
