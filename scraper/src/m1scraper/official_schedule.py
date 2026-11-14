"""M-1公式サイトの大会日程(準々決勝以降)の取得。

年度ページの回戦ナビの日付・回戦ごとの日程の行・コンビの出番チップの元データ。

公式の入口は2つ(APIキー不要):
- `schedule/json/meetlist.json` … {公式の回戦番号 "1"〜"7": [会場{id, holdyear, meet_day, ...}]}
- `schedule/json/{会場id}.json` … war(回戦名)・meet_day(20261118)・open_time/start_time(1830)・
  place(`[大阪] なんばグランド花月`)・place_mc・entrant[]({id=コンビID, group, name, result})

何を信じて何を捨てるか:
- 取るのは meetlist の "4"〜"7" の会場だけ(1〜3回戦は会場が100近くあり、日程として出さない)。
  ただし番号だけで回戦を決めず、会場JSONの `war` も見て**両方が同じ回戦を指す会場だけ**使う
  (公式が番号を振り直しても、別の回戦の日程を出さないため)。
- 曜日は公式の `week` ではなく日付から計算する。日付が開催年と違う・実在しない会場は捨てる。
- 1つの回戦で同じコンビが2会場に載っていたら、その組の出番は出さない(どちらか決められないため)。
- 取得が1件でも失敗したら、または使える会場が0件なら、前回の work を**上書きしない**
  (一部の会場だけ消えて、出番のチップが黙って消えるのを防ぐ)。

公式サーバーは1応答20秒・502/504 が出ることがある(2026-11-05 実績)ので、待ち時間を長めに取って再試行する。
update-popularity.yml が毎日取り直し、build が data/schedule.json へそのまま出す。
"""

import json
import re
import time
from datetime import date, datetime

import httpx

from .config import BASE_URL, USER_AGENT, WORK_DIR

SOURCE = "m1gp-schedule-v1"
MEETLIST_URL = BASE_URL + "/schedule/json/meetlist.json"
VENUE_URL = BASE_URL + "/schedule/json/{id}.json"
SCHEDULE_PAGE_URL = BASE_URL + "/schedule/"

# 公式の回戦番号(meetlist のキー) → 回戦キー。準々決勝以降だけ
MEETLIST_ROUNDS = {"4": "quarterfinal", "5": "semifinal", "6": "playoff", "7": "final"}
# 会場JSONの war(公式の回戦名) → 回戦キー
WAR_ROUNDS = {"準々決勝": "quarterfinal", "準決勝": "semifinal", "敗者復活戦": "playoff", "決勝": "final"}
ROUND_ORDER = list(MEETLIST_ROUNDS.values())

REQUEST_INTERVAL = 0.4  # 2〜4req/s の上限内
TIMEOUT = 90
ATTEMPTS = 4

WEEKDAYS = "月火水木金土日"
_UNDECIDED = {"", "調整中", "未定"}
_PLACE = re.compile(r"^\s*\[([^\]]+)\]\s*(.*?)\s*$")
_HHMM = re.compile(r"^(\d{1,2})(\d{2})$")


class _Getter:
    """間隔を空け、一時的なエラー(通信・429・5xx)だけ待って再試行する GET。"""

    def __init__(self, client: httpx.Client, interval: float, backoff: float):
        self.client = client
        self.interval = interval
        self.backoff = backoff
        self._last = 0.0

    def json(self, url: str):
        for attempt in range(ATTEMPTS):
            wait = self._last + self.interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                resp = self.client.get(url)
            except httpx.TransportError:
                resp = None
            if resp is not None and resp.status_code != 429 and resp.status_code < 500:
                resp.raise_for_status()
                return resp.json()
            if attempt < ATTEMPTS - 1:
                time.sleep(self.backoff * (attempt + 1))
        raise RuntimeError(f"取得失敗(再試行の上限): {url}")


def _blank(s) -> str | None:
    s = (s or "").strip()
    return None if s in _UNDECIDED else s


def _hhmm(s) -> str | None:
    m = _HHMM.match((s or "").strip())
    return f"{int(m.group(1))}:{m.group(2)}" if m else None


def parse_venue(raw: dict, expected_round: str, year: int) -> dict | None:
    """会場JSONを1件の日程にする。使えない会場(回戦の食い違い・日付の不正)は理由を出して None。"""
    vid = str(raw.get("id", "?"))
    war_round = WAR_ROUNDS.get((raw.get("war") or "").strip())
    if war_round != expected_round:
        print(f"[schedule] 会場{vid}: 回戦が食い違う(番号={expected_round} war={raw.get('war')!r})ので捨てます")
        return None
    try:
        day = datetime.strptime(str(raw.get("meet_day", "")), "%Y%m%d").date()
    except ValueError:
        print(f"[schedule] 会場{vid}: 日付が読めない({raw.get('meet_day')!r})ので捨てます")
        return None
    if day.year != year:
        print(f"[schedule] 会場{vid}: 日付 {day} が開催年 {year} と違うので捨てます")
        return None
    m = _PLACE.match(raw.get("place") or "")
    area, place = (m.group(1), m.group(2)) if m else (None, raw.get("place"))
    entrants = [str(e["id"]) for e in raw.get("entrant") or [] if str(e.get("id", "")).isdigit()]
    return {
        "id": vid,
        "date": day.isoformat(),
        "wd": WEEKDAYS[day.weekday()],
        "open": _hhmm(raw.get("open_time")),
        "start": _hhmm(raw.get("start_time")),
        "area": _blank(area),
        "place": _blank(place),
        "mc": _blank(raw.get("place_mc")),
        "entrants": entrants,
    }


def build_schedule(year: int, venues: dict[str, list[dict]]) -> dict:
    """回戦ごとの会場(parse_venue の結果)から配信の形を作る。
    combis = {コンビID: {回戦: 会場id}}。同じ回戦で2会場に載る組は入れない。"""
    rounds: dict[str, list[dict]] = {}
    combis: dict[str, dict[str, str]] = {}
    for rk in ROUND_ORDER:
        vs = sorted(venues.get(rk, []), key=lambda v: (v["date"], v["start"] or "", v["id"]))
        if not vs:
            continue
        where: dict[str, list[str]] = {}
        for v in vs:
            for cid in dict.fromkeys(v["entrants"]):
                where.setdefault(cid, []).append(v["id"])
        dup = sorted(cid for cid, ids in where.items() if len(ids) > 1)
        if dup:
            print(f"[schedule] {rk}: 2会場に載っている組は出番を出しません {dup[:10]}")
        for cid, ids in where.items():
            if len(ids) == 1:
                combis.setdefault(cid, {})[rk] = ids[0]
        rounds[rk] = [{**v, "entrants": len(v["entrants"])} for v in vs]
    return {
        "source": SOURCE,
        "url": SCHEDULE_PAGE_URL,
        "year": year,
        "fetchedAt": date.today().isoformat(),
        "rounds": rounds,
        "combis": dict(sorted(combis.items(), key=lambda kv: int(kv[0]))),
    }


def fetch_schedule(
    client: httpx.Client | None = None,
    out_path=None,
    interval: float = REQUEST_INTERVAL,
    backoff: float = 15.0,
) -> dict:
    out_path = out_path or WORK_DIR / "schedule.json"
    own = client is None
    client = client or httpx.Client(
        timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}, follow_redirects=True
    )
    get = _Getter(client, interval, backoff)
    try:
        try:
            meetlist = get.json(MEETLIST_URL)
            targets = [
                (rk, v)
                for key, rk in MEETLIST_ROUNDS.items()
                for v in meetlist.get(key) or []
                if str(v.get("id", "")).isdigit()
            ]
            years = {int(v["holdyear"]) for _, v in targets if str(v.get("holdyear", "")).isdigit()}
            if not years:
                raise SystemExit("[schedule] 準々決勝以降の会場が0件のため work を更新しません")
            # 年が混ざっていたら新しい年だけ(シーズンの変わり目の保険)
            year = max(years)
            venues: dict[str, list[dict]] = {}
            for rk, v in targets:
                if str(v.get("holdyear")) != str(year):
                    continue
                raw = get.json(VENUE_URL.format(id=v["id"]))
                raw["id"] = v["id"]
                parsed = parse_venue(raw, rk, year)
                if parsed:
                    venues.setdefault(rk, []).append(parsed)
        except (httpx.HTTPError, RuntimeError, ValueError, TypeError, KeyError, AttributeError) as e:
            # 一部の会場だけ欠けた日程を書かない(前回分を残す)
            raise SystemExit(f"[schedule] 取得に失敗したため work を更新しません: {e}")
    finally:
        if own:
            client.close()
    if not venues:
        raise SystemExit("[schedule] 使える会場が0件のため work を更新しません")
    data = build_schedule(year, venues)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    for rk, vs in data["rounds"].items():
        days = " / ".join(
            f"{v['date'][5:]}({v['wd']}) {v['area'] or ''} {v['place'] or '会場未定'} {v['entrants']}組"
            for v in vs
        )
        print(f"[schedule] {year} {rk}: {days}")
    print(f"[schedule] -> {out_path} (出番の分かる組 {len(data['combis'])})")
    return data


def check_against_years(schedule: dict, year_files: dict[int, dict]) -> None:
    """build のログ用: 日程の出場者と年度データのその回戦の出場組を突き合わせる(止めない)。"""
    yf = year_files.get(schedule.get("year"))
    if not yf:
        print(f"[build] 日程 {schedule.get('year')}: 年度データが無いので照合しません")
        return
    for rk in schedule.get("rounds", {}):
        in_schedule = {cid for cid, r in schedule.get("combis", {}).items() if rk in r}
        if not in_schedule:
            continue
        in_year = {str(e["id"]) for e in yf["entries"] if e.get("id") is not None and rk in e["results"]}
        only_s = sorted(in_schedule - in_year, key=int)
        only_y = sorted(in_year - in_schedule, key=int)
        line = f"[build] 日程 {schedule['year']} {rk}: 出番の分かる組 {len(in_schedule)}"
        if only_s:
            line += f" / 年度データにこの回戦が無い {len(only_s)} {only_s[:5]}"
        if only_y:
            line += f" / 日程に居ない {len(only_y)} {only_y[:5]}"
        print(line)


__all__ = ["build_schedule", "check_against_years", "fetch_schedule", "parse_venue"]
