"""M-1公式サイトの大会日程(1回戦〜決勝)の取得。

年度ページの回戦ナビの日付・回戦ごとの日程の行・コンビの出番チップ(「11/18(水) 大阪 13組目」)・
出番順の並べ替え・会場の絞り込みの元データ。

公式の入口は2つ(APIキー不要):
- `schedule/json/meetlist.json` … {公式の回戦番号 "1"〜"7": [会場{id, holdyear, meet_day, ...}]}
- `schedule/json/{会場id}.json` … war(回戦名)・meet_day(20261118)・open_time/start_time(1830)・
  place(`[大阪] なんばグランド花月`)・place_mc・entrant[]({id=コンビID, group, name, result})

何を信じて何を捨てるか:
- 取るのは meetlist の "1"〜"7" の全会場(2026年で約105会場)。番号だけで回戦を決めず、
  会場JSONの `war`(「３回戦」のように全角数字があるので NFKC で読む)も見て**両方が同じ回戦を指す会場だけ**使う
  (公式が番号を振り直しても、別の回戦の日程を出さないため)。
- `entrant[]` の並びは出番順(2026年 大阪3回戦で、敗退組の公式動画「1〜3組目」と全30組一致を確認)。
  work には会場ごとの並びをそのまま残し、build が出番(会場内の位置、1始まり)にする。
- 開催日が2日以上前で、前回の work に出場者の載っている会場は取り直さず前回分を使う
  (終わった会場の出番は変わらない。毎日100件を取りに行かないため)。
- 曜日は公式の `week` ではなく日付から計算する。日付が開催年と違う・実在しない会場は捨てる。
- 1つの回戦で同じコンビが2会場に載っていたら、両方の出番を残す(1回戦の「再エントリー専用の日程」)。
- 欠席の組は出番に数えない。
- 取得が1件でも失敗したら、または使える会場が0件なら、前回の work を**上書きしない**
  (一部の会場だけ消えて、出番のチップが黙って消えるのを防ぐ)。

公式サーバーは1応答20秒・502/504 が出ることがある(2026-11-05 実績)ので、待ち時間を長めに取って再試行する。
update-popularity.yml が毎日取り直し、build が data/schedule.json へそのまま出す。
"""

import json
import re
import time
import unicodedata
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from .config import BASE_URL, USER_AGENT, WORK_DIR

# v2: 会場ごとの出場者をID列(出番順)で持つ。v1 は人数だけ
SOURCE = "m1gp-schedule-v2"
MEETLIST_URL = BASE_URL + "/schedule/json/meetlist.json"
VENUE_URL = BASE_URL + "/schedule/json/{id}.json"
SCHEDULE_PAGE_URL = BASE_URL + "/schedule/"

# 公式の回戦番号(meetlist のキー) → 回戦キー
MEETLIST_ROUNDS = {
    "1": "first",
    "2": "second",
    "3": "third",
    "4": "quarterfinal",
    "5": "semifinal",
    "6": "playoff",
    "7": "final",
}
# 会場JSONの war(公式の回戦名を NFKC にしたもの) → 回戦キー
WAR_ROUNDS = {
    "1回戦": "first",
    "2回戦": "second",
    "3回戦": "third",
    "準々決勝": "quarterfinal",
    "準決勝": "semifinal",
    "敗者復活戦": "playoff",
    "決勝": "final",
}
ROUND_ORDER = list(MEETLIST_ROUNDS.values())

REQUEST_INTERVAL = 0.4  # 2〜4req/s の上限内
# 開催日からこの日数が過ぎた会場は、前回の work に出場者があれば取り直さない
REUSE_AFTER_DAYS = 2
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
    war_round = WAR_ROUNDS.get(unicodedata.normalize("NFKC", raw.get("war") or "").strip())
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
    # 欠席の組は出番に数えない(載ったままにすると、後ろの組の「N組目」が実際の順より1つずつ大きくなる)
    entrants = [
        str(e["id"])
        for e in raw.get("entrant") or []
        if str(e.get("id", "")).isdigit() and (e.get("result") or "").strip() != "欠席"
    ]
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
    """回戦ごとの会場(parse_venue の結果)から work の形を作る。会場は日付・開演・ID順、
    各会場の `entrants` は公式の並び(出番順)のコンビIDの列のまま。"""
    rounds: dict[str, list[dict]] = {}
    for rk in ROUND_ORDER:
        vs = sorted(venues.get(rk, []), key=lambda v: (v["date"], v["start"] or "", int(v["id"])))
        if vs:
            rounds[rk] = vs
    return {
        "source": SOURCE,
        "url": SCHEDULE_PAGE_URL,
        "year": year,
        "fetchedAt": date.today().isoformat(),
        "rounds": rounds,
    }


def round_slots(work: dict) -> dict[str, list[tuple[str, list[int]]]]:
    """回戦 → [(会場ID, 出番順のコンビID列)]。
    同じ回戦で2会場に載る組はそのまま両方に残す: 1回戦には敗退組の「再エントリー専用の日程」があり
    (2026年は約960組)、どちらの出番も実際に行われている。年度ページは会場で絞ればその会場の出番、
    絞らなければ遅い方(結果を決めた方)の出番を出す。"""
    return {
        rk: [(v["id"], [int(c) for c in v["entrants"]]) for v in vs if isinstance(v.get("entrants"), list)]
        for rk, vs in work.get("rounds", {}).items()
    }


def public_schedule(work: dict) -> tuple[dict, dict[str, dict[str, list[int]]]]:
    """work → (data/schedule.json, {回戦: data/schedule/{回戦}.json})。
    schedule.json は会場の一覧と人数だけ(年度ページがこれの到着を待つので小さく保つ)。
    回戦ファイルは {会場ID: [コンビID…出番順、出せない組は0]}。その回戦を開いたときだけ読まれる。"""
    rounds = {
        rk: [{**v, "entrants": len(v["entrants"]) if isinstance(v.get("entrants"), list) else int(v.get("entrants") or 0)} for v in vs]
        for rk, vs in work.get("rounds", {}).items()
    }
    head = {k: work[k] for k in ("source", "url", "year", "fetchedAt") if k in work}
    files = {rk: dict(lists) for rk, lists in round_slots(work).items() if lists}
    for rk, lists in files.items():
        seen: dict[int, int] = {}
        for ids in lists.values():
            for c in ids:
                seen[c] = seen.get(c, 0) + 1
        twice = sum(1 for n in seen.values() if n > 1)
        if twice:
            print(f"[schedule] {rk}: 2会場以上に出番のある組 {twice}(1回戦は再エントリー)")
    return {**head, "rounds": rounds}, files


def _previous_venues(out_path, year: int) -> dict[tuple[str, str], dict]:
    """前回の work の会場 {(回戦, 会場ID): 会場}。版や年が違う・読めなければ空(全部取り直す)。"""
    try:
        prev = json.loads(out_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(prev, dict) or prev.get("source") != SOURCE or prev.get("year") != year:
        return {}
    return {
        (rk, str(v["id"])): v
        for rk, vs in (prev.get("rounds") or {}).items()
        for v in vs
        if isinstance(v, dict) and isinstance(v.get("entrants"), list)
    }


def fetch_schedule(
    client: httpx.Client | None = None,
    out_path=None,
    interval: float = REQUEST_INTERVAL,
    backoff: float = 15.0,
    today: date | None = None,
) -> dict:
    out_path = out_path or WORK_DIR / "schedule.json"
    today = today or datetime.now(ZoneInfo("Asia/Tokyo")).date()
    reuse_until = (today - timedelta(days=REUSE_AFTER_DAYS)).isoformat()
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
                raise SystemExit("[schedule] 会場が0件のため work を更新しません")
            # 年が混ざっていたら新しい年だけ(シーズンの変わり目の保険)
            year = max(years)
            previous = _previous_venues(out_path, year)
            venues: dict[str, list[dict]] = {}
            reused = 0
            for rk, v in targets:
                if str(v.get("holdyear")) != str(year):
                    continue
                old = previous.get((rk, str(v["id"])))
                if old and old["entrants"] and old["date"] <= reuse_until:
                    venues.setdefault(rk, []).append(old)
                    reused += 1
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
    # 会場ごとのID列は1行に詰める(1回戦だけで約1.2万組あり、1件1行だと work が縦に長くなりすぎる)
    out_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for rk, vs in data["rounds"].items():
        total = sum(len(v["entrants"]) for v in vs)
        if len(vs) <= 9:
            days = " / ".join(
                f"{v['date'][5:]}({v['wd']}) {v['area'] or ''} {v['place'] or '会場未定'} {len(v['entrants'])}組"
                for v in vs
            )
        else:
            days = f"{vs[0]['date'][5:]}〜{vs[-1]['date'][5:]}"
        print(f"[schedule] {year} {rk}: {len(vs)}会場 {total}組 {days}")
    print(f"[schedule] -> {out_path} (取得 {sum(len(vs) for vs in venues.values()) - reused} / 前回分を使用 {reused})")
    return data


def check_against_years(schedule: dict, year_files: dict[int, dict]) -> None:
    """build のログ用: 日程の出場者と年度データのその回戦の出場組を突き合わせる(止めない)。"""
    yf = year_files.get(schedule.get("year"))
    if not yf:
        print(f"[build] 日程 {schedule.get('year')}: 年度データが無いので照合しません")
        return
    for rk, lists in round_slots(schedule).items():
        in_schedule = {str(c) for _, ids in lists for c in ids if c}
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


_NTH = re.compile(r"(\d+)\s*組目")


def check_order_against_videos(schedule: dict, official: dict) -> tuple[int, list[str]]:
    """build のログ用: 「公式一覧の並び=出番順」の前提を公式動画で確かめる(止めない)。
    公式動画は1本に数組をまとめ、説明文に「N組目」がある(3回戦の敗退組など)。同じ動画の組どうしで、
    日程の並び(会場・位置)と動画の「N組目」の順が同じかを見る。戻り値は (照合した組数, 不一致の説明)。"""
    year = schedule.get("year")
    combis = ((official.get("years") or {}).get(str(year)) or {}).get("combis") or {}
    checked = 0
    bad: list[str] = []
    for rk, lists in round_slots(schedule).items():
        pos = {c: (vid, i) for vid, ids in lists for i, c in enumerate(ids, 1) if c}
        by_video: dict[str, list[tuple[int, int]]] = {}
        for cid, rounds in combis.items():
            for video in rounds.get(rk) or []:
                m = _NTH.search(video.get("p") or "")
                if m and int(cid) in pos:
                    by_video.setdefault(video["v"], []).append((int(m.group(1)), int(cid)))
        for vid, members in sorted(by_video.items()):
            if len(members) < 2:
                continue
            checked += len(members)
            venues = {pos[c][0] for _, c in members}
            by_nth = [c for _, c in sorted(members)]
            by_slot = sorted((c for _, c in members), key=lambda c: pos[c][1])
            if len(venues) > 1 or by_nth != by_slot:
                bad.append(f"{rk} 動画{vid}: 動画の順 {by_nth} / 日程の順 {by_slot} 会場 {sorted(venues)}")
    line = f"[build] 出番順と公式動画の並び {year}: 照合 {checked}組 / 不一致 {len(bad)}"
    print(line + ("" if not bad else " " + "; ".join(bad[:5])))
    return checked, bad


__all__ = [
    "build_schedule",
    "check_against_years",
    "check_order_against_videos",
    "fetch_schedule",
    "parse_venue",
    "public_schedule",
    "round_slots",
]
