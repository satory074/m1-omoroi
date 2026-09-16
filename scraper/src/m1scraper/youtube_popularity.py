"""YouTube検索ベースの「注目度」の取得。

指標の変遷: Google CSEヒット件数(CSEのウェブ全体検索が2027-01廃止予定で断念)
→ Wikipedia閲覧数(記事のある348組しかカバーできない)
→ M-1公式ネタ動画の再生数(シーズン終了後に全動画が非公開化されるため断念)
→ 現方式: YouTube Data API v3 で「コンビ名 漫才」を検索し、上位10本のうち
  コンビ名を「単語として」含む動画の再生数を合計する(判定は _accept)。

採用判定 (_accept):
1. overrides/popularity.json で除外指定された動画ID・チャンネルは不採用
2. 自分のチャンネル(チャンネル名がコンビ名で始まり、続きが区切りか「チャンネル」等の接尾語)の
   動画は無条件で採用(タイトルにコンビ名が無い自チャンネル動画を取りこぼさない)
3. タイトル・説明文・チャンネル名・タグのいずれかにコンビ名が境界つきで含まれれば採用。
   単なる部分一致だと シャララ⊂シャラララックス、2000⊂ヨネダ2000、百恵⊂山口百恵 のように
   一般語のコンビ名で無関係な動画が素通りし、3回戦止まりの組が上位に並んでしまう。
   境界は隣接1文字の文字種で見る(カナ→カナ・漢字→漢字・英数→英数/カナ の連結は不採用、
   英数→漢字は助数詞「万」「回」「年」等のみ不採用、ひらがなの助詞「の」「が」等は許容)。
   これらのフィルタが無いと動画の少ない組の検索結果が無関係な高再生動画で埋まる(まっかちん5,200万回など)。
   動画カテゴリでの除外は行わない — よしもと漫才劇場公式や四千頭身公式が「ゲーム」で投稿していたり、
   クマムシの歌ネタが「音楽」(VEVO)だったりと、公式動画の取りこぼしが実測で多かった(2026-09)。

判定ルール(FILTER_VERSION)か overrides を変えると、次回の fetch-popularity が自動で
rescore(全組の一括再集計)を先に行う。蓄積済みの動画IDに videos.list を叩くだけなので
search を再消費しない(全組で約220units)。手動なら `m1 rescore-popularity`。
ローリング更新に任せると2週間ほど新旧ルールが混在するので必ず一括で適用する。

- 対象: 3回戦以上に出場経験のあるコンビ(約1,300組)
- search.list は100units/回、無料枠10,000units/日 → 約95組/日。
  枠の目安に達したら保存して中断し、翌日の再実行でレジュームする
- ローリング更新: 未取得の組を優先し、残りは取得日の古い順に再取得する。
  GitHub Actions (update-popularity.yml) が毎日実行するため、
  全組が約2週間周期で自動的に更新され続ける
- APIキー必須: 環境変数 YOUTUBE_API_KEY (GCPで YouTube Data API v3 を有効化して発行)
- work/popularity.json はコミット対象(CIビルドでも使われる)
"""

import hashlib
import json
import os
import re
import time
import unicodedata
from datetime import date

import httpx

from .config import OVERRIDES_DIR, USER_AGENT, WORK_DIR

SOURCE = "youtube-search-views-v2"
SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
SEARCH_SUFFIX = " 漫才"
TOP_N = 10

# search=100units + videos.list=1unit。9,500で止めて他用途の余地を残す
UNITS_PER_COMBI = 101
DAILY_UNIT_BUDGET = 9_500

# 採用判定ルールの版。判定を変えたら上げる(popularity.json の filter スタンプと不一致なら自動で再集計)
FILTER_VERSION = 3

# コンビ名の直後にこれらが続く場合は文字種に関わらず境界とみなす
# (自チャンネル名「ネルソンズチャンネル」「ジャルジャルタワー」「コットンシアター」「例えば炎研究所」等)。
# NFKC+casefold 後の文字列と比較するので小文字で持つ
ALLOWED_SUFFIXES = (
    "チャンネル", "ちゃんねる", "channel", "ch", "tv", "公式", "official",
    "コント", "漫才", "ネタ",
    "タワー", "アイランド", "シアター", "ランド", "ハウス", "スタジオ", "劇場", "ラボ", "研究所",
)
# ひらがなで終わる名前の直後に来てよい助詞(「いぬのコント」「千年ぶりのYouTube」)
_PARTICLES = frozenset("のがはをにでともやへかねよ")
# 数字で終わる名前の直後に来たら数量表現とみなす助数詞(「賞金1000万円」「4000年に一度」「1000回目」)。
# それ以外の漢字は連結タイトルとして許容(「ヨネダ2000最高」)
_COUNTERS = frozenset("万億兆千百十円回年月日時分秒人本件位点個台名枚期弾度歳才番組曲章巻冊倍割段階種問話")
# チャンネル名先頭の【公式】(公式) 等
_LEADING_BRACKETS = re.compile(r"^(?:[【\[(（][^】\])）]*[】\])）]\s*)+")


class QuotaExceeded(Exception):
    """YouTube APIの1日クォータ超過(403 quotaExceeded)。"""


TARGET_ROUNDS = ("third", "quarterfinal", "semifinal", "playoff", "final")


def _iter_combi_records():
    """work/combi.jsonl か、CIでコミット対象の圧縮版 combi.jsonl.gz を読む。"""
    path = WORK_DIR / "combi.jsonl"
    if path.exists():
        with path.open(encoding="utf-8") as f:
            yield from f
        return
    gz_path = WORK_DIR / "combi.jsonl.gz"
    if gz_path.exists():
        import gzip

        with gzip.open(gz_path, "rt", encoding="utf-8") as f:
            yield from f
        return
    raise SystemExit(f"{path} がありません。先に `m1 parse-combi` を実行してください")


def select_targets() -> list[dict]:
    """3回戦以上の出場経験があるコンビを抽出。"""
    targets = []
    for line in _iter_combi_records():
        rec = json.loads(line)
        if any(
            rk in entry["results"]
            for entry in rec["history"].values()
            for rk in TARGET_ROUNDS
        ):
            targets.append({"id": rec["id"], "name": rec["name"]})
    return targets


def plan_todo(targets: list[dict], hits: dict) -> list[dict]:
    """未取得の組を先頭に、取得済みの組を取得日の古い順で並べる。"""
    missing = [t for t in targets if str(t["id"]) not in hits]
    stale = sorted(
        (t for t in targets if str(t["id"]) in hits),
        key=lambda t: hits[str(t["id"])]["at"],
    )
    return missing + stale


def _raise_if_quota_exceeded(resp: httpx.Response) -> None:
    # 枠切れ時は 403 quotaExceeded のほか 429 も返る。どちらも即中断して翌日に回す
    # (1組ずつスキップ扱いにすると全434組へ無駄なリクエストを撃ち続けてしまう)
    if resp.status_code == 429:
        raise QuotaExceeded
    if resp.status_code != 403:
        return
    try:
        errors = resp.json().get("error", {}).get("errors", [])
    except ValueError:
        return
    if any(e.get("reason") == "quotaExceeded" for e in errors):
        raise QuotaExceeded


def search_video_ids(client: httpx.Client, api_key: str, name: str) -> list[str]:
    """「コンビ名 漫才」で検索し、関連度順の上位動画IDを返す。"""
    resp = client.get(
        SEARCH_URL,
        params={
            "part": "id",
            "q": name + SEARCH_SUFFIX,
            "type": "video",
            "maxResults": str(TOP_N),
            "regionCode": "JP",
            "relevanceLanguage": "ja",
            "key": api_key,
        },
    )
    _raise_if_quota_exceeded(resp)
    resp.raise_for_status()
    return [
        item["id"]["videoId"]
        for item in resp.json().get("items", [])
        if item.get("id", {}).get("videoId")
    ]


# ---------------------------------------------------------------------------
# 採用判定
# ---------------------------------------------------------------------------


def _normalize(s: str) -> str:
    # 空白は残す(境界判定に使う)。コンビ名側の空白揺れは NameMatcher の正規表現で吸収する
    return unicodedata.normalize("NFKC", s).casefold()


def _char_class(ch: str | None) -> str | None:
    """境界判定用の文字種。None は記号・空白・文字列端(=境界)。"""
    if ch is None:
        return None
    if ch == "ー" or ("゠" <= ch <= "ヿ" and ch != "・"):
        return "kata"
    if "぀" <= ch <= "ゟ":
        return "hira"
    if "一" <= ch <= "鿿" or "㐀" <= ch <= "䶿" or ch in "々〆":
        return "kanji"
    if ch.isalnum():
        return "alnum"
    return None


def _edge_ok(edge: str | None, neighbor: str | None, after: bool) -> bool:
    """名前の端の文字種 edge と、その外側の隣接文字 neighbor が単語境界を成すか。"""
    cls = _char_class(neighbor)
    if cls is None:
        return True
    if edge == "kata":
        return cls != "kata"  # シャラ|ラ|ラックス、ドランク|ドラゴン
    if edge == "kanji":
        return cls != "kanji"  # 山口|百恵、若林|号泣
    if edge == "alnum":
        if cls == "hira":
            return True  # 「EXITの」「ヨネダ2000が」は助詞
        if cls == "kanji":
            # 後ろの助数詞は数量(1000|万円、4000|年)。それ以外の漢字や前側の漢字は連結表記として許容
            return not after or neighbor not in _COUNTERS
        return False  # ヨネダ|2000、love|phantom
    if edge == "hira":
        return cls != "hira" or (after and neighbor in _PARTICLES)  # ぺ|こぱ 不可、いぬ|の 可
    return True


class NameMatcher:
    """コンビ名の境界つき一致。名前内の空白は無視し、本文側の空白は境界として扱う。"""

    def __init__(self, name: str):
        chars = [c for c in _normalize(name) if not c.isspace()]
        self.pattern = re.compile(r"\s*".join(re.escape(c) for c in chars)) if chars else None
        self.first = _char_class(chars[0]) if chars else None
        self.last = _char_class(chars[-1]) if chars else None

    def _span_ok(self, text: str, start: int, end: int) -> bool:
        before = text[start - 1] if start > 0 else None
        after = text[end] if end < len(text) else None
        return _edge_ok(self.first, before, False) and (
            _edge_ok(self.last, after, True) or text.startswith(ALLOWED_SUFFIXES, end)
        )

    def contains(self, text: str) -> bool:
        if self.pattern is None or not text:
            return False
        h = _normalize(text)
        pos = 0
        while (m := self.pattern.search(h, pos)) is not None:
            if self._span_ok(h, m.start(), m.end()):
                return True
            pos = m.start() + 1
        return False

    def is_own_channel(self, channel_title: str) -> bool:
        """チャンネル名が(先頭の【公式】等を除いて)コンビ名で始まり、続きが境界か接尾語。"""
        if self.pattern is None or not channel_title:
            return False
        h = _LEADING_BRACKETS.sub("", _normalize(channel_title)).lstrip()
        m = self.pattern.match(h)
        return m is not None and self._span_ok(h, 0, m.end())


def _load_overrides() -> dict[str, dict]:
    """overrides/popularity.json (コンビID → {excludeChannels, excludeIds})。無ければ空。"""
    path = OVERRIDES_DIR / "popularity.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(k): v for k, v in data.items() if not str(k).startswith("_")}


def filter_stamp(overrides: dict) -> str:
    """判定ルールの版 + overrides 内容のハッシュ。popularity.json の `filter` と比較して再集計要否を決める。"""
    digest = hashlib.sha1(
        json.dumps(overrides, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:8]
    return f"{FILTER_VERSION}:{digest}"


def _excluded_by_override(item: dict, override: dict | None) -> bool:
    if not override:
        return False
    if item.get("id") and item["id"] in override.get("excludeIds", []):
        return True
    channel = _normalize(item.get("snippet", {}).get("channelTitle", ""))
    return any(_normalize(c) in channel for c in override.get("excludeChannels", []) if c)


def _accept(item: dict, matcher: NameMatcher, override: dict | None = None) -> bool:
    if _excluded_by_override(item, override):
        return False
    sn = item.get("snippet", {})
    if matcher.is_own_channel(sn.get("channelTitle", "")):
        return True
    fields = [sn.get("title", ""), sn.get("description", ""), sn.get("channelTitle", "")]
    fields += sn.get("tags", [])
    return any(matcher.contains(f) for f in fields)


def accept_video(item: dict, name: str, override: dict | None = None) -> bool:
    """videos.list の item をコンビ name の動画として採用するか。"""
    return _accept(item, NameMatcher(name), override)


def count_views(items: list[dict], name: str, override: dict | None = None) -> list[int]:
    """採用した動画の再生数のみ。統計非公開の動画は除外される。"""
    matcher = NameMatcher(name)
    views = []
    for item in items:
        count = item.get("statistics", {}).get("viewCount")
        if count is not None and _accept(item, matcher, override):
            views.append(int(count))
    return views


# ---------------------------------------------------------------------------
# API 呼び出し
# ---------------------------------------------------------------------------


def _videos_list(client: httpx.Client, api_key: str, video_ids: list[str]) -> list[dict]:
    """videos.list (1unit/回、最大50件)。削除/非公開の動画は応答に含まれない。"""
    resp = client.get(
        VIDEOS_URL,
        params={
            "part": "statistics,snippet",
            "id": ",".join(video_ids),
            "key": api_key,
        },
    )
    _raise_if_quota_exceeded(resp)
    resp.raise_for_status()
    return resp.json().get("items", [])


def fetch_view_counts(
    client: httpx.Client,
    api_key: str,
    video_ids: list[str],
    name: str,
    override: dict | None = None,
) -> list[int]:
    """コンビ name の動画として採用したものの再生数のみ(50件ずつ videos.list)。"""
    views = []
    for i in range(0, len(video_ids), 50):
        items = _videos_list(client, api_key, video_ids[i : i + 50])
        views.extend(count_views(items, name, override))
    return views


def _require_api_key() -> str:
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        raise SystemExit(
            "環境変数 YOUTUBE_API_KEY が未設定です。"
            "GCPで YouTube Data API v3 を有効化してAPIキーを発行してください"
        )
    return api_key


def _load_popularity(pop_path) -> dict:
    data = {"source": SOURCE, "hits": {}}
    if pop_path.exists():
        prev = json.loads(pop_path.read_text(encoding="utf-8"))
        if prev.get("source") == data["source"]:
            data = prev
    return data


def fetch_popularity(limit: int | None = None, client: httpx.Client | None = None):
    api_key = _require_api_key()
    pop_path = WORK_DIR / "popularity.json"
    targets = select_targets()
    overrides = _load_overrides()
    stamp = filter_stamp(overrides)

    own_client = client is None
    if own_client:
        client = httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT})
    try:
        data = _load_popularity(pop_path)
        if data["hits"] and data.get("filter") != stamp:
            print(
                f"[fetch-popularity] 採用判定ルール/overrides が変わっている"
                f" (filter {data.get('filter')} → {stamp})。先に全組を再集計します"
            )
            try:
                rescore_popularity(client=client)
            except QuotaExceeded:
                print("[fetch-popularity] 再集計中にAPIクォータ超過。翌日再実行してください")
                return
            data = _load_popularity(pop_path)
        _fetch_rolling(client, api_key, pop_path, data, targets, overrides, stamp, limit)
    finally:
        if own_client:
            client.close()


def _fetch_rolling(client, api_key, pop_path, data, targets, overrides, stamp, limit):
    data["filter"] = stamp
    todo = plan_todo(targets, data["hits"])
    if limit:
        todo = todo[:limit]
    n_missing = sum(1 for t in targets if str(t["id"]) not in data["hits"])
    print(
        f"[fetch-popularity] 対象 {len(targets)}組"
        f" (未取得 {n_missing} / 更新待ち {len(targets) - n_missing}) (YouTube再生数)"
    )

    today = date.today().isoformat()
    units = 0
    done = 0
    for n, t in enumerate(todo, 1):
        if units + UNITS_PER_COMBI > DAILY_UNIT_BUDGET:
            print(
                f"[fetch-popularity] 無料枠の目安({DAILY_UNIT_BUDGET}units)に到達。"
                "翌日再実行してください"
            )
            break
        try:
            video_ids = search_video_ids(client, api_key, t["name"])
            units += 100
            views = fetch_view_counts(
                client, api_key, video_ids, t["name"], overrides.get(str(t["id"]))
            )
            units += (len(video_ids) + 49) // 50
        except QuotaExceeded:
            print("[fetch-popularity] APIクォータ超過。翌日再実行してください")
            break
        except httpx.HTTPError as e:
            print(f"[fetch-popularity] {t['name']}: 取得失敗 ({e}) スキップ")
            time.sleep(2)
            continue
        # ids は検索結果全件(フィルタ前)。フィルタ規則の変更時に
        # rescore-popularity が videos.list だけで再集計する(searchの100unitsを再消費しない)
        data["hits"][str(t["id"])] = {
            "n": sum(views),
            "at": today,
            "v": len(views),
            "ids": video_ids,
        }
        done += 1
        if n % 25 == 0 or n == len(todo):
            pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            print(f"[fetch-popularity] {n}/{len(todo)}", flush=True)
        time.sleep(0.2)

    pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(
        f"[fetch-popularity] 完了: {len(data['hits'])}/{len(targets)}組"
        f" (今回{done}組, 約{units}units消費) -> {pop_path}"
    )


def rescore_popularity(client: httpx.Client | None = None):
    """蓄積済みの動画ID(hits[*].ids)に対して現在の採用判定を適用し直し、n/v を書き換える。

    search は再消費せず videos.list のみ(ユニーク動画IDを50件ずつ)。取得日 at は維持する。
    クォータ超過時は何も書き換えずに QuotaExceeded を投げる。
    """
    api_key = _require_api_key()
    pop_path = WORK_DIR / "popularity.json"
    if not pop_path.exists():
        raise SystemExit(f"{pop_path} がありません")
    data = json.loads(pop_path.read_text(encoding="utf-8"))
    if data.get("source") != SOURCE:
        raise SystemExit(f"source が {SOURCE} ではありません: {data.get('source')}")
    hits = data.get("hits", {})
    names = {str(t["id"]): t["name"] for t in select_targets()}
    overrides = _load_overrides()
    ids = sorted({v for h in hits.values() for v in h.get("ids", [])})
    print(
        f"[rescore-popularity] {len(hits)}組 / 動画{len(ids):,}本"
        f" (videos.list 約{(len(ids) + 49) // 50}units)"
    )

    videos: dict[str, dict] = {}
    own_client = client is None
    if own_client:
        client = httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT})
    try:
        for i in range(0, len(ids), 50):
            for item in _videos_list(client, api_key, ids[i : i + 50]):
                if item.get("id"):
                    videos[item["id"]] = item
            if own_client:
                time.sleep(0.1)
    except QuotaExceeded:
        print("[rescore-popularity] APIクォータ超過。翌日再実行してください(何も書き換えていません)")
        raise
    finally:
        if own_client:
            client.close()

    changes = []
    skipped = 0
    for cid, hit in hits.items():
        name = names.get(cid)
        if name is None:
            skipped += 1
            continue
        items = [videos[v] for v in hit.get("ids", []) if v in videos]
        views = count_views(items, name, overrides.get(cid))
        old_n, old_v = hit["n"], hit.get("v", 0)
        hit["n"], hit["v"] = sum(views), len(views)
        if (old_n, old_v) != (hit["n"], hit["v"]):
            changes.append((old_n - hit["n"], name, old_n, hit["n"], old_v, hit["v"]))

    data["filter"] = filter_stamp(overrides)
    pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    changes.sort(key=lambda c: -abs(c[0]))
    print(
        f"[rescore-popularity] 変更 {len(changes)}組"
        f" (対象外でスキップ {skipped}組, 応答あり動画 {len(videos):,}本) -> {pop_path}"
    )
    for _, name, old_n, new_n, old_v, new_v in changes[:30]:
        print(f"  {name}: {old_n:,} ({old_v}本) -> {new_n:,} ({new_v}本)")
    return changes
