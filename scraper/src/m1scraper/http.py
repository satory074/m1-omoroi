"""取得層: レート制限・リトライ・ファイルキャッシュ。

キャッシュは生バイト列で保存し、デコードはパーサ側で行う
(旧アーカイブのエンコーディング差異に対応するため)。
"""

import time
from pathlib import Path

import httpx

from .config import REQUEST_INTERVAL, USER_AGENT


class Fetcher:
    def __init__(self, interval: float = REQUEST_INTERVAL):
        self.interval = interval
        self._last_request = 0.0
        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=30.0,
            follow_redirects=True,
        )

    def get(self, url: str, cache_path: Path, force: bool = False) -> bytes:
        """URLを取得してキャッシュする。キャッシュ済みならネットワークに出ない。"""
        if not force and cache_path.exists():
            return cache_path.read_bytes()

        self._throttle()
        for attempt in range(4):
            try:
                resp = self._client.get(url)
            except httpx.TransportError:
                if attempt == 3:
                    raise
                time.sleep(2 ** (attempt + 1))
                continue
            if resp.status_code in (429, 503):
                # サーバ都合の拒否は長めに待つ
                time.sleep(30 * (attempt + 1))
                continue
            resp.raise_for_status()
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = cache_path.with_suffix(cache_path.suffix + ".tmp")
            tmp.write_bytes(resp.content)
            tmp.rename(cache_path)
            return resp.content
        raise RuntimeError(f"取得失敗(リトライ上限): {url}")

    def _throttle(self):
        wait = self._last_request + self.interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.monotonic()

    def close(self):
        self._client.close()


def decode_html(raw: bytes) -> str:
    """meta charset を見つつ寛容にデコードする。"""
    head = raw[:2048].decode("ascii", errors="ignore").lower()
    for enc in ("utf-8", "shift_jis", "euc-jp"):
        if enc.replace("_", "-") in head or enc in head:
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                break
    for enc in ("utf-8", "cp932", "euc-jp"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")
