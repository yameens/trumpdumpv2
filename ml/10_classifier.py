"""
Train an XGBoost classifier to predict whether a Trump post will push its
target sector up, down, or flat vs SPY at T+60 min.

Features (all available at post-time, zero look-ahead):
  tw_sentiment  · target_sector  · market_period  · hour  · day_of_week

Label: binarize AR_60 (in bps)
  "up"   → > +5 bps
  "down" → < -5 bps
  "flat" → else

Outputs: frontend/public/classifier_data.json
"""

import json
import pathlib

import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier

ROOT = pathlib.Path(__file__).parent.parent
CSV  = ROOT / "ml" / "data" / "intraday_event_study_results.csv"
OUT  = ROOT / "frontend" / "public" / "classifier_data.json"

# ── Load & clean ──────────────────────────────────────────────────────────────
df = pd.read_csv(CSV, low_memory=False)
df = df.dropna(subset=["AR_60", "tw_sentiment", "target_sector", "market_period",
                        "time_eastern", "created_at"])

# ── Label ─────────────────────────────────────────────────────────────────────
THRESHOLD = 5   # bps
ar60_bps  = df["AR_60"] * 10_000

def make_label(bps: float) -> str:
    if bps > THRESHOLD:  return "up"
    if bps < -THRESHOLD: return "down"
    return "flat"

df["label"] = ar60_bps.map(make_label)
print("Label distribution:\n", df["label"].value_counts())

# ── Features ──────────────────────────────────────────────────────────────────
df["hour"]        = pd.to_datetime(df["time_eastern"], format="%H:%M:%S", errors="coerce").dt.hour
df["day_of_week"] = pd.to_datetime(df["created_at"],  errors="coerce").dt.dayofweek

feature_cols = ["tw_sentiment", "target_sector", "market_period", "hour", "day_of_week"]
df = df.dropna(subset=feature_cols + ["label"])

encoders: dict[str, LabelEncoder] = {}
X = df[feature_cols].copy()
for col in ["tw_sentiment", "target_sector", "market_period"]:
    le = LabelEncoder()
    X[col] = le.fit_transform(X[col].astype(str))
    encoders[col] = le

X = X.astype(float).values
le_label = LabelEncoder()
y = le_label.fit_transform(df["label"].values)
classes = list(le_label.classes_)   # alphabetical: ['down', 'flat', 'up']

print(f"\nTraining on {len(y)} samples · {len(feature_cols)} features · {len(classes)} classes")

# ── Model ─────────────────────────────────────────────────────────────────────
model = XGBClassifier(
    n_estimators=400,
    max_depth=4,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    use_label_encoder=False,
    eval_metric="mlogloss",
    random_state=42,
    verbosity=0,
)

# ── Cross-validation ──────────────────────────────────────────────────────────
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
cv_scores = cross_val_score(model, X, y, cv=cv, scoring="accuracy")
print(f"\n5-fold CV accuracy: {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")

# ── Final fit on full data ────────────────────────────────────────────────────
model.fit(X, y)
y_pred = model.predict(X)

acc      = float((y_pred == y).mean())
baseline = float(pd.Series(y).value_counts(normalize=True).max())
print(f"Train accuracy: {acc:.4f}   Baseline (majority class): {baseline:.4f}")

# ── Per-class metrics ─────────────────────────────────────────────────────────
report = classification_report(y, y_pred, target_names=classes, output_dict=True)
per_class: dict[str, dict] = {}
for c in classes:
    per_class[c] = {
        "precision": round(report[c]["precision"], 4),
        "recall":    round(report[c]["recall"],    4),
        "f1":        round(report[c]["f1-score"],  4),
        "support":   int(report[c]["support"]),
    }
print("\nPer-class metrics:")
for c, v in per_class.items():
    print(f"  {c:6s}  P={v['precision']:.2f}  R={v['recall']:.2f}  F1={v['f1']:.2f}  n={v['support']}")

# ── Confusion matrix ──────────────────────────────────────────────────────────
cm = confusion_matrix(y, y_pred).tolist()

# ── Feature importances ───────────────────────────────────────────────────────
importances = model.feature_importances_
feat_imp: dict[str, float] = {
    col: round(float(importances[i]), 4)
    for i, col in enumerate(feature_cols)
}
# Sort descending
feat_imp = dict(sorted(feat_imp.items(), key=lambda x: x[1], reverse=True))
print("\nFeature importances:", feat_imp)

# ── Write JSON ────────────────────────────────────────────────────────────────
result = {
    "n_samples":        len(y),
    "threshold_bps":    THRESHOLD,
    "accuracy":         round(acc, 4),
    "baseline_accuracy": round(baseline, 4),
    "cv_mean":          round(float(cv_scores.mean()), 4),
    "cv_std":           round(float(cv_scores.std()),  4),
    "classes":          classes,
    "per_class":        per_class,
    "confusion_matrix": cm,
    "feature_importance": feat_imp,
}

with open(OUT, "w") as f:
    json.dump(result, f, indent=2)

print(f"\nWrote {OUT}")
