"""
6b_intraday_data.py
-------------------
Fetch 1-minute OHLCV bars from EODHD for every unique (day0_date, etf_ticker)
pair in event_study_results.csv, plus SPY as the market baseline for every
day0_date.

Why SPY as baseline? EODHD's intraday index endpoint (GSPC.INDX) returns no
data; SPY tracks S&P 500 with <0.05% daily tracking error, making it an
ideal intraday proxy.

Each (date, ticker) pair is fetched as one API call covering the full UTC day
so every bar from pre-market through after-hours is captured.

Checkpointing: already-fetched (ticker, date) pairs are skipped on re-run.

Rate limit: paid EODHD plan allows 1,000 req/min. We use a semaphore of 20
concurrent requests (~120 req/min sustained, well under limit).

Input:   ml/data/event_study_results.csv
Output:  ml/data/intraday_prices.db  (SQLite, table: intraday_prices)
"""

import asyncio
import os
import sqlite3
import sys
from datetime import datetime, timezone

import aiohttp
from dotenv import load_dotenv
from tqdm import tqdm
import pandas as pd

# ── Config ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT   = os.path.dirname(SCRIPT_DIR)
DATA_DIR    = os.path.join(SCRIPT_DIR, "data")
INPUT_PATH  = os.path.join(DATA_DIR, "event_study_results.csv")
DB_PATH     = os.path.join(DATA_DIR, "intraday_prices.db")

MAX_CONCURRENT = 8           # simultaneous API calls; keeps rate ≤ ~480 req/min vs 1,000 limit
BASE_URL       = "https://eodhd.com/api/intraday/{ticker}?interval=1m&from={ts_from}&to={ts_to}&api_token={key}&fmt=json"

# ── DB setup ───────────────────────────────────────────────────────────────────

def init_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS intraday_prices (
            ticker      TEXT NOT NULL,
            datetime_et TEXT NOT NULL,
            open        REAL,
            high        REAL,
            low         REAL,
            close       REAL,
            volume      INTEGER,
            PRIMARY KEY (ticker, datetime_et)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ticker_date ON intraday_prices(ticker, substr(datetime_et,1,10))")
    # Tracks (ticker, date) pairs we've already attempted (incl. non-trading days that return [])
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fetch_attempts (
            ticker TEXT NOT NULL,
            date   TEXT NOT NULL,
            PRIMARY KEY (ticker, date)
        )
    """)
    conn.commit()
    return conn


def get_fetched_pairs(conn: sqlite3.Connection) -> set[tuple[str, str]]:
    """Return set of (ticker, date_str) already attempted (with or without data)."""
    rows = conn.execute("SELECT ticker, date FROM fetch_attempts").fetchall()
    return {(r[0], r[1]) for r in rows}


def insert_bars(conn: sqlite3.Connection, ticker: str, date: str, bars: list[dict]) -> int:
    if bars:
        rows = [
            (ticker, b["datetime"], b.get("open"), b.get("high"), b.get("low"), b.get("close"), b.get("volume", 0))
            for b in bars
        ]
        conn.executemany(
            "INSERT OR IGNORE INTO intraday_prices (ticker, datetime_et, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?)",
            rows,
        )
    # Always record the attempt so empty (non-trading) days aren't retried
    conn.execute("INSERT OR IGNORE INTO fetch_attempts (ticker, date) VALUES (?,?)", (ticker, date))
    conn.commit()
    return len(bars)


# ── EODHD ticker format ─────────────────────────────────────────────────────────

def to_eodhd_ticker(etf: str) -> str:
    """Convert ETF symbol to EODHD format. All are US-listed ETFs → .US suffix."""
    return f"{etf}.US"


# ── Async fetch ────────────────────────────────────────────────────────────────

async def fetch_day(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    eodhd_ticker: str,
    date_str: str,      # YYYY-MM-DD
    api_key: str,
) -> tuple[str, str, list[dict]]:
    """
    Fetch all 1-min bars for `eodhd_ticker` on `date_str`.
    Returns (eodhd_ticker, date_str, bars_list).
    """
    # Convert date to UTC epoch range (full 24 hours covers all timezones)
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    ts_from = int(dt.timestamp())
    ts_to   = ts_from + 86400  # +24h

    url = BASE_URL.format(
        ticker=eodhd_ticker,
        ts_from=ts_from,
        ts_to=ts_to,
        key=api_key,
    )

    async with sem:
        await asyncio.sleep(0.12)          # throttle: 8 concurrent × 8.3/s ≈ 500 req/min
        for attempt in range(3):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        if isinstance(data, list):
                            return eodhd_ticker, date_str, data
                        return eodhd_ticker, date_str, []
                    if resp.status == 429:          # rate-limited — back off
                        await asyncio.sleep(5 * (attempt + 1))
                        continue
                    return eodhd_ticker, date_str, []
            except Exception:
                await asyncio.sleep(2)
        return eodhd_ticker, date_str, []


# ── Main ──────────────────────────────────────────────────────────────────────

def build_fetch_tasks(df: pd.DataFrame) -> list[tuple[str, str]]:
    """
    Returns list of (eodhd_ticker, date_str) to fetch.
    Includes: each unique (etf_ticker, day0_date) + SPY on every unique day0_date.
    """
    tasks: set[tuple[str, str]] = set()

    for _, row in df.iterrows():
        date = str(row["day0_date"])
        etf  = str(row["etf_ticker"])
        tasks.add((to_eodhd_ticker(etf), date))
        tasks.add(("SPY.US", date))  # market baseline

    return sorted(tasks)


async def run_fetch(tasks: list[tuple[str, str]], api_key: str, conn: sqlite3.Connection) -> None:
    fetched_pairs = get_fetched_pairs(conn)
    pending = [(t, d) for t, d in tasks if (t, d) not in fetched_pairs]
    print(f"Total tasks: {len(tasks)} | Already fetched: {len(tasks)-len(pending)} | Pending: {len(pending)}")

    if not pending:
        print("All data already fetched. Nothing to do.")
        return

    sem = asyncio.Semaphore(MAX_CONCURRENT)
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT)

    async with aiohttp.ClientSession(connector=connector) as session:
        futs = [fetch_day(session, sem, ticker, date, api_key) for ticker, date in pending]

        with tqdm(total=len(futs), desc="Fetching intraday bars", unit="day") as pbar:
            for coro in asyncio.as_completed(futs):
                ticker, date, bars = await coro
                insert_bars(conn, ticker, date, bars)
                pbar.set_postfix({"last": f"{ticker}@{date}", "bars": len(bars)})
                pbar.update(1)


def main() -> None:
    load_dotenv(os.path.join(REPO_ROOT, ".env"))
    api_key = os.environ.get("EODHD_API_KEY", "")
    if not api_key:
        print("ERROR: EODHD_API_KEY not found in .env")
        sys.exit(1)

    if not os.path.exists(INPUT_PATH):
        print(f"ERROR: {INPUT_PATH} not found. Run 7_event_study.py first.")
        sys.exit(1)

    print(f"Loading {INPUT_PATH} ...")
    df = pd.read_csv(INPUT_PATH, low_memory=False)
    print(f"  {len(df):,} posts, {df['day0_date'].nunique()} unique day0 dates.")

    conn = init_db(DB_PATH)
    tasks = build_fetch_tasks(df)
    print(f"  {len(tasks)} unique (ticker, date) pairs to fetch (includes SPY baseline).")

    asyncio.run(run_fetch(tasks, api_key, conn))

    # Summary
    total = conn.execute("SELECT COUNT(*) FROM intraday_prices").fetchone()[0]
    tickers = conn.execute("SELECT COUNT(DISTINCT ticker) FROM intraday_prices").fetchone()[0]
    dates   = conn.execute("SELECT COUNT(DISTINCT substr(datetime_et,1,10)) FROM intraday_prices").fetchone()[0]
    conn.close()
    print(f"\nDone. intraday_prices: {total:,} bars | {tickers} tickers | {dates} trading days → {DB_PATH}")


if __name__ == "__main__":
    main()
