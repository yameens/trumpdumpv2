"""
4_twitter_sentiment.py
----------------------
Run cardiffnlp/twitter-roberta-base-sentiment-latest on the keyword-filtered
Truth Social posts.  Adds three columns prefixed tw_ alongside existing data.

Input:  ml/data/sentiment_results.csv   (FinBERT output — already has all cols)
        Falls back to keyword_relevant_posts.csv if sentiment_results.csv absent.
Output: ml/data/twitter_sentiment_results.csv

New columns
-----------
tw_sentiment       "positive" / "negative" / "neutral"
tw_score_positive  softmax probability 0-1
tw_score_negative  softmax probability 0-1
tw_score_neutral   softmax probability 0-1
"""

import os
import sys

import pandas as pd
import torch
from tqdm import tqdm
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# ── Config ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
DATA_DIR    = os.path.join(SCRIPT_DIR, "data")

# Prefer the FinBERT output so tw_ cols land right next to finbert cols
INPUT_PATH  = os.path.join(DATA_DIR, "sentiment_results.csv")
FALLBACK    = os.path.join(DATA_DIR, "keyword_relevant_posts.csv")
OUTPUT_PATH = os.path.join(DATA_DIR, "twitter_sentiment_results.csv")

MODEL_NAME  = "cardiffnlp/twitter-roberta-base-sentiment-latest"
BATCH_SIZE  = 32   # RoBERTa-base is ~2× heavier than BERT; 32 is safe on 8 GB
MAX_LENGTH  = 128  # tweets/Truth Social posts are short; 128 >> 95th percentile

# ── Device selection ───────────────────────────────────────────────────────────

def get_device() -> torch.device:
    # MPS throttles badly for transformer inference on this hardware; use CPU.
    # Set USE_MPS=1 to override.
    if os.environ.get("USE_MPS") == "1" and torch.backends.mps.is_available():
        print("Device: Apple MPS [USE_MPS=1]")
        return torch.device("mps")
    if torch.cuda.is_available():
        print("Device: CUDA GPU")
        return torch.device("cuda")
    # Use all available CPU threads for faster inference
    n_threads = os.cpu_count() or 4
    torch.set_num_threads(n_threads)
    print(f"Device: CPU ({n_threads} threads)")
    return torch.device("cpu")

# ── Model loader ───────────────────────────────────────────────────────────────

def load_model(device: torch.device):
    print(f"Loading {MODEL_NAME} ...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model     = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
    model.eval()
    model.to(device)
    print(f"Model loaded.  Labels: {model.config.id2label}")
    return tokenizer, model

# ── Inference ──────────────────────────────────────────────────────────────────

def run_sentiment(
    texts: list[str],
    tokenizer,
    model,
    device: torch.device,
) -> pd.DataFrame:
    id2label: dict[int, str] = {
        k: v.lower() for k, v in model.config.id2label.items()
    }
    label2id: dict[str, int] = {v: k for k, v in id2label.items()}

    all_labels: list[str]   = []
    all_pos:    list[float] = []
    all_neg:    list[float] = []
    all_neu:    list[float] = []

    n_batches = (len(texts) + BATCH_SIZE - 1) // BATCH_SIZE

    with torch.no_grad():
        for i in tqdm(range(n_batches), desc="RoBERTa-Twitter", unit="batch"):
            batch = texts[i * BATCH_SIZE : (i + 1) * BATCH_SIZE]

            enc = tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=MAX_LENGTH,
                return_tensors="pt",
            )
            enc   = {k: v.to(device) for k, v in enc.items()}
            probs = torch.softmax(model(**enc).logits, dim=-1).cpu()

            for row in probs:
                pos = float(row[label2id["positive"]])
                neg = float(row[label2id["negative"]])
                neu = float(row[label2id["neutral"]])

                scores = {"positive": pos, "negative": neg, "neutral": neu}
                label  = max(scores, key=lambda k: scores[k])

                all_labels.append(label)
                all_pos.append(round(pos, 6))
                all_neg.append(round(neg, 6))
                all_neu.append(round(neu, 6))

    return pd.DataFrame({
        "tw_sentiment":     all_labels,
        "tw_score_positive": all_pos,
        "tw_score_negative": all_neg,
        "tw_score_neutral":  all_neu,
    })

# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    src = INPUT_PATH if os.path.exists(INPUT_PATH) else FALLBACK
    if not os.path.exists(src):
        print(f"ERROR: neither {INPUT_PATH} nor {FALLBACK} found.")
        sys.exit(1)

    print(f"Loading {src} ...")
    df = pd.read_csv(src, low_memory=False)
    print(f"  {len(df):,} posts loaded.")

    if "text" not in df.columns:
        print("ERROR: 'text' column not found.")
        sys.exit(1)

    df["text"] = df["text"].fillna("").astype(str)
    texts = df["text"].tolist()

    device           = get_device()
    tokenizer, model = load_model(device)

    print(f"\nRunning RoBERTa-Twitter on {len(texts):,} posts (batch_size={BATCH_SIZE}, max_len={MAX_LENGTH}) ...")
    tw_df = run_sentiment(texts, tokenizer, model, device)

    df = pd.concat([df.reset_index(drop=True), tw_df], axis=1)
    df.to_csv(OUTPUT_PATH, index=False)
    print(f"\nSaved {len(df):,} rows → {OUTPUT_PATH}")

    counts = df["tw_sentiment"].value_counts()
    print("\nSentiment distribution (Twitter RoBERTa):")
    for label, count in counts.items():
        print(f"  {label:10s}  {count:>6,}  ({count/len(df)*100:.1f}%)")

    # Compare against FinBERT if present
    if "sentiment" in df.columns:
        print("\nFinBERT vs Twitter-RoBERTa agreement:")
        agree = (df["sentiment"] == df["tw_sentiment"]).sum()
        print(f"  Agree on same label: {agree:,} / {len(df):,}  ({agree/len(df)*100:.1f}%)")
        print("\nCross-tab (rows=FinBERT, cols=RoBERTa):")
        ct = pd.crosstab(df["sentiment"], df["tw_sentiment"])
        print(ct.to_string())


if __name__ == "__main__":
    main()
