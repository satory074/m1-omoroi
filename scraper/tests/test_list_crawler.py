import json
from pathlib import Path

from m1scraper import list_crawler
from m1scraper.list_crawler import detect_stale, parse_list_page, parse_list_status

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


def test_parse_list_status():
    # 確定結果は (回戦, 結果) を返す。list は「シード通過」表記(meta と異なる)
    assert parse_list_status("2026年 １回戦：敗退", 2026) == ("first", "fail")
    assert parse_list_status("2026年 １回戦：通過", 2026) == ("first", "pass")
    assert parse_list_status("2026年 １回戦：シード通過", 2026) == ("first", "seed_pass")
    assert parse_list_status("2026年 １回戦：欠席", 2026) == ("first", "absent")
    assert parse_list_status("2026年 ２回戦：通過", 2026) == ("second", "pass")
    # 未確定・回戦なし・対象年でない・空 は None
    assert parse_list_status("2026年 １回戦：出場予定", 2026) == ("first", "scheduled")
    assert parse_list_status("2026年 出場予定", 2026) is None
    assert parse_list_status("2025年 １回戦：敗退", 2026) is None
    assert parse_list_status(None, 2026) is None


def test_detect_stale(tmp_path, monkeypatch):
    monkeypatch.setattr(list_crawler, "WORK_DIR", tmp_path)
    # list は確定結果を示す4組
    (tmp_path / "list_2026.jsonl").write_text(
        "\n".join(
            json.dumps({"id": i, "status": s}, ensure_ascii=False)
            for i, s in [
                (1, "2026年 １回戦：敗退"),  # 詳細が scheduled のまま → stale
                (2, "2026年 １回戦：通過"),  # 詳細も pass で一致 → 対象外
                (3, "2026年 １回戦：出場予定"),  # 未確定 → 対象外
                (4, "2026年 ２回戦：通過"),  # 詳細に second が無い → stale
            ]
        ),
        encoding="utf-8",
    )
    # 詳細ページのパース結果
    (tmp_path / "combi.jsonl").write_text(
        "\n".join(
            json.dumps({"id": i, "history": h}, ensure_ascii=False)
            for i, h in [
                (1, {"2026": {"results": {"first": "scheduled"}}}),
                (2, {"2026": {"results": {"first": "pass"}}}),
                (3, {"2026": {"results": {"first": "scheduled"}}}),
                (4, {"2026": {"results": {"first": "pass"}}}),
            ]
        ),
        encoding="utf-8",
    )

    stale = detect_stale(2026)
    assert stale == [1, 4]
    assert json.loads((tmp_path / "stale_2026.json").read_text()) == [1, 4]
