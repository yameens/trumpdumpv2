import OpenAI, { APIError } from 'openai';
import type { ScrapedPost } from './sync.js';
import { scoreConfidence } from './scoreConfidence.js';
import { isRelevant } from './isRelevant.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURABLE CONSTANTS — edit these freely without touching anything else
// ─────────────────────────────────────────────────────────────────────────────

// ── PASTE YOUR INDUSTRY LIST HERE ────────────────────────────────────────────
// Add every industry you want the LLM to choose from.
// The LLM will be required to pick one of these exactly.
export const INDUSTRY_LIST: string[] = [
  // --- ENERGY ---
  "Energy Equipment & Services",
  "Oil, Gas & Consumable Fuels",

  // --- MATERIALS ---
  "Chemicals",
  "Construction Materials",
  "Containers & Packaging",
  "Metals & Mining",
  "Paper & Forest Products",

  // --- INDUSTRIALS ---
  "Aerospace & Defense",
  "Building Products",
  "Construction & Engineering",
  "Electrical Equipment",
  "Industrial Conglomerates",
  "Machinery",
  "Trading Companies & Distributors",
  "Commercial Services & Supplies",
  "Professional Services",
  "Air Freight & Logistics",
  "Airlines",
  "Marine Transportation",
  "Ground Transportation",
  "Transportation Infrastructure",

  // --- CONSUMER DISCRETIONARY ---
  "Automobile Components",
  "Automobiles",
  "Household Durables",
  "Leisure Products",
  "Textiles, Apparel & Luxury Goods",
  "Hotels, Restaurants & Leisure",
  "Diversified Consumer Services",
  "Broadline Retail",
  "Specialty Retail",

  // --- CONSUMER STAPLES ---
  "Consumer Staples Distribution & Retail",
  "Beverages",
  "Food Products",
  "Tobacco",
  "Household Products",
  "Personal Care Products",

  // --- HEALTH CARE ---
  "Health Care Equipment & Supplies",
  "Health Care Providers & Services",
  "Health Care Technology",
  "Biotechnology",
  "Pharmaceuticals",
  "Life Sciences Tools & Services",

  // --- FINANCIALS ---
  "Banks",
  "Financial Services",
  "Consumer Finance",
  "Capital Markets",
  "Insurance",
  "Mortgage Real Estate Investment Trusts (REITs)",

  // --- INFORMATION TECHNOLOGY ---
  "IT Services",
  "Software",
  "Communications Equipment",
  "Technology Hardware, Storage & Peripherals",
  "Electronic Equipment, Instruments & Components",
  "Semiconductors & Semiconductor Equipment",

  // --- COMMUNICATION SERVICES ---
  "Diversified Telecommunication Services",
  "Wireless Telecommunication Services",
  "Media",
  "Entertainment",
  "Interactive Media & Services",

  // --- UTILITIES ---
  "Electric Utilities",
  "Gas Utilities",
  "Multi-Utilities",
  "Water Utilities",
  "Independent Power and Renewable Electricity Producers",

  // --- REAL ESTATE ---
  "Real Estate Management & Development",
  "Equity Real Estate Investment Trusts (REITs)",

  // --- MISC / CATCH-ALL ---
  "Conglomerates",
  "Cryptocurrency & Digital Assets",
  "Government & Policy",
  "Other / Diversified"
];

// ── PASTE YOUR TICKER LIST HERE ──────────────────────────────────────────────
// Add every stock ticker you want the LLM to detect and validate against.
// The LLM will only return tickers found in this list.
// Leave empty to allow free-form ticker detection (LLM picks any symbol it sees).
export const TICKER_LIST: string[] = [
  // --- TECHNOLOGY & SEMICONDUCTORS ---
  "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "ADBE", "CRM", "AMD", "CSCO", "ACN",
  "IBM", "INTC", "TXN", "QCOM", "AMAT", "MU", "LRCX", "ADI", "KLAC", "SNPS",
  "CDNS", "PANW", "FTNT", "CRWD", "NOW", "ROP", "APH", "MSI", "TEL", "HPE",
  "HPQ", "STX", "WDC", "GLW", "TER", "ANET", "MCHP", "ON", "MPWR", "TYL",
  "FSLR", "ENPH", "KEYS", "IT", "AKAM", "ZBRA", "TRMB", "GEN", "JNPR", "SWKS",

  // --- COMMUNICATION SERVICES ---
  "GOOGL", "GOOG", "META", "NFLX", "DIS", "TMUS", "VZ", "T", "CMCSA", "CHTR",
  "EA", "TTWO", "OMC", "IPG", "LYV", "MTCH", "PARA", "FOXA", "FOX", "NWSA",

  // --- CONSUMER DISCRETIONARY ---
  "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "TJX", "BKNG", "CMG",
  "ORLY", "AZO", "MAR", "HLT", "F", "GM", "LULU", "DHI", "PHM", "LEN",
  "TSCO", "ROST", "YUM", "DRI", "DASH", "ABNB", "EBAY", "ETSY", "BBY", "GRMN",
  "VFC", "HAS", "MAT", "POOL", "PHM", "NVR", "MGM", "WWY", "RL", "TPR",

  // --- CONSUMER STAPLES ---
  "WMT", "PG", "COST", "KO", "PEP", "PM", "MO", "MDLZ", "CL", "TGT",
  "EL", "KDP", "STZ", "GIS", "SYY", "ADM", "KR", "KMB", "HSY", "MKC",
  "CHD", "CLX", "K", "LW", "CPB", "SJM", "TAP", "CAG", "DLTR", "DG",

  // --- HEALTHCARE ---
  "LLY", "UNH", "JNJ", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR", "ISRG",
  "AMGN", "BMY", "VRTX", "SYK", "GILD", "ELV", "CI", "CVS", "BSX", "MDT",
  "ZTS", "HCA", "REGN", "BDX", "MCK", "COR", "EW", "IDXX", "HUM", "IQV",
  "DXCM", "A", "MTD", "STE", "WAT", "RMD", "BAX", "WST", "VTRS", "BIIB",
  "ALGN", "MOH", "CNC", "XRAY", "MRNA", "GEV", "TECH", "BIO", "CRL",

  // --- FINANCIALS ---
  "BRK.B", "JPM", "V", "MA", "BAC", "WFC", "AXP", "MS", "GS", "C",
  "BLK", "SPGI", "BX", "KKR", "CME", "SCHW", "MMC", "AON", "ICE", "PGR",
  "CB", "MCO", "USB", "PNC", "TROW", "MET", "PRU", "TRV", "AFL", "ALL",
  "COF", "DFS", "STT", "BK", "FITB", "MTB", "HBAN", "RF", "KEY", "CFG",
  "BRO", "AJG", "WTW", "L", "HIG", "PFG", "AMP", "BEN", "IVZ", "RJF",

  // --- INDUSTRIALS ---
  "GE", "CAT", "UNP", "HON", "UPS", "RTX", "BA", "LMT", "DE", "LRCX",
  "ETN", "WM", "NOC", "GD", "NSC", "CSX", "FDX", "EMR", "ITW", "PH",
  "ROP", "TT", "CARR", "OTIS", "FAST", "CPRT", "VRSK", "ODFL", "PCAR", "GWW",
  "CMI", "PAYX", "AME", "IR", "ROK", "DOV", "XYL", "EFX", "PWR", "HUBB",
  "ACM", "LDOS", "VMC", "MLM", "TFI", "DAL", "UAL", "LUV", "AAL", "JBHT",

  // --- ENERGY ---
  "XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "VLO", "OXY", "HES",
  "HAL", "WMB", "OKE", "DVN", "FANG", "BKR", "KMI", "TRGP", "CTRA", "APA",
  "MRO", "EQT", "FSHR", "CHK", "OVV", "CHK",

  // --- MATERIALS ---
  "LIN", "SHW", "APD", "ECL", "FCX", "CTVA", "NEM", "DOW", "DD", "PPG",
  "VMC", "MLM", "ALB", "CF", "NUE", "STLD", "IFF", "FMC", "MOS", "CE",
  "EMN", "LYB", "BALL", "AMCR", "PKG", "WRK", "IP",

  // --- REAL ESTATE & UTILITIES ---
  "PLD", "AMT", "EQIX", "WELL", "PSA", "DLR", "CCI", "O", "VICI", "SBAC",
  "WY", "ARE", "CBRE", "AVB", "EQR", "EXR", "VTR", "BXP", "HST", "MAA",
  "NEE", "SO", "DUK", "CEG", "SRE", "D", "AEP", "PEG", "EXC", "ED",
  "XEL", "PCG", "WEC", "ES", "AWK", "ETR", "FE", "EIX", "CNP", "CMS",

  // --- TOP GROWTH/TECH (NASDAQ 100 ADDITIONS) ---
  "PLTR", "SQ", "PYPL", "COIN", "HOOD", "SHOP", "MELI", "SE", "SNOW", "TEAM",
  "DDOG", "ZS", "OKTA", "MDB", "NET", "PATH", "U", "ROKU", "DKNG", "PINS",
  "TSM", "ASML", "ARM", "SMCI", "SNDK", "LUMN", "FIGS", "BCBP"
];

// ── LLM MODEL ────────────────────────────────────────────────────────────────
const LLM_MODEL = 'gpt-4o';

// ── SYSTEM PROMPT ────────────────────────────────────────────────────────────
// Paste or edit the prompt below.
// INDUSTRY_LIST and TICKER_LIST are interpolated automatically.
const buildSystemPrompt = (industryList: string[], tickerList: string[]): string => `
Analyze the following content and return a JSON object with these keys:

sentiment: "bullish" or "bearish" (strictly).

content: A clean, 2-sentence summary of the post for internal analysis context (not displayed to users).

confidence: An integer 0-100 based on your certainty that this post will have a meaningful impact on the stated industry and tickers. Higher = more certain of market impact.

industry: Pick the single best fit from this list (use the exact string):
${industryList.length > 0 ? industryList.map((i) => `  - "${i}"`).join('\n') : '  - (no list provided — use your best judgement)'}

tickers: ${
  tickerList.length > 0
    ? `Only return ticker symbols from this validated list: [${tickerList.map((t) => `"${t}"`).join(', ')}]. Return [] if none of these appear in the text.`
    : 'A list of detected stock symbols found in the text (e.g. ["AAPL", "NVDA"]). Return [] if none detected.'
}

Ensure the output is strictly JSON with no prose, no markdown fences, and no extra keys.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Matches the database schema exactly (database.txt). */
export interface AnalysisResult {
  sentiment: 'bullish' | 'bearish';
  /** Internal analysis summary (not stored in DB — DB uses scraped.content). */
  content: string;
  /** LLM certainty of market impact, 0–100. */
  confidence: number;
  /** One entry from INDUSTRY_LIST. */
  industry: string;
  /** Stock tickers mentioned, e.g. ["AAPL", "NVDA"]. */
  tickers: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI client
// ─────────────────────────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('[processPost] OPENAI_API_KEY is not set in environment');
  }
  return new OpenAI({ apiKey, timeout: 30_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry / backoff (mirrors withRetry in sync.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRateLimit =
        err instanceof APIError && (err.status === 429 || err.status >= 500);

      if (attempt < maxAttempts && isRateLimit) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        console.warn(
          `[processPost] OpenAI attempt ${attempt}/${maxAttempts} failed (${(err as APIError).status}). Retrying in ${delay}ms…`,
        );
        await new Promise((res) => setTimeout(res, delay));
      } else if (!isRateLimit) {
        // Non-retriable error — fail fast
        throw err;
      }
    }
  }

  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function validateAndNormalize(
  raw: unknown,
  industryList: string[],
  tickerList: string[],
): AnalysisResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`[processPost] LLM response is not a JSON object: ${JSON.stringify(raw)}`);
  }

  const obj = raw as Record<string, unknown>;

  // sentiment
  const sentiment = obj['sentiment'];
  if (sentiment !== 'bullish' && sentiment !== 'bearish') {
    throw new Error(
      `[processPost] Invalid "sentiment" (must be "bullish" or "bearish"): ${JSON.stringify(sentiment)}`,
    );
  }

  // content
  const content = obj['content'];
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`[processPost] Invalid or missing "content": ${JSON.stringify(content)}`);
  }

  // confidence — clamp silently rather than reject; bad numbers are LLM noise
  const rawConfidence = obj['confidence'];
  if (typeof rawConfidence !== 'number') {
    throw new Error(
      `[processPost] Invalid "confidence" (must be a number): ${JSON.stringify(rawConfidence)}`,
    );
  }
  const confidence = clamp(Math.round(rawConfidence), 0, 100);

  // industry — must be in INDUSTRY_LIST (skip if list is empty, warn instead)
  const industry = obj['industry'];
  if (typeof industry !== 'string' || !industry.trim()) {
    throw new Error(`[processPost] Invalid or missing "industry": ${JSON.stringify(industry)}`);
  }
  if (industryList.length > 0 && !industryList.includes(industry)) {
    throw new Error(
      `[processPost] LLM returned industry not in INDUSTRY_LIST: "${industry}". ` +
        `Add it to INDUSTRY_LIST in processPost.ts or check your prompt.`,
    );
  }

  // tickers — default to [] if missing or wrong type;
  // if TICKER_LIST is populated, silently drop any symbol not in the list
  const rawTickers = obj['tickers'];
  const allTickers: string[] = Array.isArray(rawTickers)
    ? (rawTickers as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const tickers =
    tickerList.length > 0 ? allTickers.filter((t) => tickerList.includes(t)) : allTickers;

  return { sentiment, content: content.trim(), confidence, industry, tickers };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a scraped post to gpt-4o and returns a validated AnalysisResult.
 *
 * Retries up to 3× on OpenAI rate-limit (429) or server errors (5xx).
 * Throws on invalid JSON, schema violations, or missing API key.
 *
 * NOTE: Does not write to the DB — the caller (syncLatestPost) owns persistence.
 *
 * Returns null if the post is not financially relevant (determined by isRelevant()).
 */
export async function processPost(post: ScrapedPost): Promise<AnalysisResult | null> {
  const relevant = await isRelevant(post);
  if (!relevant) {
    console.log(`[processPost] Status ${post.statusId} is not market-relevant — skipping analysis.`);
    return null;
  }

  if (INDUSTRY_LIST.length === 0) {
    console.warn(
      '[processPost] INDUSTRY_LIST is empty — industry validation is disabled. ' +
        'Paste your industries into processPost.ts.',
    );
  }
  if (TICKER_LIST.length === 0) {
    console.warn(
      '[processPost] TICKER_LIST is empty — free-form ticker detection is active. ' +
        'Paste your tickers into processPost.ts to constrain results.',
    );
  }

  const openai = buildOpenAIClient();
  const systemPrompt = buildSystemPrompt(INDUSTRY_LIST, TICKER_LIST);

  console.log(`[processPost] Calling ${LLM_MODEL} for status ${post.statusId}…`);

  const raw = await withRetry(async () => {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: post.content },
      ],
    });

    const text = completion.choices[0]?.message.content ?? '';
    if (!text) {
      throw new Error('[processPost] OpenAI returned an empty response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `[processPost] LLM response is not valid JSON.\nRaw response:\n${text}`,
      );
    }

    return parsed;
  });

  const result = validateAndNormalize(raw, INDUSTRY_LIST, TICKER_LIST);

  // Override confidence with the dedicated scoring call
  result.confidence = await scoreConfidence(post, result);

  console.log(
    `[processPost] Analysis complete — sentiment: ${result.sentiment}, ` +
      `confidence: ${result.confidence}, industry: ${result.industry}, ` +
      `tickers: [${result.tickers.join(', ')}]`,
  );

  return result;
}
