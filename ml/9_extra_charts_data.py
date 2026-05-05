"""
Appends scatter_data and slopegraph_data to frontend/public/trajectory_data.json.
Reads ml/data/intraday_event_study_results.csv (no re-running the slow intraday loop).
"""

import json
import pathlib
import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).parent.parent
CSV  = ROOT / "ml" / "data" / "intraday_event_study_results.csv"
JSON = ROOT / "frontend" / "public" / "trajectory_data.json"

# ── Load ──────────────────────────────────────────────────────────────────────
df = pd.read_csv(CSV, low_memory=False)
df = df.dropna(subset=["AR_10", "AR_60", "tw_sentiment"])

# Convert raw decimal → basis points
df["ar10_bps"] = df["AR_10"] * 10_000
df["ar60_bps"] = df["AR_60"] * 10_000

SENTIMENTS = ["negative", "neutral", "positive"]

# ── 1. Slopegraph data ────────────────────────────────────────────────────────
slopegraph = {}
for s in SENTIMENTS:
    grp = df[df["tw_sentiment"] == s]
    slopegraph[s] = {
        "ar10": round(float(grp["ar10_bps"].mean()), 4),
        "ar60": round(float(grp["ar60_bps"].mean()), 4),
        "n":    int(len(grp)),
    }
print("Slopegraph means:")
for s, v in slopegraph.items():
    print(f"  {s}: AR10={v['ar10']:+.2f} bps  AR60={v['ar60']:+.2f} bps  n={v['n']}")

# ── 2. Scatter data ───────────────────────────────────────────────────────────
# Clip to ±300 bps — keeps the main cluster readable, drops extreme outliers.
CLIP = 300
scatter_raw: dict[str, list] = {s: [] for s in SENTIMENTS}
for s in SENTIMENTS:
    grp = df[df["tw_sentiment"] == s].copy()
    grp = grp[
        (grp["ar10_bps"].abs() <= CLIP) &
        (grp["ar60_bps"].abs() <= CLIP)
    ]
    # If still > 800 pts in a group, random-sample 800 for rendering perf
    if len(grp) > 800:
        grp = grp.sample(800, random_state=42)
    scatter_raw[s] = [
        [round(float(r["ar10_bps"]), 2), round(float(r["ar60_bps"]), 2)]
        for _, r in grp.iterrows()
    ]
    print(f"  scatter {s}: {len(scatter_raw[s])} pts (after clip ±{CLIP} bps)")

# Pearson r over all posts (clipped range)
all_clipped = df[
    (df["ar10_bps"].abs() <= CLIP) &
    (df["ar60_bps"].abs() <= CLIP)
]
pearson_r = float(np.corrcoef(all_clipped["ar10_bps"], all_clipped["ar60_bps"])[0, 1])
print(f"  Pearson r (clipped): {pearson_r:.4f}")

# Linear regression trendline (over clipped data)
x = all_clipped["ar10_bps"].values
y = all_clipped["ar60_bps"].values
coeffs = np.polyfit(x, y, 1)
m, b = float(coeffs[0]), float(coeffs[1])
print(f"  Regression: slope={m:.4f}  intercept={b:.4f}")

scatter_data = {
    "clip_bps":  CLIP,
    "pearson_r": round(pearson_r, 4),
    "reg_slope": round(m, 4),
    "reg_intercept": round(b, 4),
    "points": scatter_raw,
}

# ── 3. Append to JSON ─────────────────────────────────────────────────────────
with open(JSON) as f:
    traj = json.load(f)

traj["slopegraph_data"] = slopegraph
traj["scatter_data"]    = scatter_data

with open(JSON, "w") as f:
    json.dump(traj, f, separators=(",", ":"))

print(f"\nWrote {JSON}  ({JSON.stat().st_size // 1024} KB)")
