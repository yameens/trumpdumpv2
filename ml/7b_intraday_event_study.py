"""
7b_intraday_event_study.py
--------------------------
Compute intraday Abnormal Returns (AR) for each Trump Truth Social post using
1-minute bars fetched into intraday_prices.db by 6b_intraday_data.py.

Two event windows (measured from the effective event time):
  AR_10 : price change over +10 minutes  vs. SPY (market proxy)
  AR_60 : price change over +60 minutes  vs. SPY (market proxy)

Timing rules by market_period:
  during_market → effective event time = exact post time in ET
  before_market → effective event time = 09:30:00 ET on day0_date
  after_market  → effective event time = 09:30:00 ET on day0_date
                   (day0_date is already adjusted to next trading day by 7_event_study.py)

All datetimes in the DB are UTC (EODHD reports gmtoffset=0).

Input:   ml/data/event_study_results.csv
         ml/data/intraday_prices.db
Output:  ml/data/intraday_event_study_results.csv
"""

import os
import sqlite3
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd
from tqdm import tqdm

# ── Config ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
DATA_DIR     = os.path.join(SCRIPT_DIR, "data")
POSTS_PATH   = os.path.join(DATA_DIR, "event_study_results.csv")
DB_PATH      = os.path.join(DATA_DIR, "intraday_prices.db")
OUT_PATH     = os.path.join(DATA_DIR, "intraday_event_study_results.csv")

MARKET_OPEN  = "09:30:00"   # ET — effective event time for pre/post-market posts
WINDOW_10    = 10           # minutes
WINDOW_60    = 60           # minutes
ET           = ZoneInfo("America/New_York")
UTC          = ZoneInfo("UTC")

EODHD_SUFFIX = ".US"       # SPY → SPY.US in DB
MARKET_PROXY = "SPY.US"    # baseline for all posts (SPY tracks S&P 500 intraday)


# ── DB helpers ─────────────────────────────────────────────────────────────────

_bars_cache: dict[tuple[str, str], pd.DataFrame] = {}

def load_ticker_bars(conn: sqlite3.Connection, ticker: str, date_str: str) -> pd.DataFrame:
    """Load all 1-min bars for ticker on date_str (UTC date), returning UTC datetimes.
    Results are cached in memory to avoid redundant SQLite reads."""
    key = (ticker, date_str)
    if key in _bars_cache:
        return _bars_cache[key]
    rows = conn.execute(
        "SELECT datetime_et, close FROM intraday_prices WHERE ticker=? AND substr(datetime_et,1,10)=? ORDER BY datetime_et",
        (ticker, date_str),
    ).fetchall()
    if not rows:
        result = pd.DataFrame(columns=["dt_utc", "close"])
    else:
        df = pd.DataFrame(rows, columns=["dt_utc", "close"])
        df["dt_utc"] = pd.to_datetime(df["dt_utc"], utc=True)
        result = df
    _bars_cache[key] = result
    return result


def price_at_or_before(bars: pd.DataFrame, target_utc: datetime) -> float | None:
    """Return close price of last bar at or before target_utc. None if no such bar."""
    subset = bars[bars["dt_utc"] <= pd.Timestamp(target_utc)]
    if subset.empty:
        return None
    return float(subset.iloc[-1]["close"])


def price_at_or_after(bars: pd.DataFrame, target_utc: datetime) -> float | None:
    """Return close price of first bar at or after target_utc. None if no such bar."""
    subset = bars[bars["dt_utc"] >= pd.Timestamp(target_utc)]
    if subset.empty:
        return None
    return float(subset.iloc[0]["close"])


# ── Event time logic ───────────────────────────────────────────────────────────

def effective_event_utc(market_period: str, day0_date: str, time_eastern: str) -> datetime:
    """
    Return the effective event moment as a UTC-aware datetime.

    during_market → use actual post time in ET
    before_market / after_market → snap to market open (09:30 ET) on day0_date
    """
    d = date.fromisoformat(day0_date)

    if market_period == "during_market":
        hms = time_eastern  # "HH:MM:SS"
    else:
        hms = MARKET_OPEN

    h, m, s = (int(x) for x in hms.split(":"))
    et_dt = datetime(d.year, d.month, d.day, h, m, s, tzinfo=ET)
    return et_dt.astimezone(UTC)


# ── AR computation ─────────────────────────────────────────────────────────────

def compute_ar(
    etf_bars: pd.DataFrame,
    spy_bars: pd.DataFrame,
    event_utc: datetime,
    window_min: int,
) -> float | None:
    """
    Compute AR = etf_return - spy_return over [event_utc-1min, event_utc+window_min].
    Returns None if any price is unavailable.
    """
    baseline_utc = event_utc - timedelta(minutes=1)
    reaction_utc = event_utc + timedelta(minutes=window_min)

    etf_base = price_at_or_before(etf_bars, baseline_utc)
    etf_rxn  = price_at_or_after(etf_bars, reaction_utc)
    spy_base = price_at_or_before(spy_bars, baseline_utc)
    spy_rxn  = price_at_or_after(spy_bars, reaction_utc)

    if any(p is None or p == 0 for p in [etf_base, etf_rxn, spy_base, spy_rxn]):
        return None

    etf_ret = (etf_rxn - etf_base) / etf_base
    spy_ret = (spy_rxn - spy_base) / spy_base
    return etf_ret - spy_ret


# ── Main ──────────────────────────────────────────────────────────────────────

def print_summary(df: pd.DataFrame) -> None:
    print("\n" + "=" * 68)
    print("INTRADAY EVENT STUDY — SUMMARY (mean AR, basis points)")
    print("=" * 68)

    df_valid = df.dropna(subset=["AR_10", "AR_60"])
    print(f"Posts with complete intraday data: {len(df_valid):,} / {len(df):,}")

    for label, col in [("AR_10 (+10 min)", "AR_10"), ("AR_60 (+60 min)", "AR_60")]:
        print(f"\n── {label} ─────────────────────────────────────────────────")
        grp = (
            df_valid.groupby(["tw_sentiment", "target_sector"])[col]
            .agg(["mean", "count"])
            .reset_index()
        )
        grp["mean_bps"] = grp["mean"] * 10_000
        grp = grp.sort_values(["tw_sentiment", "mean_bps"])

        prev_sent = None
        for _, row in grp.iterrows():
            if row["tw_sentiment"] != prev_sent:
                print(f"\n  [{row['tw_sentiment'].upper()}]")
                prev_sent = row["tw_sentiment"]
            bar_dir = "▲" if row["mean_bps"] > 0 else "▼"
            print(f"    {row['target_sector']:<30} {bar_dir} {row['mean_bps']:+7.2f} bps  (n={int(row['count'])})")

    print("\n── Overall by sentiment ────────────────────────────────────────")
    overall = df_valid.groupby("tw_sentiment")[["AR_10", "AR_60"]].mean() * 10_000
    print(overall.rename(columns={"AR_10": "AR_10 (bps)", "AR_60": "AR_60 (bps)"}).to_string())
    print("=" * 68)


def main() -> None:
    print(f"Loading posts from {POSTS_PATH} ...")
    posts = pd.read_csv(POSTS_PATH, low_memory=False)
    print(f"  {len(posts):,} posts")

    conn = sqlite3.connect(DB_PATH)
    total_bars = conn.execute("SELECT COUNT(*) FROM intraday_prices").fetchone()[0]
    print(f"  DB: {total_bars:,} intraday bars")

    results: list[dict] = []

    for _, row in tqdm(posts.iterrows(), total=len(posts), desc="Computing ARs", unit="post"):
        etf       = str(row["etf_ticker"]) + EODHD_SUFFIX   # e.g. XLE.US
        day0      = str(row["day0_date"])
        mkt_per   = str(row["market_period"])
        time_et   = str(row["time_eastern"])

        event_utc = effective_event_utc(mkt_per, day0, time_et)

        # The DB stores UTC datetimes; the UTC date of the event matches day0_date
        # for during_market and before_market. For after_market (snapped to 09:30 ET
        # on day0), the UTC date is also day0_date (09:30 ET = 13:30 UTC, same date).
        db_date = day0   # UTC date == ET date for all cases given snapping to 09:30 ET

        etf_bars = load_ticker_bars(conn, etf, db_date)
        spy_bars = load_ticker_bars(conn, MARKET_PROXY, db_date)

        ar_10 = compute_ar(etf_bars, spy_bars, event_utc, WINDOW_10)
        ar_60 = compute_ar(etf_bars, spy_bars, event_utc, WINDOW_60)

        results.append({
            "post_id":       row.get("post_id"),
            "created_at":    row["created_at"],
            "time_eastern":  time_et,
            "day0_date":     day0,
            "market_period": mkt_per,
            "tw_sentiment":  row.get("tw_sentiment"),
            "target_sector": row.get("target_sector"),
            "etf_ticker":    row["etf_ticker"],
            "event_utc":     event_utc.strftime("%Y-%m-%d %H:%M:%S"),
            "AR_10":         ar_10,
            "AR_60":         ar_60,
            "CAR":           (ar_10 or 0) + (ar_60 or 0) if ar_10 is not None and ar_60 is not None else None,
        })

    conn.close()

    result_df = pd.DataFrame(results)
    result_df.to_csv(OUT_PATH, index=False)
    print(f"\nSaved {len(result_df):,} rows → {OUT_PATH}")

    n_ar10  = result_df["AR_10"].notna().sum()
    n_ar60  = result_df["AR_60"].notna().sum()
    print(f"AR_10 coverage: {n_ar10:,} / {len(result_df):,} posts ({n_ar10/len(result_df)*100:.1f}%)")
    print(f"AR_60 coverage: {n_ar60:,} / {len(result_df):,} posts ({n_ar60/len(result_df)*100:.1f}%)")

    print_summary(result_df)


if __name__ == "__main__":
    main()
