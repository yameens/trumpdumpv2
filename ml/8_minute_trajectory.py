"""
8_minute_trajectory.py
----------------------
Compute the mean Cumulative Abnormal Return (CAR) at every minute from
T-10 to T+60 relative to each post's effective event time, grouped by
tw_sentiment (negative / neutral / positive).

Reads:
  ml/data/intraday_event_study_results.csv  — event_utc, etf_ticker, tw_sentiment
  ml/data/intraday_prices.db                — 1-min bars

Writes:
  frontend/public/trajectory_data.json
  {
    "minutes":  [-10, -9, ..., 60],
    "negative": [<mean CAR bps>, ...],   // 71 values
    "neutral":  [...],
    "positive": [...]
  }

CAR at minute t = (ETF_t / ETF_baseline - 1) - (SPY_t / SPY_baseline - 1)
baseline = last bar strictly before event_utc  (same as 7b_intraday_event_study.py)
"""

import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone

import pandas as pd
from tqdm import tqdm

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT    = os.path.dirname(SCRIPT_DIR)
DATA_DIR     = os.path.join(SCRIPT_DIR, "data")
POSTS_PATH   = os.path.join(DATA_DIR, "intraday_event_study_results.csv")
DB_PATH      = os.path.join(DATA_DIR, "intraday_prices.db")
OUT_PATH     = os.path.join(REPO_ROOT, "frontend", "public", "trajectory_data.json")

MINUTES      = list(range(-10, 61))   # T-10 … T+60
MARKET_PROXY = "SPY.US"

# ── Bar cache (same pattern as 7b) ─────────────────────────────────────────────
_bars_cache: dict[tuple[str, str], pd.DataFrame] = {}

def load_bars(conn: sqlite3.Connection, ticker: str, date_str: str) -> pd.DataFrame:
    key = (ticker, date_str)
    if key in _bars_cache:
        return _bars_cache[key]
    rows = conn.execute(
        "SELECT datetime_et, close FROM intraday_prices "
        "WHERE ticker=? AND substr(datetime_et,1,10)=? ORDER BY datetime_et",
        (ticker, date_str),
    ).fetchall()
    if not rows:
        df = pd.DataFrame(columns=["dt_utc", "close"])
    else:
        df = pd.DataFrame(rows, columns=["dt_utc", "close"])
        df["dt_utc"] = pd.to_datetime(df["dt_utc"], utc=True)
    _bars_cache[key] = df
    return df


def price_at_or_before(bars: pd.DataFrame, ts: datetime) -> float | None:
    sub = bars[bars["dt_utc"] <= pd.Timestamp(ts)]
    return float(sub.iloc[-1]["close"]) if not sub.empty else None


def price_at_or_after(bars: pd.DataFrame, ts: datetime) -> float | None:
    sub = bars[bars["dt_utc"] >= pd.Timestamp(ts)]
    return float(sub.iloc[0]["close"]) if not sub.empty else None


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"Loading {POSTS_PATH} …")
    posts = pd.read_csv(POSTS_PATH, low_memory=False)
    posts = posts.dropna(subset=["event_utc", "etf_ticker", "tw_sentiment"])
    posts["event_utc"] = pd.to_datetime(posts["event_utc"], utc=True)
    print(f"  {len(posts):,} posts with complete event_utc")

    conn = sqlite3.connect(DB_PATH)

    # accumulators: sentiment → list of per-post minute CAR arrays
    # We store sums and counts for memory efficiency
    groups = ["negative", "neutral", "positive"]
    sums   = {g: [0.0] * len(MINUTES) for g in groups}
    counts = {g: [0]   * len(MINUTES) for g in groups}

    for _, row in tqdm(posts.iterrows(), total=len(posts), desc="Computing trajectories", unit="post"):
        sentiment  = str(row["tw_sentiment"])
        if sentiment not in groups:
            continue

        event_utc  = row["event_utc"]                             # timezone-aware
        etf_ticker = str(row["etf_ticker"]) + ".US"
        day0       = str(row["day0_date"])

        etf_bars   = load_bars(conn, etf_ticker, day0)
        spy_bars   = load_bars(conn, MARKET_PROXY, day0)

        # baseline = last bar before event_utc (same as 7b definition: event_utc - 1 min)
        baseline_ts = event_utc - timedelta(minutes=1)
        etf_base    = price_at_or_before(etf_bars, baseline_ts)
        spy_base    = price_at_or_before(spy_bars, baseline_ts)

        if etf_base is None or spy_base is None or etf_base == 0 or spy_base == 0:
            continue

        for i, t in enumerate(MINUTES):
            target_ts = event_utc + timedelta(minutes=t)

            if t < 0:
                # Before event: use last bar at-or-before target
                etf_p = price_at_or_before(etf_bars, target_ts)
                spy_p = price_at_or_before(spy_bars, target_ts)
            else:
                # At or after event: use first bar at-or-after target
                etf_p = price_at_or_after(etf_bars, target_ts)
                spy_p = price_at_or_after(spy_bars, target_ts)

            if etf_p is None or spy_p is None or etf_p == 0 or spy_p == 0:
                continue

            car_bps = ((etf_p / etf_base) - (spy_p / spy_base)) * 10_000
            sums[sentiment][i]   += car_bps
            counts[sentiment][i] += 1

    conn.close()

    # Compute means
    result: dict = {"minutes": MINUTES}
    for g in groups:
        result[g] = [
            round(sums[g][i] / counts[g][i], 4) if counts[g][i] > 0 else 0.0
            for i in range(len(MINUTES))
        ]
        n_valid = sum(1 for c in counts[g] if c > 0)
        avg_n   = sum(counts[g]) // len(MINUTES) if len(MINUTES) else 0
        print(f"  {g}: {n_valid}/{len(MINUTES)} minutes covered, avg n={avg_n} posts")

    # ── Sector AR_60 for positive posts (diverging bar chart data) ────────────
    print("\nComputing sector_ar60_positive from CSV …")
    posts_csv = pd.read_csv(POSTS_PATH, low_memory=False)
    pos_posts = posts_csv[posts_csv["tw_sentiment"] == "positive"].dropna(subset=["AR_60", "target_sector"])
    sector_ar60 = (
        pos_posts.groupby("target_sector")["AR_60"].mean() * 10_000
    ).round(4).to_dict()
    result["sector_ar60_positive"] = sector_ar60
    print("  Sectors:", list(sector_ar60.keys()))
    for s, v in sorted(sector_ar60.items(), key=lambda x: x[1]):
        print(f"    {s:<30} {v:+.2f} bps")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\nSaved → {OUT_PATH}")
    print(f"Sample (negative T0 to T+5): {result['negative'][10:16]}")
    print(f"Sample (positive T0 to T+5): {result['positive'][10:16]}")


if __name__ == "__main__":
    main()
