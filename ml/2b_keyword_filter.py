"""
2b_keyword_filter.py
--------------------
Zero-cost, instant keyword/regex relevance classifier.
Runs on all 19,975 posts in ~1 second, then compares accuracy
against whatever GPT labels exist in relevance_cache.jsonl.

Run (from repo root, with venv active):
    python ml/2b_keyword_filter.py

Output: ml/data/keyword_relevant_posts.csv
        Console accuracy report vs GPT labels
"""

import json
import os
import re

import pandas as pd

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
DATA_DIR     = os.path.join(SCRIPT_DIR, "data")
INPUT_PATH   = os.path.join(DATA_DIR, "truth_social_clean.parquet")
GPT_CACHE    = os.path.join(DATA_DIR, "relevance_cache.jsonl")
OUTPUT_PATH  = os.path.join(DATA_DIR, "keyword_relevant_posts.csv")

# ── Tier 1: Strong signals — any single match → True ──────────────────────────
# Each entry is a regex pattern (case-insensitive).
TIER1_PATTERNS: list[str] = [
    # Macro / economic data
    r"\binflation\b",
    r"\bcpi\b",
    r"\bgdp\b",
    r"\bunemployment\b",
    r"\binterest rate\b",
    r"\bfederal reserve\b",
    r"\bfed rate\b",
    r"\brate hike\b",
    r"\brate cut\b",
    r"\brecession\b",
    r"\bstagflation\b",
    r"\bdeflation\b",
    r"\beconomy\b",
    r"\beconomic\b",
    r"\bjobs\b",
    r"\bjob market\b",
    r"\blabor market\b",
    r"\bwages?\b",
    r"\bpayroll\b",

    # Trade & tariffs
    r"\btariff",
    r"\btrade war\b",
    r"\btrade deal\b",
    r"\btrade policy\b",
    r"\btrade deficit\b",
    r"\bsanction",
    r"\busmca\b",
    r"\bimport",
    r"\bexport",
    r"\bsupply chain\b",
    r"\bmanufacturing\b",

    # Fiscal / government spending
    r"\bdebt ceiling\b",
    r"\bdeficit\b",
    r"\bnational debt\b",
    r"\bspending bill\b",
    r"\bomnibus\b",
    r"\binfrastructure\b",
    r"\bstimulus\b",
    r"\bbailout\b",
    r"\bsubsid",
    r"\bfederal budget\b",
    r"\btrillions? of dollars\b",
    r"\bbillions? of dollars\b",

    # Tax
    r"\btax cut\b",
    r"\btax reform\b",
    r"\btax rate\b",
    r"\bcorporate tax\b",
    r"\btax bill\b",
    r"\btax plan\b",
    r"\btax[- ]and[- ]spend\b",

    # Regulation / deregulation
    r"\bderegulation\b",
    r"\bregulat(ion|ory|ed)\b",
    r"\bepa\b",
    r"\bfda\b",
    r"\bantitrust\b",
    r"\bsec \b",          # Securities & Exchange Commission context

    # Energy
    r"\boil\b",
    r"\bgas price",
    r"\bnatural gas\b",
    r"\bopec\b",
    r"\bpipeline\b",
    r"\bdrilling\b",
    r"\blng\b",
    r"\bcrude\b",
    r"\bfossil fuel\b",
    r"\bgreen energy\b",
    r"\brenewable energy\b",
    r"\bsolar\b",
    r"\bwind energy\b",
    r"\bnuclear (weapon|threat|deal|war|power|plant|energy|reactor)\b",
    r"\bgas station\b",
    r"\bfuel\b",
    r"\benergy (cost|price|sector|independen)",

    # Markets & finance
    r"\bstock market\b",
    r"\bwall street\b",
    r"\bdow jones\b",
    r"\b(the )?dow\b",
    r"\bs&p\b",
    r"\bnasdaq\b",
    r"\bmarket crash\b",
    r"\bbull market\b",
    r"\bbear market\b",
    r"\bcrypto\b",
    r"\bbitcoin\b",
    r"\bdollar (value|index|strength|weakness)\b",
    r"\bcurrency\b",
    r"\bmortgage\b",
    r"\bhousing market\b",
    r"\bforeclosur\b",
    r"\b(central |investment |commercial |regional )?bank(ing|s|er|ers)?\b",
    r"\bfinancial (market|crisis|sector|system|service|regulat|fraud|collapse)\b",
    r"\bhedge fund\b",
    r"\bprivate equity\b",
    r"\bipo\b",

    # Named companies (major market movers)
    r"\bamazon\b",
    r"\bapple (inc|stock|shares|company)\b",
    r"\btesla\b",
    r"\btwitter\b",
    r"\bfacebook\b",
    r"\bmeta (platform|stock|shares)\b",
    r"\bgoogle\b",
    r"\bmicrosoft\b",
    r"\bboeing\b",
    r"\bexxon\b",
    r"\bchevron\b",
    r"\bpfizer\b",
    r"\bmoderna\b",
    r"\blockhead martin\b",
    r"\braytheon\b",
    r"\bwalmart\b",
    r"\bblackrock\b",
    r"\bjpmorgan\b",
    r"\bgoldman sachs\b",
    r"\belon musk\b",       # market-moving statements

    # Industries / sectors
    r"\bpharma(ceutical)?\b",
    r"\bsemiconductor\b",
    r"\bchip (shortage|maker|industry|manufacturer)\b",
    r"\btech (sector|company|stock|industry)\b",
    r"\bdefense (contractor|spending|budget|sector)\b",
    r"\bhealth(care| care)\b",
    r"\bdrug price\b",
    r"\bmedicare\b",
    r"\bmedicaid\b",
    r"\binsurance\b",
    r"\breal estate\b",
    r"\bagriculture\b",
    r"\bfarmer\b",
    r"\bsteel\b",
    r"\baluminum\b",
    r"\bauto(motive)? (industry|maker|sector)\b",
    r"\bairline\b",

    # Financial satisfaction / economic polling
    r"\bfinancially\b",
    r"\beconomically\b",

    # Geopolitics that move markets
    r"\bchina\b",
    r"\bchinese (government|economy|military|company)\b",
    r"\bbeijing\b",
    r"\bxi jinping\b",
    r"\btaiwan\b",
    r"\bnato\b",
    r"\bukraine\b",
    r"\brussia\b",
    r"\bputin\b",
    r"\biran\b",
    r"\bsaudi arabia\b",
    r"\bnorth korea\b",
    r"\bkim jong\b",
    r"\bsouth korea\b",
    r"\bmiddle east\b",
    r"\bworld war\b",
    r"\bnuclear (weapon|threat|deal|war)\b",

    # Drug / opioid (pharma/regulatory angle)
    r"\boverdose\b",
    r"\bfentanyl\b",
    r"\bopioid\b",
    r"\bdrug (death|epidemic|crisis|cartels?)\b",

    # Social media / tech regulation
    r"\bfbi paid\b",
    r"\bcensor(ship|ed)?\b",
    r"\bsection 230\b",
    r"\bsocial media (compan|regulat|law)\b",
]

# ── Tier 2: Compound signals — needs BOTH parts to match ──────────────────────
# Each entry is a tuple: (pattern_A, pattern_B) — both must match → True.
TIER2_PAIRS: list[tuple[str, str]] = [
    (r"\bbiden\b",      r"\b(economy|spending|energy|oil|jobs|tax|regulation|inflation|deficit|debt|trade)\b"),
    (r"\btrump\b",      r"\b(economy|tariff|tax|trade|energy|spending|regulation|stock|market|oil|china)\b"),
    (r"\bcongress\b",   r"\b(bill|spending|debt|tax|budget|deficit|legislation|trillion)\b"),
    (r"\brepublican\b", r"\b(tax|spending|budget|bill|cut|deregulat|fiscal|economic)\b"),
    (r"\bdemocrat\b",   r"\b(tax|spending|budget|bill|regulat|economic|fiscal|stimulus)\b"),
    (r"\bwhite house\b",r"\b(econom|tax|trade|tariff|spending|budget|regulation|energy|oil)\b"),
    (r"\belection\b",   r"\b(econom|market|stock|investor|business|tax|trade|policy)\b"),
]

# ── URL-only detection ─────────────────────────────────────────────────────────
# Posts that are just a URL (with optional RT prefix) get special treatment:
# we extract domain keywords from the URL path to catch financial articles.
URL_ONLY_RE  = re.compile(r"^(rt:?\s*)?(https?://\S+\s*)+$", re.IGNORECASE)

# Financial/economic domains — URL-only posts from these are marked relevant
FINANCIAL_URL_DOMAINS = re.compile(
    r"(foxbusiness|bloomberg|wsj\.com|ft\.com|marketwatch|cnbc|reuters|"
    r"yahoo\.com/finance|finance\.yahoo|investopedia|barrons|thestreet|"
    r"zerohedge|seekingalpha|morningstar|fool\.com|kiplinger|"
    r"inflation|tariff|trade|energy|oil|gas|economy|economic|gdp|"
    r"jobs|unemployment|cpi|federal.reserve|interest.rate|tax|deficit|"
    r"spending|budget|stock|market|crypto|bitcoin|bank|mortgage|housing|"
    r"east.palestine|train.derailment|inflation.reduction|"
    r"drug.price|healthcare|medicare|medicaid|pharma|"
    r"china.trade|sanctions|usmca|supply.chain|"
    r"financial(ly)?[-_.]satisfy|financially.satisfied|"
    r"iran.protest|north.korea|kim.jong|south.korea|"
    r"border.economic|biden.economic|trump.economic|"
    r"regulation|deregulat|manufacturing|labor|workers|"
    r"approval.rating|poll.*economy|economy.*poll)",
    re.IGNORECASE,
)

# ── Precompile all patterns ────────────────────────────────────────────────────
_T1 = [re.compile(p, re.IGNORECASE) for p in TIER1_PATTERNS]
_T2 = [(re.compile(a, re.IGNORECASE), re.compile(b, re.IGNORECASE)) for a, b in TIER2_PAIRS]


def is_relevant(text: str) -> bool:
    if not text:
        return False
    stripped = text.strip()
    # URL-only post: check if the URL path/domain contains financial signals
    if URL_ONLY_RE.match(stripped):
        return bool(FINANCIAL_URL_DOMAINS.search(stripped))
    for pat in _T1:
        if pat.search(text):
            return True
    for pat_a, pat_b in _T2:
        if pat_a.search(text) and pat_b.search(text):
            return True
    return False


# ── Accuracy helpers ───────────────────────────────────────────────────────────

def accuracy_report(df_overlap: pd.DataFrame) -> None:
    """Print precision, recall, F1 and confusion matrix vs GPT labels."""
    gpt  = df_overlap["gpt_relevant"].astype(bool)
    kw   = df_overlap["kw_relevant"].astype(bool)

    tp = int((kw  &  gpt).sum())
    fp = int((kw  & ~gpt).sum())
    fn = int((~kw &  gpt).sum())
    tn = int((~kw & ~gpt).sum())

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall    = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1        = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    print("\n=== Accuracy vs GPT labels ===")
    print(f"  GPT-labeled rows used: {len(df_overlap):,}")
    print(f"  Confusion matrix:  TP={tp}  FP={fp}  FN={fn}  TN={tn}")
    print(f"  Precision: {precision:.3f}  (of kw=True, how many GPT agrees)")
    print(f"  Recall:    {recall:.3f}  (of GPT=True, how many kw caught)")
    print(f"  F1:        {f1:.3f}")

    # False positives: keyword said True, GPT said False
    fps = df_overlap[kw & ~gpt]["text"].sample(min(8, int((kw & ~gpt).sum())), random_state=7)
    print(f"\n--- False Positives (kw=True, GPT=False) [{int((kw & ~gpt).sum())} total] ---")
    for t in fps:
        print(f"  {str(t)[:160]}")

    # False negatives: keyword said False, GPT said True
    fns = df_overlap[~kw & gpt]["text"].sample(min(8, int((~kw & gpt).sum())), random_state=8)
    print(f"\n--- False Negatives (kw=False, GPT=True) [{int((~kw & gpt).sum())} total] ---")
    for t in fns:
        print(f"  {str(t)[:160]}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"Loading {INPUT_PATH} ...")
    df = pd.read_parquet(INPUT_PATH)
    print(f"  {len(df):,} posts")

    # Apply keyword filter
    print("Running keyword filter ...")
    df["kw_relevant"] = df["text"].fillna("").apply(is_relevant)
    n_kw = int(df["kw_relevant"].sum())
    print(f"  Keyword relevant: {n_kw:,} / {len(df):,}  ({n_kw/len(df)*100:.1f}%)")

    # Load GPT cache for comparison
    gpt_cache: dict[int, bool] = {}
    if os.path.exists(GPT_CACHE):
        with open(GPT_CACHE) as f:
            for line in f:
                line = line.strip()
                if line:
                    e = json.loads(line)
                    gpt_cache[int(e["id"])] = bool(e["is_relevant"])
        print(f"\nGPT cache loaded: {len(gpt_cache):,} labeled rows")

        df["gpt_relevant"] = df.index.map(gpt_cache.get)
        overlap = df[df["gpt_relevant"].notna()].copy()
        gpt_pos = int(overlap["gpt_relevant"].sum())
        print(f"  GPT relevant in overlap: {gpt_pos:,} / {len(overlap):,}  ({gpt_pos/len(overlap)*100:.1f}%)")

        accuracy_report(overlap)
    else:
        print("\nNo GPT cache found — skipping accuracy comparison.")

    # Save keyword-filtered CSV
    out = df[df["kw_relevant"]].copy()
    out.to_csv(OUTPUT_PATH, index=False)
    print(f"\nSaved {len(out):,} keyword-relevant posts → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
