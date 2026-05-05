"""
6_market_data.py
----------------
Fetch daily OHLCV data for every ticker in final_mapped_results.csv plus
the S&P 500 (^GSPC) as the market baseline.

Uses a single yfinance batch download over the full date range so we never
have to hit the Yahoo Finance API again — results are cached locally.

Input:   ml/data/final_mapped_results.csv
Outputs: ml/data/market_data.db   (SQLite, table: prices)
         ml/data/market_data.csv  (flat CSV backup)

Schema: ticker | date | open | high | low | close | adj_close | volume
Primary key: (ticker, date)
"""

import os
import sqlite3
import sys
from datetime import timedelta

import pandas as pd
import yfinance as yf

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
DATA_DIR     = os.path.join(SCRIPT_DIR, "data")
INPUT_PATH   = os.path.join(DATA_DIR, "final_mapped_results.csv")
DB_PATH      = os.path.join(DATA_DIR, "market_data.db")
CSV_PATH     = os.path.join(DATA_DIR, "market_data.csv")

# ── Helpers ────────────────────────────────────────────────────────────────────

def get_tickers_and_dates(df: pd.DataFrame) -> tuple[list[str], str, str]:
    """
    Extract the sorted ticker list (+ ^GSPC) and fetch window from the mapped CSV.
    Returns (tickers, fetch_start_str, fetch_end_str).
    """
    unique: set[str] = set()
    for cell in df["target_tickers"].dropna():
        for t in str(cell).split("|"):
            t = t.strip()
            if t:
                unique.add(t)
    unique.add("^GSPC")
    tickers = sorted(unique)

    dates = pd.to_datetime(df["created_at"], errors="coerce").dt.date.dropna()
    # -1/+3 trading-day buffer — use calendar buffer of 5/7 to survive weekends
    fetch_start = (min(dates) - timedelta(days=5)).isoformat()
    fetch_end   = (max(dates) + timedelta(days=7)).isoformat()
    return tickers, fetch_start, fetch_end


def download_prices(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    """
    Download all tickers in one batch call and return a long-format DataFrame:
    ticker | date | open | high | low | close | adj_close | volume
    """
    print(f"Downloading {len(tickers)} tickers from {start} to {end} ...")
    raw = yf.download(
        tickers,
        start=start,
        end=end,
        auto_adjust=False,
        progress=True,
        threads=True,
    )

    if raw.empty:
        print("ERROR: yfinance returned empty data.")
        sys.exit(1)

    # raw has MultiIndex columns: (field, ticker)
    # Stack ticker level to get long format
    # yfinance 0.2+ uses 'Ticker' as column level name
    col_level = raw.columns.names[-1]  # 'Ticker' or 1
    long = raw.stack(level=col_level, future_stack=True).reset_index()

    # Normalise column names regardless of yfinance version
    long.columns = [str(c).strip() for c in long.columns]
    # Rename 'level_1' or 'Ticker' → 'ticker', 'Date' → 'date'
    rename_map: dict[str, str] = {}
    for c in long.columns:
        cl = c.lower()
        if cl in ("ticker", "level_1"):
            rename_map[c] = "ticker"
        elif cl == "date":
            rename_map[c] = "date"
        elif cl == "open":
            rename_map[c] = "open"
        elif cl == "high":
            rename_map[c] = "high"
        elif cl == "low":
            rename_map[c] = "low"
        elif cl == "close":
            rename_map[c] = "close"
        elif cl in ("adj close", "adj_close"):
            rename_map[c] = "adj_close"
        elif cl == "volume":
            rename_map[c] = "volume"
    long = long.rename(columns=rename_map)

    # Keep only the columns we care about (drop any extras yfinance may add)
    keep = [c for c in ["ticker", "date", "open", "high", "low", "close", "adj_close", "volume"]
            if c in long.columns]
    long = long[keep].copy()

    long["date"] = pd.to_datetime(long["date"]).dt.date.astype(str)
    long = long.dropna(subset=["close"])
    long = long.drop_duplicates(subset=["ticker", "date"])
    long = long.sort_values(["ticker", "date"]).reset_index(drop=True)
    return long


def save_to_sqlite(df: pd.DataFrame, db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    cur  = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS prices")
    cur.execute("""
        CREATE TABLE prices (
            ticker    TEXT NOT NULL,
            date      TEXT NOT NULL,
            open      REAL,
            high      REAL,
            low       REAL,
            close     REAL,
            adj_close REAL,
            volume    INTEGER,
            PRIMARY KEY (ticker, date)
        )
    """)
    df.to_sql("prices", conn, if_exists="append", index=False)
    conn.commit()
    conn.close()
    print(f"Saved {len(df):,} rows → {db_path}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    if not os.path.exists(INPUT_PATH):
        print(f"ERROR: {INPUT_PATH} not found. Run 5_entity_mapper.py first.")
        sys.exit(1)

    print(f"Reading {INPUT_PATH} ...")
    df_posts = pd.read_csv(INPUT_PATH, low_memory=False)
    print(f"  {len(df_posts):,} posts loaded.")

    tickers, fetch_start, fetch_end = get_tickers_and_dates(df_posts)
    print(f"\nTickers ({len(tickers)}): {tickers}")
    print(f"Fetch window: {fetch_start} → {fetch_end}\n")

    prices = download_prices(tickers, fetch_start, fetch_end)

    print(f"\nLong-format rows: {len(prices):,}")
    print(f"Tickers with data: {prices['ticker'].nunique()}")
    print(f"Date range in data: {prices['date'].min()} → {prices['date'].max()}")

    # SQLite
    save_to_sqlite(prices, DB_PATH)

    # CSV backup
    prices.to_csv(CSV_PATH, index=False)
    print(f"Saved {len(prices):,} rows → {CSV_PATH}")

    # Per-ticker summary
    print("\nRows per ticker (sample):")
    counts = prices.groupby("ticker").size().sort_values(ascending=False)
    for ticker, n in counts.items():
        sample = prices[prices["ticker"] == ticker].iloc[-1]
        print(f"  {ticker:<8s}  {n:>4} days  last_close={sample['close']:.2f} ({sample['date']})")


if __name__ == "__main__":
    main()
