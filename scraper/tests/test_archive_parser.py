from m1scraper.archive_parser import parse_result_page

# 2001・2002年の準決勝ページの形(合否の列が先、名前が後。合格者に花マーク画像)
_SEMIFINAL_2001 = """
<html><body>
<H1>準決勝・東京　ルミネtheよしもと　2001/12/1</H1>
<P><B>■出場者一覧</B></P>
<TABLE>
<TR><TD>合格</TD><TD>名前</TD></TR>
<TR><TD>&nbsp;</TD><TD>飛石連休</TD></TR>
<TR><TD><IMG SRC="img/flower.gif" ALT="○"></TD><TD>おぎやはぎ</TD></TR>
<TR><TD>&nbsp;</TD><TD>カリカ</TD></TR>
</TABLE>
</body></html>
"""


def test_pass_column_first_format_is_read():
    """合否の列が名前より前にある表も読める(以前は0件になり、2001・2002年の準決勝が丸ごと抜けていた)。"""
    round_key, rows = parse_result_page(_SEMIFINAL_2001)
    assert round_key == "semifinal"
    assert rows == [
        ("飛石連休", None, False),
        ("おぎやはぎ", None, True),
        ("カリカ", None, False),
    ]
