"""
2_relevance_filter.py
---------------------
Classify each cleaned Truth Social post as financially relevant or not
using async gpt-4o-mini calls, then save only the relevant rows to CSV.

Run (from repo root, with venv active):
    python ml/2_relevance_filter.py

Checkpoint/resume: progress is streamed to ml/data/relevance_cache.jsonl
so the script can be interrupted and restarted without re-classifying rows.
"""

import asyncio
import json
import os
import sys
import time

import pandas as pd
from openai import AsyncOpenAI, RateLimitError

# ── Config ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR      = os.path.dirname(os.path.abspath(__file__))
DATA_DIR        = os.path.join(SCRIPT_DIR, "data")
INPUT_PATH      = os.path.join(DATA_DIR, "truth_social_clean.parquet")
CACHE_PATH      = os.path.join(DATA_DIR, "relevance_cache.jsonl")
OUTPUT_PATH     = os.path.join(DATA_DIR, "relevant_posts.csv")

MAX_CONCURRENT  = 8           # concurrent API calls — stay under 500 RPM limit
MODEL           = "gpt-4o-mini"
COST_PER_POST   = 0.00015     # rough estimate in USD per post
CONFIRM_ABOVE   = 5_000       # ask user to confirm if classifying > this many rows

SYSTEM_PROMPT = """\
You are a financial market relevance classifier for an event study.

Mark a post True if it could PLAUSIBLY move stock prices, sector ETFs, or \
macroeconomic expectations — even indirectly. Be INCLUSIVE, not strict.

Say True if the post touches ANY of the following:
- Macroeconomics: inflation, CPI, GDP, unemployment, interest rates, Fed, debt, deficits
- Trade & tariffs: imports, exports, sanctions, supply chains, USMCA, China trade
- Energy: oil, gas, pipelines, green energy, drilling, OPEC, fuel prices
- Companies or CEOs (named or implied): e.g. attacking Amazon, praising Tesla
- Industries (even implied): defense, pharma, banks, tech, agriculture, housing
- Government spending or contracts: military, infrastructure, subsidies
- Geopolitics that moves markets: wars, Israel/Gaza, Russia/Ukraine, NATO, China
- Regulatory actions: FDA, EPA, antitrust, bank regulation, crypto rules
- Elections / political uncertainty: outcomes that shift policy expectations
- Economic attacks on Biden/Democrats: these imply policy contrast with market impact
- Any numerical economic data: stock levels, gas prices, CPI, unemployment rates

Say False ONLY for posts that are purely personal (rallies, legal drama, \
insults with no economic angle, sports, pure culture war with zero policy signal).

Respond with ONLY the word True or False.\
"""

# ── Load .env from repo root (best-effort) ────────────────────────────────────
_env_path = os.path.join(os.path.dirname(SCRIPT_DIR), ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

# ── Helpers ────────────────────────────────────────────────────────────────────

def load_cache(path: str) -> dict[int, bool]:
    """Return {row_index: is_relevant} for all already-classified rows."""
    cache: dict[int, bool] = {}
    if not os.path.exists(path):
        return cache
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                cache[int(entry["id"])] = bool(entry["is_relevant"])
            except (json.JSONDecodeError, KeyError):
                pass
    return cache


def append_cache(path: str, row_id: int, is_relevant: bool) -> None:
    with open(path, "a") as f:
        f.write(json.dumps({"id": row_id, "is_relevant": is_relevant}) + "\n")


async def classify_post(
    client: AsyncOpenAI,
    sem: asyncio.Semaphore,
    row_id: int,
    text: str,
    cache_path: str,
    progress: list[int],
    total: int,
) -> tuple[int, bool]:
    async with sem:
        is_relevant = False
        for attempt in range(5):
            try:
                response = await client.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user",   "content": text[:2000]},
                    ],
                    temperature=0,
                    max_tokens=5,
                )
                raw = (response.choices[0].message.content or "").strip().lower()
                is_relevant = raw.startswith("true")
                break
            except RateLimitError:
                wait = 2 ** attempt
                await asyncio.sleep(wait)
            except Exception as exc:
                print(f"\n  [WARN] row {row_id} failed ({exc.__class__.__name__}: {exc}) → False")
                break

        append_cache(cache_path, row_id, is_relevant)
        progress[0] += 1
        if progress[0] % 100 == 0 or progress[0] == total:
            pct = progress[0] / total * 100
            print(f"  {progress[0]:>6,}/{total:,}  ({pct:.1f}%)", end="\r", flush=True)

        return row_id, is_relevant


async def run(df: pd.DataFrame, cache: dict[int, bool]) -> dict[int, bool]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: OPENAI_API_KEY not set. Export it or add it to .env at the repo root.")
        sys.exit(1)

    client = AsyncOpenAI(api_key=api_key)
    sem    = asyncio.Semaphore(MAX_CONCURRENT)

    # Only classify rows not already in cache
    todo = [(i, row["text"]) for i, row in df.iterrows() if i not in cache]

    if not todo:
        print("All rows already classified (cache is complete).")
        return cache

    progress = [0]
    tasks = [
        classify_post(client, sem, row_id, text, CACHE_PATH, progress, len(todo))
        for row_id, text in todo
    ]

    results = await asyncio.gather(*tasks)
    print()  # newline after progress line

    new_results = dict(results)
    return {**cache, **new_results}


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    if not os.path.exists(INPUT_PATH):
        print(f"ERROR: {INPUT_PATH} not found. Run 1_data_loader.py first.")
        sys.exit(1)

    print(f"Loading {INPUT_PATH} ...")
    df = pd.read_parquet(INPUT_PATH)
    print(f"  {len(df):,} posts loaded.")

    print(f"Loading checkpoint from {CACHE_PATH} ...")
    cache = load_cache(CACHE_PATH)
    print(f"  {len(cache):,} rows already classified.")

    todo_count = sum(1 for i in df.index if i not in cache)
    est_cost   = todo_count * COST_PER_POST
    print(f"To classify: {todo_count:,} posts   (cached: {len(cache):,})")
    print(f"Estimated cost: ~${est_cost:.2f} USD")

    if todo_count > CONFIRM_ABOVE and not os.environ.get("AUTO_CONFIRM"):
        ans = input(f"That's > {CONFIRM_ABOVE:,} rows. Continue? [y/N] ").strip().lower()
        if ans != "y":
            print("Aborted.")
            sys.exit(0)

    results = asyncio.run(run(df, cache))

    # Attach is_relevant column
    df["is_relevant"] = df.index.map(lambda i: results.get(i, False))

    total      = len(df)
    n_relevant = df["is_relevant"].sum()
    print(f"\nResults: {n_relevant:,} relevant / {total:,} total  ({n_relevant/total*100:.1f}%)")

    relevant_df = df[df["is_relevant"]].copy()
    relevant_df.to_csv(OUTPUT_PATH, index=False)
    print(f"Saved {len(relevant_df):,} relevant posts → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
