"""パス・URL・レート制限などの定義。"""

from pathlib import Path

SCRAPER_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SCRAPER_ROOT.parent

CACHE_DIR = SCRAPER_ROOT / "cache"
WORK_DIR = SCRAPER_ROOT / "work"
STATE_DIR = SCRAPER_ROOT / "state"
OVERRIDES_DIR = SCRAPER_ROOT / "overrides"
DATA_DIR = REPO_ROOT / "data"

BASE_URL = "https://www.m-1gp.com"
COMBI_LIST_URL = (
    BASE_URL + "/combi/list.php?searchbtn=&search_name=&search_belong=0&search_allSingle=all"
)
COMBI_DETAIL_URL = BASE_URL + "/combi/{id}.html"
ARCHIVE_INDEX_URL = BASE_URL + "/archive/{year}/"

WIKIPEDIA_API_URL = "https://ja.wikipedia.org/w/api.php"

USER_AGENT = "m1-omoroi-fansite/0.1 (personal fan site; contact: satory074@gmail.com)"

# 自主レート制限: リクエスト間の最小間隔(秒)
REQUEST_INTERVAL = 0.35

# 公式コンビDBに収録されている開催年(2026はシーズン進行中)
DB_YEARS = list(range(2015, 2027))
ARCHIVE_YEARS = list(range(2001, 2011))
ALL_YEARS = ARCHIVE_YEARS + DB_YEARS
