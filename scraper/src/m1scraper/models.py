"""回戦・結果の正規化。"""

# 回戦の表記 → 正規化キー(表示順でもある)
ROUND_KEYS = ["first", "second", "third", "quarterfinal", "semifinal", "playoff", "final"]

ROUND_NAME_TO_KEY = {
    "１回戦": "first",
    "1回戦": "first",
    "２回戦": "second",
    "2回戦": "second",
    "３回戦": "third",
    "3回戦": "third",
    "準々決勝": "quarterfinal",
    "準決勝": "semifinal",
    "敗者復活戦": "playoff",
    "決勝戦": "final",
    "決勝": "final",
}

ROUND_KEY_TO_JA = {
    "first": "1回戦",
    "second": "2回戦",
    "third": "3回戦",
    "quarterfinal": "準々決勝",
    "semifinal": "準決勝",
    "playoff": "敗者復活戦",
    "final": "決勝",
}

# 結果文字列 → 正規化キー。未知の文字列は unknown として raw を保持する
RESULT_TO_KEY = {
    "通過": "pass",
    "敗退": "fail",
    "シード権獲得により通過": "seed_pass",
    "優勝": "champion",
    "欠席": "absent",
    "出場予定": "scheduled",
}


def normalize_result(raw: str) -> tuple[str, str | None]:
    """結果文字列を (正規化キー, 未知なら生文字列) にする。"""
    raw = raw.strip()
    key = RESULT_TO_KEY.get(raw)
    if key is None:
        return "unknown", raw
    return key, None
