"""m1 コマンド: データ収集パイプラインの入口。

すべてのステージはキャッシュ/中間ファイルベースでレジューム可能。
"""

import argparse
import json
import sys

from .config import CACHE_DIR, COMBI_DETAIL_URL, WORK_DIR
from .http import Fetcher, decode_html


def cmd_crawl_list(args):
    from .list_crawler import crawl_list, detect_changed

    fetcher = Fetcher()
    try:
        rows = crawl_list(fetcher, year=args.year, refresh=args.refresh)
        if args.detect_changed:
            if not args.year:
                sys.exit("--detect-changed には --year が必要です")
            changed = detect_changed(rows, args.year)
            out = WORK_DIR / f"changed_{args.year}.json"
            out.write_text(json.dumps(changed), encoding="utf-8")
            print(f"[detect-changed] -> {out}")
    finally:
        fetcher.close()


def _load_ids(args) -> list[int]:
    if args.ids:
        return json.loads(args.ids.read_text(encoding="utf-8"))
    list_path = WORK_DIR / "list.jsonl"
    if not list_path.exists():
        sys.exit(f"{list_path} がありません。先に `m1 crawl-list` を実行してください")
    return [json.loads(line)["id"] for line in list_path.open(encoding="utf-8")]


def cmd_crawl_combi(args):
    ids = _load_ids(args)
    if args.limit:
        ids = ids[: args.limit]
    cache_dir = CACHE_DIR / "combi"
    todo = [i for i in ids if args.force or not (cache_dir / f"{i}.html").exists()]
    print(f"[crawl-combi] 対象 {len(ids)}件 / 未取得 {len(todo)}件")

    fetcher = Fetcher()
    try:
        for n, combi_id in enumerate(todo, 1):
            fetcher.get(
                COMBI_DETAIL_URL.format(id=combi_id),
                cache_dir / f"{combi_id}.html",
                force=args.force,
            )
            if n % 200 == 0 or n == len(todo):
                print(f"[crawl-combi] {n}/{len(todo)}", flush=True)
    finally:
        fetcher.close()


def cmd_parse_combi(args):
    import gzip

    from .combi_parser import parse_combi_page

    cache_dir = CACHE_DIR / "combi"
    files = sorted(cache_dir.glob("*.html"), key=lambda p: int(p.stem))
    if not files:
        sys.exit(f"{cache_dir} にキャッシュがありません。先に `m1 crawl-combi` を実行してください")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    out_path = WORK_DIR / "combi.jsonl"
    gz_path = WORK_DIR / "combi.jsonl.gz"

    # 既存の正本を読み込み、今回パースした分で上書きマージする。
    # CI差分更新のようにキャッシュが部分的でも全コンビのデータが保たれる
    records: dict[int, dict] = {}
    if out_path.exists():
        for line in out_path.open(encoding="utf-8"):
            rec = json.loads(line)
            records[rec["id"]] = rec
    elif gz_path.exists():
        with gzip.open(gz_path, "rt", encoding="utf-8") as f:
            for line in f:
                rec = json.loads(line)
                records[rec["id"]] = rec
    merged_from = len(records)

    unknown: dict[str, int] = {}
    no_history = 0
    junk = 0
    for n, path in enumerate(files, 1):
        record = parse_combi_page(int(path.stem), decode_html(path.read_bytes()))
        if record["name"] is None:
            # 存在しないIDは404ページへリダイレクトされる。コンビ名が取れないものは除外
            junk += 1
            records.pop(record["id"], None)
            continue
        if not record["history"]:
            no_history += 1
        for year_entry in record["history"].values():
            for raw in year_entry.get("raw", {}).values():
                unknown[raw] = unknown.get(raw, 0) + 1
        records[record["id"]] = record
        if n % 2000 == 0 or n == len(files):
            print(f"[parse-combi] {n}/{len(files)}", flush=True)

    lines = [
        json.dumps(records[i], ensure_ascii=False) + "\n" for i in sorted(records)
    ]
    out_path.write_text("".join(lines), encoding="utf-8")
    with gzip.open(gz_path, "wt", encoding="utf-8") as f:
        f.writelines(lines)

    report = WORK_DIR / "unknown_results.json"
    report.write_text(json.dumps(unknown, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[parse-combi] -> {out_path} (計{len(records)}組, 既存{merged_from}組とマージ)")
    print(f"[parse-combi] 成績なし: {no_history}件 / 404等の除外: {junk}件 / 未知の結果文字列: {unknown or 'なし'}")


def cmd_crawl_archive(args):
    from .archive_parser import crawl_archive

    fetcher = Fetcher()
    try:
        crawl_archive(fetcher, years=args.year and [args.year] or None)
    finally:
        fetcher.close()


def cmd_parse_archive(args):
    from .archive_parser import parse_archive

    parse_archive()


def cmd_crawl_finals(args):
    from .wikipedia_finals import crawl_finals

    fetcher = Fetcher()
    try:
        crawl_finals(fetcher, years=args.year and [args.year] or None)
    finally:
        fetcher.close()


def cmd_fetch_popularity(args):
    from .wiki_popularity import fetch_popularity

    fetch_popularity()


def cmd_build(args):
    from .build_json import build

    build()


def main():
    parser = argparse.ArgumentParser(prog="m1", description="M-1ファンサイトのデータパイプライン")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("crawl-list", help="list.php を巡回して全コンビを列挙")
    p.add_argument("--year", type=int, help="開催年で絞込 (2015〜)")
    p.add_argument("--refresh", action="store_true", help="キャッシュを無視して再取得")
    p.add_argument("--detect-changed", action="store_true", help="前回とステータスが変わったIDを抽出")
    p.set_defaults(func=cmd_crawl_list)

    p = sub.add_parser("crawl-combi", help="コンビ詳細ページを取得(レジューム可)")
    p.add_argument("--ids", type=__import__("pathlib").Path, help="IDのJSON配列ファイル")
    p.add_argument("--limit", type=int)
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_crawl_combi)

    p = sub.add_parser("parse-combi", help="キャッシュ済み詳細ページをパース")
    p.set_defaults(func=cmd_parse_combi)

    p = sub.add_parser("crawl-archive", help="2001〜2010 アーカイブを取得")
    p.add_argument("--year", type=int)
    p.set_defaults(func=cmd_crawl_archive)

    p = sub.add_parser("parse-archive", help="アーカイブをパースし敗退を導出")
    p.set_defaults(func=cmd_parse_archive)

    p = sub.add_parser("crawl-finals", help="Wikipediaから決勝得点表を取得")
    p.add_argument("--year", type=int)
    p.set_defaults(func=cmd_crawl_finals)

    p = sub.add_parser("fetch-popularity", help="Wikipedia閲覧数(注目度)を取得")
    p.set_defaults(func=cmd_fetch_popularity)

    p = sub.add_parser("build", help="work/* から data/* を生成")
    p.set_defaults(func=cmd_build)

    args = parser.parse_args()
    args.func(args)
