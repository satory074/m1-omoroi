"""TVer の「いいね」数(ワイルドカード争いの参考値)の取得と、配信用 JSON への変換。

**いいね数は審査の票数ではない。** 2026年のワイルドカード(準々決勝敗退組から準決勝へ1組)は
M-1 の LINE ミニアプリの1人1票で決まり、途中経過は公開されない。TVer の各組の動画に付く
「いいね」は、その間に外から見える唯一の人気の目安なので、出典と「投票数ではない」を添えて出す。

入口(どちらも TVer の Web アプリが使う非公開の API。ログイン・トークン不要、ヘッダ
`x-tver-platform-type: web` が要る。予告なく変わりうるので、壊れたら黙って止まる作りにしている):
- `contents-api.tver.jp/contents/api/v1/page/series/{シリーズID}` … シリーズのページ。
  `episode-list` の節のうち、見出しが設定の `section`(「準々決勝」)で始まるものに各組の動画が並ぶ
  (2026年は あ行〜ら行 の10節・計102本 = 準々決勝の敗退102組。通過30組の動画は無い)
- `contents-api.tver.jp/contents/api/v2/episodes/{エピソードID}` … `episode.like_count` と `episode.title`(=コンビ名)

規約(https://tver.jp/tos 第4条)の (7) 解析行為・(20) 外部サービス等での無断流用 に触れうることは
ユーザーと確認済み(2026-11-23)。手当て: 投票期間中だけ1時間に1回・1秒に1件以下、出典と各組の
TVer 動画へのリンクを出す、TVer や事務局から連絡があれば即止める(ワークフローを無効化し data を消す)。

何を信じて何を捨てるか:
- 年ごとの設定は `overrides/tver_likes.json`(期間・シリーズID・節の見出し・手直し)。来年は1年分を足す
- 期間の前は何もしない。締切を過ぎたら**1回だけ**取って `final` にし、以後は取らない
  (CI の予定実行は数時間遅れることがあるので、最終値は「締切後に最初に取れた値」。取得時刻を出す)
- 取得が1件でも失敗したら、`like_count` が無ければ、動画が0本なら、work を**上書きしない**
  (一部の組だけ古い数のまま混ざるのを防ぐ。画面の「○時点」で古さが分かる)
- 履歴は work に全部残す(伸びの計算用)。配信するのは各組の最新値と24時間の伸びだけ(数KB)

コンビへの紐付けは build 時(`build_tver_likes`)。照合相手は**その年の準々決勝に結果がある組**
(敗退組だけにしないのは、公式DBがワイルドカードの勝者を後から「準々決勝：通過」に書き換える年が
多く、そうなると勝者のいいね数が消えるため)。キーは公式YouTubeと同じ `match_key`。
"""

import json
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx

from .config import OVERRIDES_DIR, WORK_DIR

SOURCE = "tver-likes-v1"
SERIES_URL = "https://contents-api.tver.jp/contents/api/v1/page/series/{id}"
EPISODE_URL = "https://contents-api.tver.jp/contents/api/v2/episodes/{id}"
EPISODE_PAGE = "https://tver.jp/episodes/{id}"
SERIES_PAGE = "https://tver.jp/series/{id}"
# メールアドレスは送らない(TVer に連絡先を求められているわけではない)。サイトの URL だけ名乗る
HEADERS = {
    "x-tver-platform-type": "web",
    "User-Agent": "m1-omoroi-fansite/0.1 (+https://satory074.github.io/m1-omoroi/)",
}
REQUEST_INTERVAL = 1.0  # 1秒に1件以下(TVer 側の cache は10秒なので速く取っても得は無い)
TIMEOUT = 30
ATTEMPTS = 3
GROWTH_MINUTES = 24 * 60

JST = ZoneInfo("Asia/Tokyo")


def load_config() -> dict[str, dict]:
    path = OVERRIDES_DIR / "tver_likes.json"
    if not path.exists():
        return {}
    return {k: v for k, v in json.loads(path.read_text(encoding="utf-8")).items() if k.isdigit()}


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


def _minute(dt: datetime) -> int:
    """標本の時刻 = UNIX 時間の分。"""
    return int(dt.timestamp() // 60)


def _iso(minute: int) -> str:
    return datetime.fromtimestamp(minute * 60, tz=timezone.utc).astimezone(JST).isoformat(timespec="minutes")


def pick_season(config: dict[str, dict], now: datetime) -> tuple[int, dict] | None:
    """いま取るべき年。期間が始まっている年のうち一番新しいもの(始まっていなければ None)。"""
    started = [(int(y), c) for y, c in config.items() if _dt(c["start"]) <= now]
    return max(started, key=lambda t: t[0]) if started else None


def _load_work(out_path, year: int) -> dict:
    try:
        prev = json.loads(out_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        prev = None
    if isinstance(prev, dict) and prev.get("source") == SOURCE and prev.get("year") == year:
        return prev
    return {"source": SOURCE, "year": year, "final": False, "fetchedAt": None, "episodes": {}}


def _dump_work(work: dict) -> str:
    """1組1行(毎時のコミットの差分を、伸びた組の行だけにする)。"""
    head = {k: v for k, v in work.items() if k != "episodes"}
    lines = [
        f"{json.dumps(eid, ensure_ascii=False)}:{json.dumps(ep, ensure_ascii=False, separators=(',', ':'))}"
        for eid, ep in sorted(work["episodes"].items())
    ]
    body = json.dumps(head, ensure_ascii=False, separators=(",", ":"))[:-1]
    return body + ',"episodes":{\n' + ",\n".join(lines) + "\n}}\n"


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


def list_episodes(series: dict, section: str) -> dict[str, dict]:
    """シリーズのページから、見出しが section で始まる節の動画 {エピソードID: {title, season}}。"""
    out: dict[str, dict] = {}
    for s in (series.get("floor") or {}).get("sections") or []:
        if s.get("section_template_id") != "episode-list" or not str(s.get("title", "")).startswith(section):
            continue
        for it in s.get("items") or []:
            if it.get("item_type") == "episode" and it.get("id"):
                out[it["id"]] = {"title": it.get("title") or "", "season": s["title"]}
    return out


def fetch_tver_likes(
    client: httpx.Client | None = None,
    out_path=None,
    config: dict | None = None,
    now: datetime | None = None,
    interval: float = REQUEST_INTERVAL,
    backoff: float = 10.0,
) -> dict | None:
    """期間中なら全組のいいね数を1回取り、work に標本を1つ足す。取らなかった/取れなかったら None。"""
    out_path = out_path or WORK_DIR / "tver_likes.json"
    now = now or datetime.now(timezone.utc)
    config = load_config() if config is None else config
    picked = pick_season(config, now)
    if picked is None:
        print("[tver] 投票期間の前なので取得しません")
        return None
    year, cfg = picked
    work = _load_work(out_path, year)
    if work["final"]:
        print(f"[tver] {year} は締切後の最終値を取得済みなので取得しません")
        return None
    closing = now >= _dt(cfg["deadline"])

    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT, headers=HEADERS, follow_redirects=True)
    get = _Getter(client, interval, backoff)
    minute = _minute(now)
    counts: dict[str, tuple[int, str]] = {}
    try:
        try:
            listed = list_episodes(get.json(SERIES_URL.format(id=cfg["series"])), cfg.get("section", "準々決勝"))
            if not listed:
                raise SystemExit(f"[tver] {year} の動画が0本のため work を更新しません")
            # 一覧から消えた動画も、締切までは取り続ける(消えたなら取得に失敗して止まる = 気づける)
            ids = sorted(set(listed) | set(work["episodes"]))
            for eid in ids:
                ep = (get.json(EPISODE_URL.format(id=eid)) or {}).get("episode") or {}
                n = ep.get("like_count")
                if not isinstance(n, int) or isinstance(n, bool) or n < 0:
                    raise SystemExit(f"[tver] {eid} に like_count が無いため work を更新しません")
                counts[eid] = (n, ep.get("title") or listed.get(eid, {}).get("title") or "")
        except (httpx.HTTPError, RuntimeError, ValueError, TypeError, KeyError, AttributeError) as e:
            raise SystemExit(f"[tver] 取得に失敗したため work を更新しません: {e}")
    finally:
        if own:
            client.close()

    for eid, (n, title) in counts.items():
        ep = work["episodes"].setdefault(eid, {"title": title, "season": None, "samples": []})
        ep["title"] = title
        if eid in listed:
            ep["season"] = listed[eid]["season"]
        samples = ep["samples"]
        # 同じ分に2回取ったら(手動の再実行)後の値で置き換える
        if samples and samples[-1][0] == minute:
            samples[-1] = [minute, n]
        else:
            samples.append([minute, n])
    work["fetchedAt"] = _iso(minute)
    work["final"] = closing
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(_dump_work(work), encoding="utf-8")
    top = sorted(counts.items(), key=lambda kv: -kv[1][0])[:3]
    print(
        f"[tver] {year}: {len(counts)}本 {work['fetchedAt']}"
        + (" (締切後の最終値)" if closing else "")
        + " 上位 "
        + " / ".join(f"{t} {n}" for _, (n, t) in top)
    )
    print(f"[tver] -> {out_path}")
    return work


def growth(samples: list[list[int]], window: int = GROWTH_MINUTES) -> tuple[int, int] | None:
    """最新の値 − 「最新の window 分前以前で一番新しい標本」の値と、その実際の時間幅(分)。

    CI が遅れて標本の間が空いても、ちょうど24時間前の値をでっち上げず、実在する標本と実際の幅を返す。
    window 分前以前の標本が無ければ None(取り始めて24時間たっていない)。
    """
    if not samples:
        return None
    last_m, last_n = samples[-1]
    base = None
    for m, n in samples:
        if m <= last_m - window:
            base = (m, n)
        else:
            break
    if base is None:
        return None
    return last_n - base[1], last_m - base[0]


def build_tver_likes(work: dict, year_files: dict[int, dict], config: dict | None = None):
    """work をその年の準々決勝の出場組へ紐付け、配信用 JSON と照合レポートを返す。"""
    from .youtube_official import match_key

    config = load_config() if config is None else config
    year = work["year"]
    cfg = config.get(str(year)) or {}
    round_key = cfg.get("round", "quarterfinal")
    by_episode = {k: int(v) for k, v in (cfg.get("byEpisode") or {}).items()}
    report = {"year": year, "matched": 0, "unmatched": [], "ambiguous": [], "episodes": 0, "fail": 0}
    yf = year_files.get(year)
    if yf is None:
        return None, report
    entrants = [e for e in yf["entries"] if e.get("id") is not None and e["results"].get(round_key)]
    report["fail"] = sum(1 for e in entrants if e["results"][round_key] == "fail")
    by_norm: dict[str, list[dict]] = {}
    for e in entrants:
        by_norm.setdefault(match_key(e["name"]), []).append(e)
    ids = {e["id"] for e in entrants}

    closed = bool(work.get("final"))
    items: dict[str, dict] = {}
    latest = 0
    for eid, ep in sorted(work.get("episodes", {}).items()):
        if not ep.get("samples"):
            continue
        report["episodes"] += 1
        cid = by_episode.get(eid)
        if cid is not None and cid not in ids:
            report["unmatched"].append(f"{ep['title']}(override先{cid}が{round_key}に不在)")
            continue
        if cid is None:
            cands = by_norm.get(match_key(ep["title"]), [])
            if len(cands) != 1:
                report["ambiguous" if cands else "unmatched"].append(f"{ep['title']}({eid})")
                continue
            cid = cands[0]["id"]
        if str(cid) in items:
            # 1組に動画2本は想定外(どちらが正しいか分からないので両方出さない)
            report["ambiguous"].append(f"{ep['title']}({eid}, 同じ組に2本目)")
            items.pop(str(cid))
            continue
        m, n = ep["samples"][-1]
        latest = max(latest, m)
        item = {"n": n, "ep": eid}
        g = None if closed else growth(ep["samples"])
        if g is not None:
            item["d"], item["h"] = g[0], round(g[1] / 60)
        items[str(cid)] = item
        report["matched"] += 1

    if not items:
        return None, report
    data = {
        "year": year,
        "round": round_key,
        "at": _iso(latest),
        "deadline": cfg.get("deadline"),
        "final": closed,
        "series": SERIES_PAGE.format(id=cfg["series"]) if cfg.get("series") else None,
        "items": items,
    }
    return data, report


def print_report(report: dict) -> None:
    line = f"[build] TVer いいね {report['year']}: 動画 {report['episodes']}本 / 紐付け {report['matched']}組"
    if report["unmatched"]:
        line += f" / 未紐付け {len(report['unmatched'])} {report['unmatched'][:5]}"
    if report["ambiguous"]:
        line += f" / 同名で判別不可 {len(report['ambiguous'])} {report['ambiguous'][:5]}"
    print(line)
    if report["episodes"] and report["episodes"] != report["fail"]:
        print(
            f"[build] 警告: TVer の動画 {report['episodes']}本と準々決勝の敗退 {report['fail']}組の数が違う"
            "(ワイルドカードの勝者が公式DBで通過に書き換わった後なら1組ずれるのは正常)"
        )


__all__ = [
    "build_tver_likes",
    "fetch_tver_likes",
    "growth",
    "list_episodes",
    "pick_season",
    "print_report",
]
