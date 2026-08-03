from pathlib import Path

from m1scraper.combi_parser import parse_combi_page, parse_history

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_combi_page_oswald():
    html = (FIXTURES / "combi_2389.html").read_text(encoding="utf-8")
    rec = parse_combi_page(2389, html)

    assert rec["name"] == "オズワルド"
    assert rec["kana"] == "オズワルド"
    assert rec["formed"] == 2014
    assert rec["belong"] == "プロ（吉本興業）"
    assert [m["name"] for m in rec["members"]] == ["畠中悠", "伊藤俊介"]
    assert rec["photo"] == "image_cms/2400/2389_combi_.jpg"

    # 2015〜2026 の全年度が取れている
    assert set(rec["history"]) >= {str(y) for y in range(2015, 2027)}

    h2025 = rec["history"]["2025"]
    assert h2025["no"] == 5372
    assert h2025["results"] == {
        "first": "seed_pass",
        "second": "pass",
        "third": "pass",
        "quarterfinal": "fail",
    }

    h2021 = rec["history"]["2021"]
    assert h2021["results"]["final"] == "fail"
    assert h2021["results"]["semifinal"] == "pass"

    # 2016年は1回戦敗退
    assert rec["history"]["2016"]["results"] == {"first": "fail"}


def test_parse_history_champion_and_unknown():
    desc = (
        "出場コンビ テスト "
        "[2024年 エントリーNo.1] １回戦：通過 ２回戦：通過 ３回戦：通過 "
        "準々決勝：通過 準決勝：通過 決勝戦：優勝 "
        "[2023年 エントリーNo.2] １回戦：謎の結果"
    )
    h = parse_history(desc)
    assert h["2024"]["results"]["final"] == "champion"
    assert h["2023"]["results"]["first"] == "unknown"
    assert h["2023"]["raw"]["first"] == "謎の結果"


def test_parse_combi_page_default_photo_is_none():
    html = """<html><head>
    <meta name="description" content="出場コンビ テスト [2024年 エントリーNo.1] １回戦：敗退">
    <meta property="og:image" content="https://www.m-1gp.com/combi/img/detail/img_emptyPic.jpg">
    </head><body><p class="name-txt-full">テスト</p></body></html>"""
    rec = parse_combi_page(1, html)
    assert rec["photo"] is None


def test_parse_history_year_without_rounds():
    # エントリー直後(「出場予定」)は年ブロックのみで回戦がない
    h = parse_history("[2026年 エントリーNo.100]")
    assert h["2026"]["results"] == {}
