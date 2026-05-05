"""
1_data_loader.py
----------------
Ingest the Trump Truth Social dataset from Hugging Face, clean it, and save
a filtered parquet file to ml/data/truth_social_clean.parquet.

Run (from repo root, with venv active):
    python ml/1_data_loader.py
"""

import os
import pandas as pd
from datasets import load_dataset

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.join(SCRIPT_DIR, "data")
OUT_PATH   = os.path.join(DATA_DIR, "truth_social_clean.parquet")

os.makedirs(DATA_DIR, exist_ok=True)

# ── 1. Load from Hugging Face ──────────────────────────────────────────────────
print("Loading dataset from Hugging Face (chrissoria/trump-truth-social)...")
ds  = load_dataset("chrissoria/trump-truth-social")
df  = ds["train"].to_pandas()

# ── 2. Inspect columns ─────────────────────────────────────────────────────────
print(f"\nDataset shape: {df.shape}")
print("Columns:")
for col in df.columns:
    sample = df[col].dropna().iloc[0] if not df[col].dropna().empty else "<empty>"
    print(f"  {col:30s}  sample={repr(sample)[:80]}")

# ── 3. Identify text and date columns ─────────────────────────────────────────
# Known column names from the dataset; will fall back gracefully if they differ.
TEXT_COL_CANDIDATES = ["content", "text", "body", "post"]
DATE_COL_CANDIDATES = ["created_at", "date", "timestamp", "published_at", "datetime"]
REPOST_COL_CANDIDATES = ["is_retruth", "repost", "is_repost", "reblog", "retruth",
                         "reblogged_from_id", "quote_id", "in_reply_to_id"]

def pick_col(candidates: list[str], df_cols: list[str]) -> str | None:
    for c in candidates:
        if c in df_cols:
            return c
    return None

text_col   = pick_col(TEXT_COL_CANDIDATES, df.columns.tolist())
date_col   = pick_col(DATE_COL_CANDIDATES, df.columns.tolist())
repost_col = pick_col(REPOST_COL_CANDIDATES, df.columns.tolist())

print(f"\nResolved → text_col={text_col!r}  date_col={date_col!r}  repost_col={repost_col!r}")

if text_col is None or date_col is None:
    raise ValueError(
        "Could not detect text or date column. "
        "Please inspect the column list above and update the candidates."
    )

# ── 4. Parse date → timezone-naive UTC datetime ────────────────────────────────
print("\nParsing dates...")
df[date_col] = pd.to_datetime(df[date_col], utc=True, errors="coerce")
df[date_col] = df[date_col].dt.tz_convert(None)          # strip tz → naive UTC
df = df.dropna(subset=[date_col])

print(f"  Date range (raw): {df[date_col].min()} → {df[date_col].max()}")

# ── 5. Filter to 2022–2025 ─────────────────────────────────────────────────────
mask_date = (df[date_col] >= "2022-01-01") & (df[date_col] < "2026-01-01")
df = df[mask_date].copy()
print(f"  After 2022–2025 filter: {len(df):,} rows")

# ── 6. Filter out re-Truths (reposts) ─────────────────────────────────────────
if repost_col:
    sample_vals = df[repost_col].dropna().unique()[:10]
    print(f"  Repost col '{repost_col}' sample values: {sample_vals}")

    # Boolean-style columns (True/False, 1/0)
    if df[repost_col].dtype == bool or set(df[repost_col].dropna().unique()).issubset({0, 1, True, False}):
        df = df[df[repost_col] == False].copy()   # noqa: E712
    # String-style or nullable columns with an id (non-null = repost)
    elif df[repost_col].dtype == object:
        df = df[df[repost_col].isna() | (df[repost_col].str.strip() == "")].copy()
    else:
        # Numeric id: non-null / non-zero = repost
        df = df[df[repost_col].isna() | (df[repost_col] == 0)].copy()

    print(f"  After repost filter:    {len(df):,} rows (original posts only)")
else:
    # Fall back to text-based RT detection (Truth Social reposts start with "RT @")
    before = len(df)
    df = df[~df["text"].str.startswith("RT @", na=False)].copy()
    print(f"  No repost column — removed {before - len(df):,} 'RT @' rows via text filter.")

# ── 7. Normalise key columns ───────────────────────────────────────────────────
df = df.rename(columns={text_col: "text", date_col: "created_at"})
df = df.sort_values("created_at").reset_index(drop=True)

# Drop rows with empty text
df = df[df["text"].notna() & (df["text"].str.strip() != "")]
print(f"  After empty-text drop:  {len(df):,} rows")

# ── 8. Save ────────────────────────────────────────────────────────────────────
df.to_parquet(OUT_PATH, index=False)
print(f"\nSaved cleaned DataFrame → {OUT_PATH}")
print(f"Final shape: {df.shape}")
print("\nColumn summary:")
print(df.dtypes)
print("\nSample posts:")
print(df[["created_at", "text"]].head(5).to_string(index=False))
