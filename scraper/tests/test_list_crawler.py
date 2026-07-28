from pathlib import Path

from m1scraper.list_crawler import parse_list_page

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_list_page():
    html = (FIXTURES / "list_2025_page1.html").read_text(encoding="utf-8")
    total, rows = parse_list_page(html)

    assert total == 10483
    assert len(rows) == 20

    first = rows[0]
    assert first["id"] == 6
    assert first["name"] == "ビンディーず"
    assert first["formed"] == "2011年"
    assert "2026年" in first["status"]
