import json

import httpx
import pytest

from m1scraper import youtube_popularity
from m1scraper.youtube_popularity import (
    NameMatcher,
    QuotaExceeded,
    _load_overrides,
    accept_video,
    fetch_view_counts,
    plan_todo,
    rescore_popularity,
    search_video_ids,
    select_targets,
)


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _quota_response() -> httpx.Response:
    return httpx.Response(
        403,
        json={"error": {"errors": [{"reason": "quotaExceeded"}]}},
    )


def _video(
    view_count, title="", description="", channel="", tags=None, category=None, vid=None
):
    return {
        **({"id": vid} if vid else {}),
        "statistics": {"viewCount": str(view_count)},
        "snippet": {
            "title": title,
            "description": description,
            "channelTitle": channel,
            **({"tags": tags} if tags else {}),
            **({"categoryId": category} if category else {}),
        },
    }


def test_search_video_ids():
    def handler(request):
        assert request.url.params["q"] == "真空ジェシカ 漫才"
        assert request.url.params["type"] == "video"
        return httpx.Response(
            200,
            json={
                "items": [
                    {"id": {"kind": "youtube#video", "videoId": "abc"}},
                    {"id": {"kind": "youtube#video", "videoId": "def"}},
                    {"id": {"kind": "youtube#channel"}},  # videoIdなしは除外
                ]
            },
        )

    with _client(handler) as client:
        assert search_video_ids(client, "KEY", "真空ジェシカ") == ["abc", "def"]


def test_search_quota_exceeded():
    with _client(lambda request: _quota_response()) as client:
        with pytest.raises(QuotaExceeded):
            search_video_ids(client, "KEY", "カベポスター")


def test_429_is_quota_error():
    def handler(request):
        return httpx.Response(429, json={"error": {"code": 429}})

    with _client(handler) as client:
        with pytest.raises(QuotaExceeded):
            search_video_ids(client, "KEY", "ミキ")


def test_plain_403_is_not_quota_error():
    def handler(request):
        return httpx.Response(403, json={"error": {"errors": [{"reason": "forbidden"}]}})

    with _client(handler) as client:
        with pytest.raises(httpx.HTTPStatusError):
            search_video_ids(client, "KEY", "ダイヤモンド")


# ---------------------------------------------------------------------------
# 採用判定
# ---------------------------------------------------------------------------


def test_accept_fields_and_normalization():
    # タイトル一致
    assert accept_video(_video(1, title="真空ジェシカ 寄り添いサーカス"), "真空ジェシカ")
    # 説明文一致(タイトルにコンビ名がない公式ネタ動画を想定)
    assert accept_video(
        _video(1, title="【敗者復活戦ネタ】恋煩い", description="出演: ドンデコルテ"),
        "ドンデコルテ",
    )
    # チャンネル名一致
    assert accept_video(_video(1, channel="金属バットの車窓から"), "金属バット")
    # タグ一致
    assert accept_video(_video(1, tags=["漫才", "カベポスター"]), "カベポスター")
    # 大文字小文字・全角半角・空白の揺れを吸収 (THIS IS パン → This is パン / Thisisパン)
    assert accept_video(_video(1, title="This is パン 単独ライブ"), "THIS IS パン")
    assert accept_video(_video(1, title="Thisisパン 単独ライブ"), "THIS IS パン")
    assert accept_video(_video(1, title="Ｕ字工事 漫才"), "U字工事")
    # 無関係な動画は不一致
    assert not accept_video(
        _video(1, title="干ししいたけの白味噌バター炒め", channel="河崎紘一郎"),
        "スーパー土瓶",
    )


@pytest.mark.parametrize(
    "name, text, expected",
    [
        # カナ→カナの連結は別語
        ("シャララ", "シャラララックス【岡山弁アニメ】", False),
        ("ドラゴン", "ドランクドラゴン　ネタ　お笑いPRIDE", False),
        ("カラン", "ゼロカラン【神保町よしもと漫才劇場】", False),
        # 漢字→漢字の連結は別語
        ("百恵", "ちびっ子から山口百恵への禁断の質問", False),
        ("号泣", "若林号泣 #shorts", False),
        ("太宰", "又吉直樹『太宰治』をインプット", False),
        # 英数は英数/カナ/漢字と連結したら別語、ひらがな(助詞)は可
        ("2000", "【ヨネダ2000】M-1グランプリ2022決勝ネタ「餅つき」", False),
        ("1000", "漫才グランプリで賞金1000万円を目指すゲーム", False),
        ("1000", "コンビ「1000」がメディア初出演", True),
        ("EXIT", "EXITの単独ライブ！ネタあり歌あり", True),
        ("ヨネダ2000", "ヨネダ2000がM-1決勝まであたためていた幻のネタ", True),
        # ひらがな終わりは助詞なら可、それ以外のひらがな連結は不可
        ("いぬ", "いぬのコント「喫煙所」", True),
        ("千年ぶり", "千年ぶりのYouTube", True),
        ("ぺ", "ぺこぱ 漫才", False),
        ("ぺ", "ぺぺ", False),
        ("あゆ", "浜崎あゆみvs石橋貴明", False),
        # 空白・記号・文字種の切り替わりは境界
        ("ネルソンズ", "【公式】ネルソンズ コント『上司の説教』", True),
        ("メンバー", "メンバー　歌ネタ　「裏声」", True),
        ("爛々", "茶の間で爛々", True),
        ("南海キャンディーズ", "山里亮太×山崎静代　南海キャンディーズ2016M1の決勝用の漫才", True),
        ("オキシジェン", "30-1グランプリ　オキシジェン②", True),
        # 許容接尾語(チャンネル・漫才・研究所 等)が続く場合は文字種に関わらず採用
        ("例えば炎", "【M-1敗者復活ネタ】仕上げ前の「焼肉」【例えば炎研究所】", True),
        ("ヨネダ2000", "ヨネダ2000チャンネル", True),
        ("怪獣", "怪獣漫才 実写版", True),
    ],
)
def test_name_matcher_word_boundary(name, text, expected):
    assert NameMatcher(name).contains(text) is expected


@pytest.mark.parametrize(
    "name, channel, expected",
    [
        ("ジャルジャル", "ジャルジャルタワー JARUJARU TOWER", True),
        ("ネルソンズ", "ネルソンズチャンネル【公式】", True),
        ("ネルソンズ", "【公式】ネルソンズチャンネル", True),
        ("レインボー", "レインボーコントチャンネル", True),
        ("コットン", "コットンシアター", True),
        ("百恵", "(公式)百恵チャン", True),
        ("EXIT", "EXIT Charannel AI", True),
        ("千年ぶり", "千年ぶりのYouTube", True),
        ("GAG", "GAGの細髭柴ch", True),
        ("いぬ", "いぬコントフィルム", True),
        # 名前で始まっても別語の連結なら自チャンネルではない
        ("シャララ", "シャラララックス【岡山弁アニメ】", False),
        ("チル", "チルアウトーク", False),
        ("自由気まま", "自由気ままあゆチャンネル", False),
        # 名前で始まらない
        ("チル", "カズレーザーと松陰寺のチルるーム【公式】", False),
        ("カラン", "ゼロカランゆーちゅーぶらんど", False),
        ("2000", "ヨネダ2000チャンネル", False),
        ("爛々", "茶の間で爛々", False),
    ],
)
def test_own_channel(name, channel, expected):
    assert NameMatcher(name).is_own_channel(channel) is expected


def test_own_channel_video_counts_regardless_of_title_and_category():
    # タイトルにコンビ名が無くても、音楽カテゴリでも自チャンネルなら採用(歌ネタ芸人の自チャンネル等)
    v = _video(1, title="24時間やった歌ネタを2分30秒にまとめてみた", channel="メンバーチャンネル", category="10")
    assert accept_video(v, "メンバー")
    assert not accept_video(v, "オーケストラ")


def test_third_party_music_gaming_sports_news_excluded():
    assert not accept_video(
        _video(1, title="水曜日のカンパネラ - エジソン / THE FIRST TAKE", channel="THE FIRST TAKE", category="10"),
        "エジソン",
    )
    assert not accept_video(_video(1, title="賞金1000万円を目指すゲーム 1000", channel="牛沢", category="20"), "1000")
    # 同じ動画でもエンタメ(24)・コメディ(23)・カテゴリ不明なら通常判定
    assert accept_video(_video(1, title="エジソン【よしもと漫才劇場 8周年記念SPネタ】", category="24"), "エジソン")
    assert accept_video(_video(1, title="エジソン【よしもと漫才劇場 8周年記念SPネタ】"), "エジソン")


def test_overrides_exclude_channels_and_ids():
    override = {"excludeChannels": ["チルるーム", "東京チル・ドレン"], "excludeIds": ["xyz"]}
    assert not accept_video(
        _video(1, title="【超怖い】チル 免許取得", channel="カズレーザーと松陰寺のチルるーム【公式】"), "チル", override
    )
    # チャンネル名の部分一致は NFKC・大小無視
    assert not accept_video(_video(1, title="チル", channel="ＴＯＫＹＯ 東京チル・ドレン"), "チル", override)
    assert not accept_video(_video(1, title="チル 漫才", vid="xyz"), "チル", override)
    # 除外対象外・自チャンネルより除外指定が優先
    assert accept_video(_video(1, title="チル 漫才", vid="abc"), "チル", override)
    assert not accept_video(_video(1, channel="チルるーム"), "チル", {"excludeChannels": ["チルるーム"]})
    # override なし/空は素通り
    assert accept_video(_video(1, title="チル 漫才"), "チル", None)
    assert accept_video(_video(1, title="チル 漫才"), "チル", {})


def test_load_overrides(tmp_path, monkeypatch):
    monkeypatch.setattr(youtube_popularity, "OVERRIDES_DIR", tmp_path)
    assert _load_overrides() == {}
    (tmp_path / "popularity.json").write_text(
        json.dumps({"_comment": "x", "6212": {"excludeChannels": ["チルるーム"]}}), encoding="utf-8"
    )
    assert _load_overrides()["6212"] == {"excludeChannels": ["チルるーム"]}


# ---------------------------------------------------------------------------
# 集計
# ---------------------------------------------------------------------------


def test_fetch_view_counts_filters_unrelated():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "items": [
                    _video(1000, title="まっかちん 漫才"),
                    _video(3_440_022, title="呂布カルマが選ぶラッパーTOP5"),  # 無関係
                    _video(500, description="天の声まっかちん出演"),
                ]
            },
        )

    with _client(handler) as client:
        assert fetch_view_counts(client, "KEY", ["a", "b", "c"], "まっかちん") == [1000, 500]


def test_fetch_view_counts_applies_override():
    def handler(request):
        return httpx.Response(
            200,
            json={"items": [_video(1000, title="チル 漫才", channel="東京チル・ドレン"), _video(5, title="チル 漫才")]},
        )

    with _client(handler) as client:
        assert fetch_view_counts(client, "KEY", ["a", "b"], "チル") == [1000, 5]
        assert fetch_view_counts(
            client, "KEY", ["a", "b"], "チル", {"excludeChannels": ["東京チル・ドレン"]}
        ) == [5]


def test_fetch_view_counts_batches_and_sums():
    calls = []

    def handler(request):
        ids = request.url.params["id"].split(",")
        calls.append(len(ids))
        assert request.url.params["part"] == "statistics,snippet"
        return httpx.Response(
            200,
            json={"items": [_video(i, title="和牛 漫才") for i, _ in enumerate(ids, 1)]},
        )

    video_ids = [f"v{i}" for i in range(60)]  # 50件/バッチで2回に分割される
    with _client(handler) as client:
        views = fetch_view_counts(client, "KEY", video_ids, "和牛")

    assert calls == [50, 10]
    assert len(views) == 60
    assert sum(views) == sum(range(1, 51)) + sum(range(1, 11))


def test_fetch_view_counts_skips_missing_statistics():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "items": [
                    _video(1000, title="吉田たち 漫才"),
                    {"statistics": {}, "snippet": {"title": "吉田たち 漫才"}},  # 統計非公開
                ]
            },
        )

    with _client(handler) as client:
        assert fetch_view_counts(client, "KEY", ["a", "b"], "吉田たち") == [1000]


def test_select_targets_third_round_or_higher(tmp_path, monkeypatch):
    records = [
        {"id": 1, "name": "3回戦止まり", "history": {"2024": {"results": {"third": "fail"}}}},
        {"id": 2, "name": "2回戦止まり", "history": {"2024": {"results": {"second": "fail"}}}},
        {"id": 3, "name": "決勝進出", "history": {"2023": {"results": {"final": "pass"}}}},
        {"id": 4, "name": "成績なし", "history": {}},
    ]
    (tmp_path / "combi.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8"
    )
    monkeypatch.setattr(youtube_popularity, "WORK_DIR", tmp_path)

    assert [t["id"] for t in select_targets()] == [1, 3]


def test_plan_todo_missing_first_then_oldest():
    targets = [{"id": i, "name": f"c{i}"} for i in (1, 2, 3, 4)]
    hits = {
        "2": {"n": 10, "at": "2026-08-10"},
        "3": {"n": 20, "at": "2026-08-01"},
    }
    # 未取得(1, 4)が先、取得済みは古い順(3 → 2)
    assert [t["id"] for t in plan_todo(targets, hits)] == [1, 4, 3, 2]


def test_rescore_popularity(tmp_path, monkeypatch):
    monkeypatch.setattr(youtube_popularity, "WORK_DIR", tmp_path)
    monkeypatch.setattr(youtube_popularity, "OVERRIDES_DIR", tmp_path)
    monkeypatch.setenv("YOUTUBE_API_KEY", "KEY")
    records = [
        {"id": 10, "name": "シャララ", "history": {"2024": {"results": {"third": "fail"}}}},
        {"id": 20, "name": "メンバー", "history": {"2024": {"results": {"third": "pass"}}}},
        {"id": 30, "name": "2回戦止まり", "history": {"2024": {"results": {"second": "fail"}}}},
    ]
    (tmp_path / "combi.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8"
    )
    hits = {
        # 旧ルール(部分一致)で無関係チャンネルが加算されていた組。動画 shared は両組に現れる
        "10": {"n": 999, "at": "2026-09-01", "v": 3, "ids": ["s1", "s2", "shared", "gone"]},
        "20": {"n": 1, "at": "2026-09-05", "v": 1, "ids": ["shared", "m1"]},
        # 対象外(2回戦止まり)の組は名前が引けないので触らない
        "30": {"n": 7, "at": "2026-09-02", "v": 1, "ids": ["x1"]},
    }
    (tmp_path / "popularity.json").write_text(
        json.dumps({"source": youtube_popularity.SOURCE, "hits": hits}), encoding="utf-8"
    )
    videos = {
        "s1": _video(100, title="シャララ‐『漫才』", channel="早稲田寄席演芸研究会", vid="s1"),
        "s2": _video(10_000_000, title="ジジイ同士のラップバトル", channel="シャラララックス【岡山弁アニメ】", vid="s2"),
        "shared": _video(5000, title="メンバー　オーケストラ歌ネタLIVE", channel="メンバーチャンネル", vid="shared"),
        "m1": _video(300, title="歌ネタ「裏声」", channel="メンバーチャンネル", vid="m1"),
        "x1": _video(1, title="x", vid="x1"),
        # "gone" は削除済み → 応答に含まれない
    }
    calls = []

    def handler(request):
        ids = request.url.params["id"].split(",")
        calls.append(ids)
        return httpx.Response(200, json={"items": [videos[i] for i in ids if i in videos]})

    with _client(handler) as client:
        changes = rescore_popularity(client=client)

    # ユニークIDを1回ずつ(重複 shared は1回)、50件以内なので1リクエスト
    assert len(calls) == 1
    assert sorted(calls[0]) == ["gone", "m1", "s1", "s2", "shared", "x1"]

    out = json.loads((tmp_path / "popularity.json").read_text(encoding="utf-8"))
    assert out["source"] == youtube_popularity.SOURCE
    # シャララ: 本人の1本のみ。at と ids は維持
    assert out["hits"]["10"] == {"n": 100, "at": "2026-09-01", "v": 1, "ids": ["s1", "s2", "shared", "gone"]}
    # メンバー: 自チャンネル2本
    assert out["hits"]["20"] == {"n": 5300, "at": "2026-09-05", "v": 2, "ids": ["shared", "m1"]}
    # 対象外の組はそのまま
    assert out["hits"]["30"] == hits["30"]
    assert sorted(c[1] for c in changes) == ["シャララ", "メンバー"]


def test_rescore_popularity_quota_exceeded_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(youtube_popularity, "WORK_DIR", tmp_path)
    monkeypatch.setattr(youtube_popularity, "OVERRIDES_DIR", tmp_path)
    monkeypatch.setenv("YOUTUBE_API_KEY", "KEY")
    (tmp_path / "combi.jsonl").write_text(
        json.dumps({"id": 1, "name": "a", "history": {"2024": {"results": {"third": "fail"}}}}) + "\n",
        encoding="utf-8",
    )
    original = json.dumps({"source": youtube_popularity.SOURCE, "hits": {"1": {"n": 5, "at": "d", "v": 1, "ids": ["v"]}}})
    (tmp_path / "popularity.json").write_text(original, encoding="utf-8")

    with _client(lambda request: _quota_response()) as client:
        with pytest.raises(SystemExit):
            rescore_popularity(client=client)
    assert (tmp_path / "popularity.json").read_text(encoding="utf-8") == original
