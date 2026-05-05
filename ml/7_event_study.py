"""
7_event_study.py
----------------
Merge sentiment-scored, sector-mapped Truth Social posts with daily market
prices and compute Abnormal Returns (AR) for the event window.

Day 0 definition (precise):
    before_market / during_market  →  Day 0 = same calendar date (or next trading day if holiday)
    after_market / weekend         →  Day 0 = next trading day after post date

AR calculation (per post, sector ETF vs. ^GSPC):
    AR_0   = ETF_return_day0 - GSPC_return_day0
    AR_1   = ETF_return_day1 - GSPC_return_day1
    CAR    = AR_0 + AR_1

Inputs:   ml/data/final_mapped_results.csv
          ml/data/market_data.db
Output:   ml/data/event_study_results.csv
"""

import os
import sqlite3
import sys
from datetime import date, timedelta

import pandas as pd

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.join(SCRIPT_DIR, "data")
POSTS_PATH = os.path.join(DATA_DIR, "final_mapped_results.csv")
DB_PATH    = os.path.join(DATA_DIR, "market_data.db")
OUT_PATH   = os.path.join(DATA_DIR, "event_study_results.csv")

# ── Trading calendar helpers ───────────────────────────────────────────────────

def build_trading_calendar(prices: pd.DataFrame) -> tuple[list[str], set[str]]:
    days = sorted(prices.loc[prices["ticker"] == "^GSPC", "date"].unique())
    return days, set(days)


def resolve_day0(post_date: date, market_period: str, trading_day_set: set[str]) -> str | None:
    """
    Return the ISO date string for Day 0, or None if it falls outside our data.
    after_market posts: advance one calendar day first, then find next trading day.
    """
    d = post_date
    if market_period == "after_market":
        d = d + timedelta(days=1)
    # Walk forward until we land on a trading day (handles weekends + holidays)
    for _ in range(10):
        if str(d) in trading_day_set:
            return str(d)
        d += timedelta(days=1)
    return None  # should never happen within our data range


def offset_trading_day(day0_str: str, trading_days: list[str], offset: int) -> str | None:
    """Return the trading day `offset` steps from day0 (-1, +1, etc.)."""
    try:
        idx = trading_days.index(day0_str)
    except ValueError:
        return None
    new_idx = idx + offset
    if 0 <= new_idx < len(trading_days):
        return trading_days[new_idx]
    return None


# ── Core computation ───────────────────────────────────────────────────────────

def compute_event_rows(posts: pd.DataFrame, close_wide: pd.DataFrame,
                       trading_days: list[str], trading_day_set: set[str]) -> pd.DataFrame:
    """
    For each post compute day0_date, ETF/GSPC returns, and ARs.
    Returns a DataFrame of event columns aligned with posts index.
    """
    rows = []
    for _, post in posts.iterrows():
        etf = str(post["target_tickers"]).split("|")[0].strip()
        raw_date = pd.to_datetime(post["created_at"], errors="coerce")
        if pd.isna(raw_date):
            rows.append(_empty_row(etf))
            continue

        market_period = str(post.get("market_period", "after_market")).strip()
        day0 = resolve_day0(raw_date.date(), market_period, trading_day_set)
        if day0 is None:
            rows.append(_empty_row(etf))
            continue

        tm1  = offset_trading_day(day0, trading_days, -1)
        tp1  = offset_trading_day(day0, trading_days, +1)

        # Fetch closes — use .get() so missing ticker/date → NaN
        def close(ticker, day):
            if day is None or ticker not in close_wide.columns or day not in close_wide.index:
                return float("nan")
            return close_wide.at[day, ticker]

        etf_tm1  = close(etf,    tm1)
        etf_t0   = close(etf,    day0)
        etf_tp1  = close(etf,    tp1)
        mkt_tm1  = close("^GSPC", tm1)
        mkt_t0   = close("^GSPC", day0)
        mkt_tp1  = close("^GSPC", tp1)

        def ret(p1, p0):
            if pd.isna(p1) or pd.isna(p0) or p0 == 0:
                return float("nan")
            return (p1 - p0) / p0

        etf_r0 = ret(etf_t0, etf_tm1)
        mkt_r0 = ret(mkt_t0, mkt_tm1)
        ar0    = etf_r0 - mkt_r0 if not (pd.isna(etf_r0) or pd.isna(mkt_r0)) else float("nan")

        etf_r1 = ret(etf_tp1, etf_t0)
        mkt_r1 = ret(mkt_tp1, mkt_t0)
        ar1    = etf_r1 - mkt_r1 if not (pd.isna(etf_r1) or pd.isna(mkt_r1)) else float("nan")

        car = ar0 + ar1 if not (pd.isna(ar0) or pd.isna(ar1)) else float("nan")

        rows.append({
            "day0_date":     day0,
            "etf_ticker":    etf,
            "etf_return_0":  round(etf_r0, 6) if not pd.isna(etf_r0) else float("nan"),
            "mkt_return_0":  round(mkt_r0, 6) if not pd.isna(mkt_r0) else float("nan"),
            "AR_0":          round(ar0,    6) if not pd.isna(ar0)    else float("nan"),
            "etf_return_1":  round(etf_r1, 6) if not pd.isna(etf_r1) else float("nan"),
            "mkt_return_1":  round(mkt_r1, 6) if not pd.isna(mkt_r1) else float("nan"),
            "AR_1":          round(ar1,    6) if not pd.isna(ar1)    else float("nan"),
            "CAR_0_1":       round(car,    6) if not pd.isna(car)    else float("nan"),
        })

    return pd.DataFrame(rows, index=posts.index)


def _empty_row(etf: str) -> dict:
    return {
        "day0_date": None, "etf_ticker": etf,
        "etf_return_0": float("nan"), "mkt_return_0": float("nan"), "AR_0": float("nan"),
        "etf_return_1": float("nan"), "mkt_return_1": float("nan"), "AR_1": float("nan"),
        "CAR_0_1": float("nan"),
    }


# ── Summary table ──────────────────────────────────────────────────────────────

def print_summary(df: pd.DataFrame) -> None:
    sub = df[df["tw_sentiment"].isin(["positive", "negative"])].copy()
    sub["AR_0_pct"]   = sub["AR_0"]   * 100
    sub["AR_1_pct"]   = sub["AR_1"]   * 100
    sub["CAR_0_1_pct"] = sub["CAR_0_1"] * 100

    grp = (
        sub.groupby(["tw_sentiment", "target_sector"])
           .agg(
               n        = ("AR_0", "count"),
               mean_AR0 = ("AR_0_pct",   "mean"),
               mean_AR1 = ("AR_1_pct",   "mean"),
               mean_CAR = ("CAR_0_1_pct","mean"),
           )
           .round(4)
    )

    print("\n" + "="*80)
    print("AVERAGE ABNORMAL RETURNS BY SENTIMENT × SECTOR  (values in %)")
    print("="*80)
    print(f"{'Sentiment':<12} {'Sector':<30} {'N':>5} {'AR Day0':>9} {'AR Day+1':>9} {'CAR':>9}")
    print("-"*80)

    for (sentiment, sector), row in grp.iterrows():
        print(f"{sentiment:<12} {sector:<30} {int(row['n']):>5} "
              f"{row['mean_AR0']:>+9.4f} {row['mean_AR1']:>+9.4f} {row['mean_CAR']:>+9.4f}")

    print("="*80)

    # Overall positive vs negative
    overall = (
        sub.groupby("tw_sentiment")
           .agg(n=("AR_0","count"),
                mean_AR0=("AR_0_pct","mean"),
                mean_AR1=("AR_1_pct","mean"),
                mean_CAR=("CAR_0_1_pct","mean"))
           .round(4)
    )
    print("\nOVERALL (all sectors combined):")
    print(f"{'Sentiment':<12} {'N':>5} {'AR Day0':>9} {'AR Day+1':>9} {'CAR':>9}")
    print("-"*50)
    for sentiment, row in overall.iterrows():
        print(f"{sentiment:<12} {int(row['n']):>5} "
              f"{row['mean_AR0']:>+9.4f} {row['mean_AR1']:>+9.4f} {row['mean_CAR']:>+9.4f}")
    print("="*80)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    for p in [POSTS_PATH, DB_PATH]:
        if not os.path.exists(p):
            print(f"ERROR: {p} not found.")
            sys.exit(1)

    # Load posts
    print(f"Loading {POSTS_PATH} ...")
    posts = pd.read_csv(POSTS_PATH, low_memory=False)
    print(f"  {len(posts):,} posts.")

    # Load prices and pivot to wide: index=date, columns=ticker, values=close
    print(f"Loading prices from {DB_PATH} ...")
    conn = sqlite3.connect(DB_PATH)
    prices = pd.read_sql("SELECT ticker, date, close FROM prices", conn)
    conn.close()
    print(f"  {len(prices):,} price rows, {prices['ticker'].nunique()} tickers.")

    trading_days, trading_day_set = build_trading_calendar(prices)
    print(f"  Trading calendar: {trading_days[0]} → {trading_days[-1]} ({len(trading_days)} days)")

    close_wide = prices.pivot(index="date", columns="ticker", values="close")

    # Compute event columns
    print("\nComputing event windows ...")
    event_df = compute_event_rows(posts, close_wide, trading_days, trading_day_set)

    # Merge back
    result = pd.concat([posts.reset_index(drop=True), event_df.reset_index(drop=True)], axis=1)

    # Coverage report
    n_total    = len(result)
    n_ar0_ok   = result["AR_0"].notna().sum()
    n_ar1_ok   = result["AR_1"].notna().sum()
    n_car_ok   = result["CAR_0_1"].notna().sum()
    print(f"\nCoverage:  AR_0={n_ar0_ok:,}/{n_total:,}  AR_1={n_ar1_ok:,}/{n_total:,}  CAR={n_car_ok:,}/{n_total:,}")

    # Save
    result.to_csv(OUT_PATH, index=False)
    print(f"Saved {len(result):,} rows → {OUT_PATH}")

    # Summary table
    print_summary(result)


if __name__ == "__main__":
    main()
