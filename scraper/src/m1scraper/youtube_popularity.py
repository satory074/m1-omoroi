"""YouTube検索ベースの「注目度」の取得。

指標の変遷: Google CSEヒット件数(CSEのウェブ全体検索が2027-01廃止予定で断念)
→ Wikipedia閲覧数(記事のある348組しかカバーできない)
→ M-1公式ネタ動画の再生数(シーズン終了後に全動画が非公開化されるため断念)
→ 現方式: YouTube Data API v3 で「コンビ名 漫才」と「メンバー名1|メンバー名2」(OR検索)を
  それぞれ検索し、各上位10本のうちコンビ名またはメンバー名を「単語として」含む動画の
  再生数を合計する(判定は _accept)。両方の検索に出た動画は1回だけ数える。
  メンバー名を別クエリにするのは、`q` の空白(AND)と `|`(OR)の優先順位が非公開で
  「コンビ名 漫才|メンバー名」ではメンバー単独の動画が落ちる恐れがあるため。

採用判定 (_accept):
1. overrides/popularity.json で除外指定された動画ID・チャンネルは不採用(メンバー名経由でも)
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
4. 上記で採用されなければメンバー名(MemberMatcher)で判定する。個人名はコンビ名より一般語・他人との
   衝突が桁違いに多い(ひかる・まさや・山ちゃん・石川・青空…)ので名前の固有性で2段階にする(_member_tier):
   strong(3文字以上で漢字2文字以上、または5文字以上でひらがなのみでない: 山内健司・野田クリスタル)は
   コンビ名と同じ規則(本文の境界つき一致+本人チャンネル)、weak(それ以外: 粗品・せいや・山ちゃん・石川)は
   厳密な本人チャンネル(チャンネル名=名前、または名前+接尾語。「粗品 Official Channel」)の動画だけを採用。
   メンバー名でのみ採用した再生数は内訳 `m` として別に持つ(コンビ名でも採用される動画は m に入れない)。
   同一人物が再結成で複数の対象コンビに居る場合は最新出場年のコンビにだけ加算する(select_targets)。
   overrides の excludeMembers で名前単位の除外もできる(同姓同名の有名人など)。

判定ルール(FILTER_VERSION)か overrides を変えると、次回の fetch-popularity が自動で
rescore(全組の一括再集計)を先に行う。蓄積済みの動画IDに videos.list を叩くだけなので
search を再消費しない(全組で約1,600units。videos.list は search とは別の10,000units枠)。
手動なら `m1 rescore-popularity`。ローリング更新に任せると1か月ほど新旧ルールが混在するので必ず一括で適用する。
クエリ自体(検索語・件数)を変えたときは QUERY_VERSION を上げる — 旧版で取得した組が
ローリングで優先的に再検索される(rescore では新しい候補動画は増えないため)。

- 対象: 3回戦以上に出場経験のあるコンビ(約1,300組)
- search.list は2026-06以降「1日100回」の独立枠(videos.list 等の10,000units/日とは別勘定)。
  1組=コンビ名+メンバー名の2回なので約47組/日。95回で止めて手動確認(1日2組まで)の余地を残し、
  翌日の再実行でレジュームする
- ローリング更新: 未取得の組 → 旧クエリ版の組 → 取得日の古い順に再取得する。
  GitHub Actions (update-popularity.yml) が毎日実行するため、
  全組が約4週間周期で自動的に更新され続ける
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
# メンバー名検索の件数。maxResults は50まで同コストだが、コンビ名側と対称の「それぞれ上位10本」にして
# 同姓同名の混入とメンバー分だけ桁が変わるのを抑える
MEMBER_TOP_N = 10

# search.list は1日100回の独立枠(2026-06〜)。95で止めて手動確認(1日2組=4回)の余地を残す
SEARCH_CALLS_PER_DAY = 95

# 採用判定ルールの版。判定を変えたら上げる(popularity.json の filter スタンプと不一致なら自動で再集計)
FILTER_VERSION = 4
# 検索クエリの版。検索語や件数を変えたら上げる(hits[*].q が違う組はローリングで優先的に再検索される)
QUERY_VERSION = 2

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
    """3回戦以上の出場経験があるコンビを抽出。

    各組に `members`(メンバー名検索・判定に使う名前)と `last`(最新出場年)を付ける。
    同一人物(名前・かな・生年月日が一致)が再結成で複数の対象コンビに居る場合(永田敬介=
    スタローン2015/馬稼業2018/コーツ2026 など140名)、メンバー名は最新出場年のレコードにだけ残す
    (解散済みコンビが本人の現在の人気で浮上しないように。同点は両方)。
    空名と、コンビ名と同じ名前(初恋タロー/ムネタ: 同じ語をもう一度検索するだけ)は落とす。
    """
    targets = []
    latest: dict[tuple, int] = {}  # 人物キー → その人が居る対象コンビの最新出場年
    for line in _iter_combi_records():
        rec = json.loads(line)
        if not any(
            rk in entry["results"]
            for entry in rec["history"].values()
            for rk in TARGET_ROUNDS
        ):
            continue
        last = max((int(y) for y in rec["history"]), default=0)
        members = []
        for m in rec.get("members") or []:
            name = (m.get("name") or "").strip()
            if not name or _squash(name) == _squash(rec["name"]):
                continue
            key = (name, m.get("kana"), m.get("birth"))
            members.append((name, key))
            latest[key] = max(latest.get(key, 0), last)
        targets.append({"id": rec["id"], "name": rec["name"], "last": last, "_members": members})
    for t in targets:
        t["members"] = [name for name, key in t.pop("_members") if latest[key] == t["last"]]
    return targets


def _effective_members(target: dict, override: dict | None) -> list[str]:
    """overrides の excludeMembers を除いた、検索・判定に使うメンバー名。"""
    excluded = set((override or {}).get("excludeMembers", []))
    return [n for n in target.get("members", []) if n not in excluded]


def _member_query(names: list[str]) -> str:
    """「名1|名2」のOR検索語。`"`・`|` は検索演算子、先頭の `-` はNOTなので除き、空白を含む名は引用符で囲む
    (実データ: 平井"ファラオ"光、kento fukaya、小松 ゲルニカ 拓矢)。"""
    terms = []
    for n in names:
        t = n.replace('"', "").replace("|", "").lstrip("-").strip()
        if not t:
            continue
        terms.append(f'"{t}"' if any(c.isspace() for c in t) else t)
    return "|".join(terms)


def plan_todo(targets: list[dict], hits: dict) -> list[dict]:
    """未取得の組 → 旧クエリ版(q≠QUERY_VERSION)で取得した組(古い順) → 残りを取得日の古い順。"""
    missing, old_query, stale = [], [], []
    for t in targets:
        hit = hits.get(str(t["id"]))
        if hit is None:
            missing.append(t)
        elif hit.get("q") != QUERY_VERSION:
            old_query.append(t)
        else:
            stale.append(t)

    def by_at(t):
        return hits[str(t["id"])]["at"]

    return missing + sorted(old_query, key=by_at) + sorted(stale, key=by_at)


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


def search_video_ids(
    client: httpx.Client, api_key: str, query: str, max_results: int = TOP_N
) -> list[str]:
    """search.list(1日100回枠を1回消費)。関連度順の上位動画IDを返す。"""
    resp = client.get(
        SEARCH_URL,
        params={
            "part": "id",
            "q": query,
            "type": "video",
            "maxResults": str(max_results),
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


def _squash(s: str) -> str:
    """_normalize して空白も除いた比較用文字列。"""
    return "".join(c for c in _normalize(s) if not c.isspace())


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


def _member_tier(name: str) -> str:
    """メンバー名の固有性。strong=本文一致に使える、weak=本人チャンネルの動画しか採用しない。

    3文字以上で漢字2文字以上(山内健司・愛植男)か、5文字以上でひらがなのみでない(野田クリスタル・ナオ・デストラーデ)を strong。
    「漢字を含み3文字以上」だと 大ちゃん・山ちゃん・赤ワイン・ガン太 が通ってしまう。
    2文字の姓や一般語(石川・吉田・粗品・店長)・ひらがな愛称(ひかる・まさや)・短いカナ(ガク・ハリー)は他人や一般語と衝突する。
    """
    classes = [_char_class(c) for c in _squash(name)]
    if len(classes) >= 3 and classes.count("kanji") >= 2:
        return "strong"
    if len(classes) >= 5 and any(c in ("kanji", "kata", "alnum") for c in classes):
        return "strong"
    return "weak"


def _strict_own_channel(name: str, channel_title: str) -> bool:
    """weak な名前用の厳密な本人チャンネル判定: チャンネル名(先頭の【公式】等を除く)が名前そのもの、
    または名前+区切り+接尾語(「粗品 Official Channel」「せいやチャンネル」)。
    NameMatcher.is_own_channel は漢字→カナを境界とみなすので「石川テレビ」を通してしまい、weak な名前には使えない。
    """
    n = _squash(name)
    h = _squash(_LEADING_BRACKETS.sub("", _normalize(channel_title)))
    if not n or not h.startswith(n):
        return False
    rest = h[len(n) :].lstrip("・-_/|:~")
    return rest == "" or rest.startswith(ALLOWED_SUFFIXES)


class MemberMatcher:
    """メンバー名の採用判定。strong な名前はコンビ名と同じ境界つき一致+自チャンネル、weak な名前は厳密な本人チャンネルのみ。"""

    def __init__(self, names: list[str]):
        self.strong = [NameMatcher(n) for n in names if _member_tier(n) == "strong"]
        self.weak = [n for n in names if _member_tier(n) == "weak"]

    def __bool__(self) -> bool:
        return bool(self.strong or self.weak)

    def matches(self, sn: dict) -> bool:
        channel = sn.get("channelTitle", "")
        if any(_strict_own_channel(n, channel) for n in self.weak):
            return True
        if any(m.is_own_channel(channel) for m in self.strong):
            return True
        fields = [sn.get("title", ""), sn.get("description", ""), channel, *sn.get("tags", [])]
        return any(m.contains(f) for m in self.strong for f in fields)


def _load_overrides() -> dict[str, dict]:
    """overrides/popularity.json (コンビID → {excludeChannels, excludeIds, excludeMembers})。無ければ空。"""
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


def _accept(
    item: dict,
    matcher: NameMatcher,
    override: dict | None = None,
    members: "MemberMatcher | None" = None,
) -> str | None:
    """採用した判定ルール名("combi" / "member")。不採用なら None。コンビ名が先なので、両方で採用される動画は combi。"""
    if _excluded_by_override(item, override):
        return None
    sn = item.get("snippet", {})
    if matcher.is_own_channel(sn.get("channelTitle", "")):
        return "combi"
    fields = [sn.get("title", ""), sn.get("description", ""), sn.get("channelTitle", "")]
    fields += sn.get("tags", [])
    if any(matcher.contains(f) for f in fields):
        return "combi"
    if members and members.matches(sn):
        return "member"
    return None


def accept_video(item: dict, name: str, override: dict | None = None) -> bool:
    """videos.list の item をコンビ name の動画として採用するか。"""
    return _accept(item, NameMatcher(name), override) is not None


def count_views(
    items: list[dict],
    name: str,
    override: dict | None = None,
    members: MemberMatcher | None = None,
) -> tuple[list[int], list[int]]:
    """採用した動画の再生数 (全件, うちメンバー名だけで採用した分)。統計非公開の動画は除外される。"""
    matcher = NameMatcher(name)
    views: list[int] = []
    member_only: list[int] = []
    for item in items:
        count = item.get("statistics", {}).get("viewCount")
        if count is None:
            continue
        rule = _accept(item, matcher, override, members)
        if rule is None:
            continue
        views.append(int(count))
        if rule == "member":
            member_only.append(int(count))
    return views, member_only


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
    members: MemberMatcher | None = None,
) -> tuple[list[int], list[int]]:
    """コンビ name の動画として採用したものの再生数 (全件, うちメンバー名義)(50件ずつ videos.list)。"""
    views: list[int] = []
    member_only: list[int] = []
    for i in range(0, len(video_ids), 50):
        items = _videos_list(client, api_key, video_ids[i : i + 50])
        v, m = count_views(items, name, override, members)
        views.extend(v)
        member_only.extend(m)
    return views, member_only


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
    hits = data["hits"]
    n_missing = sum(1 for t in targets if str(t["id"]) not in hits)
    n_old = sum(
        1 for t in targets if str(t["id"]) in hits and hits[str(t["id"])].get("q") != QUERY_VERSION
    )
    print(
        f"[fetch-popularity] 対象 {len(targets)}組"
        f" (未取得 {n_missing} / 旧クエリ版 {n_old} / 更新待ち {len(targets) - n_missing - n_old}) (YouTube再生数)"
    )

    today = date.today().isoformat()
    calls = 0
    done = 0
    for n, t in enumerate(todo, 1):
        override = overrides.get(str(t["id"]))
        names = _effective_members(t, override)
        cost = 2 if names else 1
        if calls + cost > SEARCH_CALLS_PER_DAY:
            print(
                f"[fetch-popularity] search.list の1日枠の目安({SEARCH_CALLS_PER_DAY}回)に到達。"
                "翌日再実行してください"
            )
            break
        try:
            calls += 1
            video_ids = search_video_ids(client, api_key, t["name"] + SEARCH_SUFFIX)
            if names:
                # 2回目で枠切れになると1回目の検索が無駄になるが、エントリは両方揃うまで書かない
                calls += 1
                member_ids = search_video_ids(client, api_key, _member_query(names), MEMBER_TOP_N)
                # 両方の検索に出た動画は1回だけ数える
                video_ids = list(dict.fromkeys(video_ids + member_ids))
            views, member_views = fetch_view_counts(
                client, api_key, video_ids, t["name"], override, MemberMatcher(names)
            )
        except QuotaExceeded:
            print("[fetch-popularity] APIクォータ超過。翌日再実行してください")
            break
        except httpx.HTTPError as e:
            print(f"[fetch-popularity] {t['name']}: 取得失敗 ({e}) スキップ")
            time.sleep(2)
            continue
        # ids は検索結果全件(フィルタ前、コンビ名+メンバー名の和集合)。フィルタ規則の変更時に
        # rescore-popularity が videos.list だけで再集計する(search枠を再消費しない)
        hits[str(t["id"])] = {
            "n": sum(views),
            "at": today,
            "v": len(views),
            "m": sum(member_views),
            "q": QUERY_VERSION,
            "ids": video_ids,
        }
        done += 1
        if n % 25 == 0 or n == len(todo):
            pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            print(f"[fetch-popularity] {n}/{len(todo)}", flush=True)
        time.sleep(0.2)

    pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(
        f"[fetch-popularity] 完了: {len(hits)}/{len(targets)}組"
        f" (今回{done}組, search {calls}回) -> {pop_path}"
    )


def rescore_popularity(client: httpx.Client | None = None):
    """蓄積済みの動画ID(hits[*].ids)に対して現在の採用判定を適用し直し、n/v/m を書き換える。

    search は再消費せず videos.list のみ(ユニーク動画IDを50件ずつ)。取得日 at とクエリ版 q は維持する
    (再検索ではないので、メンバー名検索の候補が増えるわけではない)。
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
    targets = {str(t["id"]): t for t in select_targets()}
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
        t = targets.get(cid)
        if t is None:
            skipped += 1
            continue
        override = overrides.get(cid)
        items = [videos[v] for v in hit.get("ids", []) if v in videos]
        views, member_views = count_views(
            items, t["name"], override, MemberMatcher(_effective_members(t, override))
        )
        old = (hit["n"], hit.get("v", 0), hit.get("m", 0))
        hit["n"], hit["v"], hit["m"] = sum(views), len(views), sum(member_views)
        new = (hit["n"], hit["v"], hit["m"])
        if old != new:
            changes.append((old[0] - new[0], t["name"], *old, *new))

    data["filter"] = filter_stamp(overrides)
    pop_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    changes.sort(key=lambda c: -abs(c[0]))
    print(
        f"[rescore-popularity] 変更 {len(changes)}組"
        f" (対象外でスキップ {skipped}組, 応答あり動画 {len(videos):,}本) -> {pop_path}"
    )
    for _, name, old_n, old_v, old_m, new_n, new_v, new_m in changes[:30]:
        print(
            f"  {name}: {old_n:,} ({old_v}本, メンバー名義 {old_m:,})"
            f" -> {new_n:,} ({new_v}本, メンバー名義 {new_m:,})"
        )
    return changes
