from m1scraper.build_json import build_member_index


def _rec(cid, members):
    return {"id": cid, "members": members}


def test_rows_align_with_records_and_are_flat_pairs():
    rows, dropped = build_member_index(
        [
            _rec(1, [{"name": "塙宣之", "kana": "ハナワノブユキ"}, {"name": "土屋伸之", "kana": "ツチヤノブユキ"}]),
            _rec(2, [{"name": "粗品", "kana": "ソシナ"}]),
            _rec(3, [{"name": "a"}, {"name": "b"}, {"name": "c"}]),
        ]
    )
    assert len(rows) == 3
    assert dropped == 0
    assert all(len(r) % 2 == 0 for r in rows)
    assert rows[0] == ["塙宣之", "ハナワノブユキ", "土屋伸之", "ツチヤノブユキ"]
    assert rows[1] == ["粗品", "ソシナ"]
    assert len(rows[2]) == 6


def test_missing_kana_becomes_empty_string():
    rows, _ = build_member_index([_rec(1, [{"name": "ジャスパー"}, {"name": "玉子", "kana": None}])])
    assert rows[0] == ["ジャスパー", "", "玉子", ""]


def test_member_without_name_is_dropped_and_counted():
    rows, dropped = build_member_index(
        [_rec(1, [{"name": "", "kana": "カナ"}, {"kana": "カナ2"}, {"name": "  "}, {"name": "実在"}])]
    )
    assert rows[0] == ["実在", ""]
    assert dropped == 3


def test_combi_without_members_still_yields_a_row():
    # 行を落とすと index.json との位置対応が壊れるので、空配列で必ず1行出す
    rows, dropped = build_member_index([_rec(1, []), _rec(2, None), _rec(3, [{"name": "x"}])])
    assert rows == [[], [], ["x", ""]]
    assert dropped == 0


def test_names_and_kana_are_stripped_but_not_normalized():
    # 正規化はクライアント側の責務。ここでは前後の空白を落とすだけ
    rows, _ = build_member_index([_rec(1, [{"name": " 伊達みきお ", "kana": " だてみきお "}])])
    assert rows[0] == ["伊達みきお", "だてみきお"]
