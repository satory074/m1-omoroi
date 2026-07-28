#!/bin/zsh
# 全量クロールのオーケストレータ。
# 全件一覧(search指定なし)はサーバ側で1頁7秒超かかるため、年度別一覧(~2.6秒/頁)を
# 2並列で列挙し、判明したIDから並行して詳細ページをクロールする。
set -u
cd "$(dirname "$0")/.."

merge_lists() {
  uv run python - <<'PY'
import json, glob, pathlib
ids = {}
for f in sorted(glob.glob('work/list_*.jsonl')):
    for line in open(f, encoding='utf-8'):
        r = json.loads(line)
        ids[r['id']] = r
out = pathlib.Path('work/list.jsonl')
with out.open('w', encoding='utf-8') as fh:
    for i in sorted(ids):
        fh.write(json.dumps(ids[i], ensure_ascii=False) + '\n')
print(f"[merge] {len(ids)}組", flush=True)
PY
}

( for y in 2026 2024 2022 2020 2018 2016; do uv run m1 crawl-list --year $y; done; echo "[worker1] 完了" ) &
W1=$!
( for y in 2025 2023 2021 2019 2017; do uv run m1 crawl-list --year $y; done; echo "[worker2] 完了" ) &
W2=$!

# 列挙が進むたびにマージして詳細クロール(キャッシュ済みはスキップされる)
while true; do
  merge_lists
  uv run m1 crawl-combi
  if ! kill -0 $W1 2>/dev/null && ! kill -0 $W2 2>/dev/null; then
    break
  fi
  sleep 120
done

wait
merge_lists
uv run m1 crawl-combi
echo "[full-crawl] 完了"
