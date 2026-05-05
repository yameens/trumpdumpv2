"""
3_sentiment_engine.py
---------------------
Run ProsusAI/finbert locally on the financially relevant Truth Social posts
and append sentiment labels + probability scores.

Run (from repo root, with venv active):
    python ml/3_sentiment_engine.py

Requires: ml/data/relevant_posts.csv (output of 2_relevance_filter.py)
Output:   ml/data/sentiment_results.csv
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
INPUT_PATH  = os.path.join(DATA_DIR, "keyword_relevant_posts.csv")
OUTPUT_PATH = os.path.join(DATA_DIR, "sentiment_results.csv")

MODEL_NAME  = "ProsusAI/finbert"
BATCH_SIZE  = 16   # safe for 8 GB RAM; MPS suffers memory pressure at 32+
MAX_LENGTH  = 512  # FinBERT hard limit

# ── Device selection ───────────────────────────────────────────────────────────

def get_device() -> torch.device:
    # MPS shows severe memory-pressure throttling on FinBERT; force CPU for
    # consistent throughput unless explicitly opted in via USE_MPS=1.
    if os.environ.get("USE_MPS") == "1" and torch.backends.mps.is_available():
        print("Device: Apple MPS (Metal GPU) [USE_MPS=1]")
        return torch.device("mps")
    if torch.cuda.is_available():
        print("Device: CUDA GPU")
        return torch.device("cuda")
    print("Device: CPU")
    return torch.device("cpu")

# ── Model loader ───────────────────────────────────────────────────────────────

def load_model(device: torch.device):
    print(f"Loading {MODEL_NAME} ...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model     = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
    model.eval()
    model.to(device)
    print(f"Model loaded. Labels: {model.config.id2label}")
    return tokenizer, model

# ── Inference ──────────────────────────────────────────────────────────────────

def run_sentiment(
    texts: list[str],
    tokenizer,
    model,
    device: torch.device,
) -> pd.DataFrame:
    """
    Returns a DataFrame with columns:
        sentiment, score_positive, score_negative, score_neutral
    in the same order as `texts`.
    """
    # Build label→index lookup from model config (order is not always pos/neg/neu)
    id2label: dict[int, str] = model.config.id2label
    label2id: dict[str, int] = {v.lower(): k for k, v in id2label.items()}

    all_labels:     list[str]   = []
    all_pos:        list[float] = []
    all_neg:        list[float] = []
    all_neu:        list[float] = []

    n_batches = (len(texts) + BATCH_SIZE - 1) // BATCH_SIZE

    with torch.no_grad():
        for i in tqdm(range(n_batches), desc="FinBERT", unit="batch"):
            batch_texts = texts[i * BATCH_SIZE : (i + 1) * BATCH_SIZE]

            encoding = tokenizer(
                batch_texts,
                padding=True,
                truncation=True,
                max_length=MAX_LENGTH,
                return_tensors="pt",
            )
            encoding = {k: v.to(device) for k, v in encoding.items()}

            logits = model(**encoding).logits            # (batch, 3)
            probs  = torch.softmax(logits, dim=-1).cpu() # move back to CPU

            for row in probs:
                pos = float(row[label2id["positive"]])
                neg = float(row[label2id["negative"]])
                neu = float(row[label2id["neutral"]])

                # Pick label by highest probability
                scores = {"positive": pos, "negative": neg, "neutral": neu}
                label  = max(scores, key=lambda k: scores[k])

                all_labels.append(label)
                all_pos.append(round(pos, 6))
                all_neg.append(round(neg, 6))
                all_neu.append(round(neu, 6))

    return pd.DataFrame({
        "sentiment":     all_labels,
        "score_positive": all_pos,
        "score_negative": all_neg,
        "score_neutral":  all_neu,
    })

# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    if not os.path.exists(INPUT_PATH):
        print(f"ERROR: {INPUT_PATH} not found.")
        print("Run 2_relevance_filter.py first to produce relevant_posts.csv.")
        sys.exit(1)

    print(f"Loading {INPUT_PATH} ...")
    df = pd.read_csv(INPUT_PATH, low_memory=False)
    print(f"  {len(df):,} relevant posts loaded.")

    # Ensure text column exists and clean nulls
    if "text" not in df.columns:
        print("ERROR: 'text' column not found in CSV.")
        sys.exit(1)

    df["text"] = df["text"].fillna("").astype(str)
    texts = df["text"].tolist()

    device            = get_device()
    tokenizer, model  = load_model(device)

    print(f"\nRunning FinBERT on {len(texts):,} posts (batch_size={BATCH_SIZE}) ...")
    sentiment_df = run_sentiment(texts, tokenizer, model, device)

    # Merge back into original DataFrame
    df = pd.concat([df.reset_index(drop=True), sentiment_df], axis=1)

    df.to_csv(OUTPUT_PATH, index=False)
    print(f"\nSaved {len(df):,} rows → {OUTPUT_PATH}")

    # Summary
    counts = df["sentiment"].value_counts()
    print("\nSentiment distribution:")
    for label, count in counts.items():
        print(f"  {label:10s}  {count:>6,}  ({count/len(df)*100:.1f}%)")


if __name__ == "__main__":
    main()
