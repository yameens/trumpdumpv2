"""
5_entity_mapper.py
------------------
Map each sentiment-scored relevant Truth Social post to the single most
relevant GICS sector and 3 representative tickers (sector ETF + 2 large-caps).

Logic
-----
1. For each post, count regex keyword hits across 11 GICS sector keyword lists.
2. Pick the sector with the most hits (ties broken alphabetically).
3. Assign that sector's 3 representative tickers (ETF|Large-cap1|Large-cap2).
4. If no sector hits but broad-economy keywords found → "Broad Economy" / SPY.
5. If nothing matches at all → "Broad Economy" / SPY as final fallback.

Input:  ml/data/twitter_sentiment_results.csv
Output: ml/data/final_mapped_results.csv
"""

import os
import re
import sys

import pandas as pd

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
DATA_DIR    = os.path.join(SCRIPT_DIR, "data")
INPUT_PATH  = os.path.join(DATA_DIR, "twitter_sentiment_results.csv")
OUTPUT_PATH = os.path.join(DATA_DIR, "final_mapped_results.csv")

# ── Sector representatives: ETF + 2 large-caps ─────────────────────────────────
SECTOR_REPS: dict[str, list[str]] = {
    "Energy":                   ["XLE", "XOM",  "CVX"],
    "Financials":               ["XLF", "JPM",  "GS"],
    "Health Care":              ["XLV", "JNJ",  "UNH"],
    "Information Technology":   ["QQQ", "AAPL", "NVDA"],
    "Communication Services":   ["XLC", "META", "GOOGL"],
    "Consumer Discretionary":   ["XLY", "AMZN", "TSLA"],
    "Consumer Staples":         ["XLP", "PG",   "KO"],
    "Industrials":              ["XLI", "CAT",  "BA"],
    "Materials":                ["XLB", "FCX",  "NEM"],
    "Real Estate":              ["XLRE","AMT",  "PLD"],
    "Utilities":                ["XLU", "NEE",  "DUK"],
    "Broad Economy":            ["SPY"],
}

# ── Sector keyword lists ────────────────────────────────────────────────────────
# Each phrase is compiled as a whole-word / phrase regex (case-insensitive).
# Order matters within a list only for readability — all hits are counted equally.
SECTOR_KEYWORDS: dict[str, list[str]] = {
    "Energy": [
        r"\boil\b", r"\bgas\b", r"\benergy\b", r"\bcrude\b", r"\bpipeline\b",
        r"\bLNG\b", r"\bcoal\b", r"\bshale\b", r"\bOPEC\b", r"\brefinery\b",
        r"\bpetroleum\b", r"\bdrill(ing)?\b", r"\bfossil fuel\b", r"\bgasoline\b",
        r"\bfuel\b", r"\bnatural gas\b", r"\bwind turbine\b",     # wind turbines often discussed in energy policy
        r"\boffshore\b", r"\bfrack(ing)?\b", r"\bliquefied\b",
        r"\benergy price\b", r"\bgas price\b", r"\bpetro\b",
    ],
    "Financials": [
        r"\bbank\b", r"\bfinance\b", r"\bfinancial\b", r"\binterest rate\b",
        r"\bFederal Reserve\b", r"\bFed\b", r"\bmortgage\b", r"\bdebt\b",
        r"\bbond\b", r"\bWall Street\b", r"\bloan\b", r"\bcredit\b",
        r"\binsurance\b", r"\btreasury\b", r"\bdeficit\b", r"\bbudget\b",
        r"\bspending\b", r"\brate hike\b", r"\brate cut\b", r"\bbailout\b",
        r"\bhedge fund\b", r"\bcapital\b", r"\binvestment bank\b",
        r"\bstock market\b", r"\bmarket crash\b", r"\bwage\b", r"\bpayroll\b",
    ],
    "Health Care": [
        r"\bhealth\b", r"\bhealthcare\b", r"\bhealth care\b", r"\bpharma\b",
        r"\bpharmaceutical\b", r"\bdrug\b", r"\bFDA\b", r"\bvaccine\b",
        r"\bhospital\b", r"\bMedicare\b", r"\bMedicaid\b", r"\bbiotech\b",
        r"\bmedicine\b", r"\bACA\b", r"\bObamacare\b", r"\binsurance\b",
        r"\bprescription\b", r"\bcancer\b", r"\bpandemic\b", r"\bCOVID\b",
        r"\bclinical\b", r"\btreatment\b", r"\bbiopharma\b",
    ],
    "Information Technology": [
        r"\btech\b", r"\btechnology\b", r"\bsoftware\b", r"\bAI\b",
        r"\bartificial intelligence\b", r"\bsemiconductor\b", r"\bchip\b",
        r"\bcyber\b", r"\bcloud\b", r"\bsilicon\b", r"\bcomputer\b",
        r"\bdata center\b", r"\bdigital\b", r"\binternet\b", r"\bautomation\b",
        r"\brobotic\b", r"\bmachine learning\b", r"\bSilicon Valley\b",
        r"\bbig tech\b", r"\bsocial media\b",  # platforms like Truth Social are tech
        r"\bcryptocurrency\b", r"\bcrypto\b", r"\bblockchain\b",
    ],
    "Communication Services": [
        r"\bmedia\b", r"\bnews\b", r"\bbroadcast\b", r"\btelevision\b",
        r"\bTV\b", r"\bstreaming\b", r"\btelecom\b", r"\bphone\b",
        r"\bbroadband\b", r"\bwireless\b", r"\b5G\b", r"\badvertising\b",
        r"\bFCC\b", r"\bFake News\b", r"\bmainstream media\b", r"\bMSNBC\b",
        r"\bCNN\b", r"\bFox News\b", r"\bnetwork\b", r"\bpublishing\b",
    ],
    "Consumer Discretionary": [
        r"\bretail\b", r"\bauto(mobile)?\b", r"\bcar\b", r"\bvehicle\b",
        r"\brestaurant\b", r"\bhotel\b", r"\btravel\b", r"\btourism\b",
        r"\bluxury\b", r"\bshopping\b", r"\bconsumer spend\b", r"\bamazon\b",
        r"\be-commerce\b", r"\belectrical vehicle\b", r"\bEV\b",
        r"\bhome builder\b", r"\bapparel\b", r"\bfashion\b",
    ],
    "Consumer Staples": [
        r"\bfood\b", r"\bgrocery\b", r"\bbeverage\b", r"\btobacco\b",
        r"\bhousehold good\b", r"\bsupermarket\b", r"\bfarm\b",
        r"\bagriculture\b", r"\bcrop\b", r"\bdrink\b", r"\bpackaged good\b",
        r"\bdairy\b", r"\bgrain\b", r"\bwheat\b", r"\bcorn\b", r"\bsoybean\b",
        r"\bfood price\b",
    ],
    "Industrials": [
        r"\bdefense\b", r"\baerospace\b", r"\bmilitary\b", r"\bmanufactur\b",
        r"\btariff\b", r"\btrade war\b", r"\bimport\b", r"\bexport\b",
        r"\bfactory\b", r"\binfrastructure\b", r"\brailroad\b", r"\bshipping\b",
        r"\bsupply chain\b", r"\bweapon\b", r"\bplane\b", r"\baircraft\b",
        r"\bNATO\b", r"\bpentagon\b", r"\bcontract\b", r"\borderance\b",
        r"\bboeing\b", r"\blockheed\b", r"\border\b", r"\btruck\b",
    ],
    "Materials": [
        r"\bsteel\b", r"\baluminum\b", r"\bcopper\b", r"\bgold\b",
        r"\bsilver\b", r"\bmining\b", r"\bchemical\b", r"\bcommodity\b",
        r"\blumber\b", r"\btimber\b", r"\bmetals?\b", r"\bminerals?\b",
        r"\bores?\b", r"\braw material\b", r"\bplastic\b", r"\bfertilizer\b",
        r"\bmaterial\b",
    ],
    "Real Estate": [
        r"\breal estate\b", r"\bproperty\b", r"\bREIT\b", r"\bconstruction\b",
        r"\brent\b", r"\bhomeowner\b", r"\bhousing market\b", r"\blandlord\b",
        r"\bmortgage rate\b", r"\bzoning\b", r"\bbuild(ing|er)?\b",
        r"\bhome price\b", r"\bcommercial real estate\b",
    ],
    "Utilities": [
        r"\belectricity\b", r"\bnuclear\b", r"\bpower grid\b", r"\butility\b",
        r"\butilities\b", r"\brenewable\b", r"\bsolar\b", r"\bwindmill\b",
        r"\bwind farm\b", r"\bpower plant\b", r"\bhydro\b", r"\bgrid\b",
        r"\belectric bill\b", r"\benergy cost\b", r"\bwatt\b",
    ],
}

# ── Broad-economy keywords (fallback → SPY) ────────────────────────────────────
BROAD_ECONOMY_PATTERNS: list[str] = [
    r"\beconomy\b", r"\beconomic\b", r"\bGDP\b", r"\binflation\b",
    r"\brecession\b", r"\bunemployment\b", r"\bjobs?\b", r"\bmarket\b",
    r"\bstock(s)?\b", r"\btrade\b", r"\bsanction\b", r"\btariff\b",
    r"\bgrowth\b", r"\bspending\b", r"\bbillion\b", r"\btrillion\b",
    r"\bCPI\b", r"\bPPI\b", r"\bFOMC\b", r"\bfiscal\b", r"\bmonetary\b",
]

# Pre-compile all patterns for speed
_COMPILED: dict[str, list[re.Pattern]] = {
    sector: [re.compile(p, re.IGNORECASE) for p in patterns]
    for sector, patterns in SECTOR_KEYWORDS.items()
}
_COMPILED_BROAD: list[re.Pattern] = [
    re.compile(p, re.IGNORECASE) for p in BROAD_ECONOMY_PATTERNS
]

# ── Core mapping function ──────────────────────────────────────────────────────

def map_post(text: str) -> tuple[str, str]:
    """
    Returns (target_sector, target_tickers) for one post.
    target_tickers is a pipe-separated string, e.g. "XLE|XOM|CVX".
    """
    hits: dict[str, int] = {
        sector: sum(1 for pat in patterns if pat.search(text))
        for sector, patterns in _COMPILED.items()
    }

    best_sector = max(hits, key=lambda s: (hits[s], s))  # ties: alphabetical
    best_count  = hits[best_sector]

    if best_count > 0:
        tickers = SECTOR_REPS[best_sector]
        return best_sector, "|".join(tickers)

    # No sector hit — check broad economy
    if any(pat.search(text) for pat in _COMPILED_BROAD):
        return "Broad Economy", "SPY"

    # Total fallback
    return "Broad Economy", "SPY"

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    if not os.path.exists(INPUT_PATH):
        print(f"ERROR: {INPUT_PATH} not found.")
        sys.exit(1)

    print(f"Loading {INPUT_PATH} ...")
    df = pd.read_csv(INPUT_PATH, low_memory=False)
    print(f"  {len(df):,} posts loaded.")

    if "text" not in df.columns:
        print("ERROR: 'text' column not found.")
        sys.exit(1)

    df["text"] = df["text"].fillna("").astype(str)

    print("Mapping posts to sectors and tickers ...")
    results = df["text"].apply(lambda t: pd.Series(map_post(t), index=["target_sector", "target_tickers"]))
    df = pd.concat([df.reset_index(drop=True), results], axis=1)

    df.to_csv(OUTPUT_PATH, index=False)
    print(f"\nSaved {len(df):,} rows → {OUTPUT_PATH}")

    # Distribution summary
    counts = df["target_sector"].value_counts()
    print(f"\nSector distribution ({len(counts)} sectors):")
    for sector, count in counts.items():
        tickers = SECTOR_REPS.get(sector, ["SPY"])
        print(f"  {sector:<30s}  {count:>5,}  ({count/len(df)*100:4.1f}%)  → {', '.join(tickers)}")

    # Sample rows for each sector
    print("\nSample posts per sector (1 each):")
    for sector in counts.index:
        row = df[df["target_sector"] == sector].iloc[0]
        tw = row.get("tw_sentiment", "?")
        print(f"\n  [{sector}] tw={tw}  tickers={row['target_tickers']}")
        print(f"  {row['text'][:160]}")


if __name__ == "__main__":
    main()
