"""M-1グランプリ公式YouTubeチャンネル(@m1grandprix)の回戦別動画の取得と、コンビへの紐付け。

年度ページの「各回戦の公式YouTube」と「各コンビの動画」リンクの元データ。

- 取得(fetch_official_videos): チャンネルのプレイリスト一覧から回戦に対応するもの
  (PLAYLIST_RULES)を選び、その中の公開動画ごとに出演コンビ名の候補を抜き出して
  work/official_videos.json に書く。使うAPIは playlists.list と playlistItems.list だけ
  (各1unit/50件、1日30unit前後)。videos.list と同じ 10,000units/日の枠から引かれ、
  注目度で枯渇しやすい search.list(1日100回の独立枠)は消費しない。
- 紐付け(match_official_videos): build 時に、その年・その回戦に結果がある組だけを相手に
  正規化名で照合する。照合相手を回戦で絞るのは同名コンビの衝突を減らすため。

ネタ動画(3回戦ネタ・1回戦TOP3)のプレイリストはシーズン終了後にチャンネルから消える
(2025年分は2026-11時点で既に無い)。インタビュー・ナイスアマチュア賞は過去年も残っている。
そのため work は毎回「いま公開されているもの」で丸ごと作り直し、溜め込まない
(消えた動画のリンクが自然に消える)。API エラー・枠切れ・0件のときは前回の work を残す。

動画1本に2〜3組が入る(3回戦ネタ・1回戦TOP3)。出演者は説明文の `N組目：X` / `N位通過：X`
の行が最も確実で(タイトルは誤字がある: 2013→「2023」)、無ければタイトルを 【…】・＜…＞ で区切って拾う。
"""

import json
import re
import unicodedata
from datetime import date

import httpx

from .config import OVERRIDES_DIR, USER_AGENT, WORK_DIR
from .youtube_popularity import QuotaExceeded, _raise_if_quota_exceeded, _require_api_key, _squash

SOURCE = "youtube-official-v1"
CHANNEL_ID = "UCCTMMUDmBo6PXc7GmVHPrkw"
CHANNEL_URL = "https://www.youtube.com/@m1grandprix"
PLAYLISTS_URL = "https://www.googleapis.com/youtube/v3/playlists"
PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems"

# タイトル(NFKC後)→回戦。上から順に最初に当たったもの。「準決勝」は「決勝」を含むので先に置く。
# 「決勝」単独は入れない(決勝直前・ファイナリスト系はネタではなく、決勝のネタはテレビ側の権利)。
# どれにも当たらないプレイリスト(M-1ラジオ・shorts 等)は無視する。
# 新シーズンに回戦語を含まない名前のプレイリストが出たらここへ足す。
PLAYLIST_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"準々決勝"), "quarterfinal"),
    (re.compile(r"準決勝"), "semifinal"),
    (re.compile(r"敗者復活"), "playoff"),
    (re.compile(r"3回戦"), "third"),
    (re.compile(r"2回戦"), "second"),
    (re.compile(r"1回戦"), "first"),
    # 1回戦の会場ごとに選ばれる賞
    (re.compile(r"ナイスアマチュア賞|ナイスキッズ賞|ジモトスター賞"), "first"),
    # 2025・2026 とも2回戦のネタ直後インタビュー(動画タイトルに【2回戦直撃インタビュー】とある)
    (re.compile(r"直撃!?\s*インタビュー"), "second"),
]

_YEAR = re.compile(r"(20\d\d)")
_TITLE_YEAR = re.compile(r"M-1グランプリ\s*(20\d\d)")
_ORDER_LINE = re.compile(r"^\s*(\d+)\s*組目\s*:\s*(.+?)\s*$", re.M)
_RANK_LINE = re.compile(r"^\s*(\d+)\s*位通過\s*:\s*(.+?)\s*$", re.M)
_VENUE_LINE = re.compile(r"^\s*(\d{1,2}/\d{1,2})\s*\((.)\)\s*\[(.+?)\]\s*(.+?)\s*$", re.M)
_BRACKETS = re.compile(r"【[^】]*】")
_CATCH = re.compile(r"<[^>]*>")  # NFKC で ＜…＞ → <…>
_TOP_KIND = re.compile(r"TOP\s*\d", re.I)

PASSING = {"pass", "seed_pass", "champion"}

# 照合キーで同一視する字形。YouTube 側も公式DB側も長音を ―(U+2015)等で書くことがあり
# (DB: ハノ―バー・ニューロマンサ― / YouTube: ヤ―レンズ)、漢数字の二とカタカナのニも取り違える
# (YouTube: ネコ二スズ / DB: 二―ケイ)。両側に同じ変換をかけるので、変換で別の2組が同じキーに
# なった場合は「同名で判別不可」に落ちて紐付かない(誤リンクにはならない)
_FOLD = str.maketrans({"―": "ー", "—": "ー", "─": "ー", "‒": "ー", "–": "ー", "二": "ニ"})


def match_key(name: str) -> str:
    """照合キー: NFKC・casefold・空白除去(注目度の _squash と同じ)+ 長音/ニの字形揺れの吸収。"""
    return _squash(name).translate(_FOLD)


def _nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "")


def classify(title: str) -> str | None:
    """プレイリスト名・動画タイトルから回戦キーを返す。該当なしは None。"""
    t = _nfkc(title)
    for pat, round_key in PLAYLIST_RULES:
        if pat.search(t):
            return round_key
    return None


def playlist_kind(title: str) -> str:
    """表示用の種類名(プレイリスト名から年を除いたもの)。例: '3回戦ネタ 2026' → '3回戦ネタ'。"""
    return re.sub(r"\s+", " ", _YEAR.sub(" ", title)).strip()


def extract_names(title: str, description: str) -> list[dict]:
    """動画の出演コンビ名の候補を出番順に返す。label は '2組目' / '1位通過' / None。"""
    desc = _nfkc(description)
    names = [{"name": name, "label": f"{n}組目"} for n, name in _ORDER_LINE.findall(desc)]
    if not names:
        names = [{"name": name, "label": f"{n}位通過"} for n, name in _RANK_LINE.findall(desc)]
    if names:
        return names
    # 例: 【1回戦TOP３】 A/B/C【M-1グランプリ2026】、【ナイスアマチュア賞】 A ＜キャッチ＞ 【M-1グランプリ2026】、
    #     【M-1グランプリ2026】 A 【2回戦直撃インタビュー】
    t = _CATCH.sub("", _BRACKETS.sub("/", _nfkc(title)))
    out = []
    for seg in t.split("/"):
        seg = seg.strip()
        # 「2回戦直撃!インタビューまとめ【東京編】」のような複数組の総集編は1組に紐付けない
        if seg and "まとめ" not in seg:
            out.append({"name": seg, "label": None})
    return out


def venue_of(description: str) -> str | None:
    """説明文の会場行 '11/3 (火) [東京] KANDA SQUARE HALL' → '11/3(火) 東京 KANDA SQUARE HALL'。"""
    m = _VENUE_LINE.search(_nfkc(description))
    if not m:
        return None
    return f"{m[1]}({m[2]}) {m[3]} {m[4]}"


def _get_pages(client: httpx.Client, url: str, params: dict) -> list[dict]:
    items: list[dict] = []
    token = None
    while True:
        p = dict(params, maxResults=50)
        if token:
            p["pageToken"] = token
        resp = client.get(url, params=p)
        _raise_if_quota_exceeded(resp)
        resp.raise_for_status()
        body = resp.json()
        items.extend(body.get("items", []))
        token = body.get("nextPageToken")
        if not token:
            return items


def parse_playlist(pl: dict, items: list[dict]) -> dict | None:
    """プレイリスト1件(API応答)を work 形式へ。回戦に対応しないものは None。"""
    title = pl["snippet"]["title"]
    round_key = classify(title)
    if round_key is None:
        return None
    m = _YEAR.search(_nfkc(title))
    pl_year = int(m[1]) if m else None
    videos = []
    for it in items:
        # 非公開・削除済み(タイトルが "Private video" 等になる)は捨てる
        if it.get("status", {}).get("privacyStatus") != "public":
            continue
        sn = it["snippet"]
        vtitle = sn.get("title", "")
        desc = sn.get("description", "")
        ym = _TITLE_YEAR.search(_nfkc(vtitle)) or _TITLE_YEAR.search(_nfkc(desc))
        year = pl_year or (int(ym[1]) if ym else None)
        if year is None:
            continue
        v = {
            "id": sn["resourceId"]["videoId"],
            "year": year,
            # 動画タイトルに回戦語があればそれを優先(【2回戦直撃インタビュー】【3回戦ネタ】等)
            "round": classify(vtitle) or round_key,
            "names": extract_names(vtitle, desc),
        }
        at = venue_of(desc)
        if at:
            v["at"] = at
        videos.append(v)
    return {
        "id": pl["id"],
        "title": title,
        "year": pl_year,
        "round": round_key,
        "kind": playlist_kind(title),
        "count": len(videos),
        "videos": videos,
    }


def fetch_official_videos(client: httpx.Client | None = None, out_path=None) -> dict:
    api_key = _require_api_key()
    out_path = out_path or WORK_DIR / "official_videos.json"
    own = client is None
    client = client or httpx.Client(timeout=30, headers={"User-Agent": USER_AGENT})
    try:
        raw = _get_pages(
            client, PLAYLISTS_URL, {"part": "snippet", "channelId": CHANNEL_ID, "key": api_key}
        )
        playlists = []
        for pl in raw:
            if classify(pl["snippet"]["title"]) is None:
                continue
            items = _get_pages(
                client,
                PLAYLIST_ITEMS_URL,
                {"part": "snippet,status", "playlistId": pl["id"], "key": api_key},
            )
            parsed = parse_playlist(pl, items)
            if parsed and parsed["videos"]:
                playlists.append(parsed)
                print(f"[official] {parsed['title']}: {parsed['count']}本 ({parsed['round']})")
    finally:
        if own:
            client.close()
    if not playlists:
        # API の一時的な異常で全リンクが消えるのを防ぐ(シーズン後もインタビュー等は残るので0件は異常)
        raise SystemExit("[official] 対象プレイリストが0件のため work を更新しません")
    data = {
        "source": SOURCE,
        "channelId": CHANNEL_ID,
        "fetchedAt": date.today().isoformat(),
        "playlists": playlists,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[official] -> {out_path} ({sum(p['count'] for p in playlists)}本)")
    return data


def load_overrides() -> dict:
    """overrides/official_videos.json。byVideo={動画ID:{名前:ID}}(同名コンビの判別)、
    byName={年:{名前:ID}}(YouTube 側の誤字など、その年なら一意に決まるもの)。"""
    path = OVERRIDES_DIR / "official_videos.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def match_official_videos(work: dict, year_files: dict[int, dict], overrides: dict | None = None):
    """work を年度データのエントリーへ紐付け、配信用 JSON と照合レポートを返す。

    出力のコンビIDは必ず「その年・その回戦に結果がある組」に含まれる。
    同名が複数いて決め手が無い名前は紐付けない(誤リンクより無リンクを選ぶ)。
    """
    overrides = overrides or {}
    by_video = {
        vid: {match_key(k): v for k, v in m.items()} for vid, m in overrides.get("byVideo", {}).items()
    }
    by_name = {
        str(y): {match_key(k): v for k, v in m.items()} for y, m in overrides.get("byName", {}).items()
    }

    index_cache: dict[tuple[int, str], tuple[dict, dict] | None] = {}

    def entrants(year: int, round_key: str):
        key = (year, round_key)
        if key not in index_cache:
            yf = year_files.get(year)
            if yf is None:
                index_cache[key] = None
            else:
                by_norm: dict[str, list[dict]] = {}
                by_id: dict[int, dict] = {}
                for e in yf["entries"]:
                    if e.get("id") is None or not e["results"].get(round_key):
                        continue
                    by_norm.setdefault(match_key(e["name"]), []).append(e)
                    by_id[e["id"]] = e
                index_cache[key] = (by_norm, by_id)
        return index_cache[key]

    years: dict[str, dict] = {}
    report: dict[tuple[int, str], dict] = {}

    def bucket(year: int) -> dict:
        return years.setdefault(str(year), {"playlists": {}, "combis": {}})

    for pl in work.get("playlists", []):
        if pl.get("year") is not None and pl["year"] in year_files:
            bucket(pl["year"])["playlists"].setdefault(pl["round"], []).append(
                {"id": pl["id"], "title": pl["title"], "count": pl["count"]}
            )
        for v in pl["videos"]:
            idx = entrants(v["year"], v["round"])
            rep = report.setdefault(
                (v["year"], v["round"]), {"matched": 0, "unmatched": [], "ambiguous": [], "noYear": 0}
            )
            if idx is None:
                rep["noYear"] += 1
                continue
            by_norm, by_id = idx
            for n in v["names"]:
                norm = match_key(n["name"])
                cid = by_video.get(v["id"], {}).get(norm) or by_name.get(str(v["year"]), {}).get(norm)
                if cid is not None and cid not in by_id:
                    rep["unmatched"].append(f"{n['name']}(override先{cid}が{v['round']}に不在)")
                    continue
                if cid is None:
                    cands = by_norm.get(norm, [])
                    # 1回戦TOP3 の組は必ずその回戦の通過組(説明文の「N位通過」が無くても種類名で分かる)
                    top = (n.get("label") or "").endswith("位通過") or _TOP_KIND.search(pl["kind"])
                    if len(cands) > 1 and top:
                        cands = [e for e in cands if e["results"][v["round"]] in PASSING]
                    if len(cands) == 1:
                        cid = cands[0]["id"]
                    elif cands:
                        rep["ambiguous"].append(f"{n['name']}({v['id']})")
                        continue
                    else:
                        rep["unmatched"].append(f"{n['name']}({v['id']})")
                        continue
                links = bucket(v["year"])["combis"].setdefault(str(cid), {}).setdefault(v["round"], [])
                if any(x["v"] == v["id"] for x in links):
                    continue
                link = {"v": v["id"], "k": pl["kind"]}
                if n.get("label"):
                    link["p"] = n["label"]
                if v.get("at"):
                    link["at"] = v["at"]
                links.append(link)
                rep["matched"] += 1

    data = {
        "channel": CHANNEL_URL,
        "fetchedAt": work.get("fetchedAt"),
        "years": {y: b for y, b in sorted(years.items()) if b["playlists"] or b["combis"]},
    }
    return data, report


def print_report(report: dict) -> None:
    for (year, round_key), r in sorted(report.items()):
        line = f"[build] 公式YouTube {year} {round_key}: 紐付け {r['matched']}組"
        if r["unmatched"]:
            line += f" / 未紐付け {len(r['unmatched'])} {r['unmatched'][:5]}"
        if r["ambiguous"]:
            line += f" / 同名で判別不可 {len(r['ambiguous'])} {r['ambiguous'][:5]}"
        if r["noYear"]:
            line += f" / 年度データなし {r['noYear']}本"
        print(line)


__all__ = [
    "QuotaExceeded",
    "classify",
    "extract_names",
    "fetch_official_videos",
    "load_overrides",
    "match_official_videos",
    "print_report",
]
