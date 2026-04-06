import OpenAI, { APIError } from 'openai';
import type { ScrapedPost } from './sync.js';
import { scoreConfidence } from './scoreConfidence.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURABLE CONSTANTS — edit these freely without touching anything else
// ─────────────────────────────────────────────────────────────────────────────

// ── PASTE YOUR INDUSTRY LIST HERE ────────────────────────────────────────────
// Add every industry you want the LLM to choose from.
// The LLM will be required to pick one of these exactly.
export const INDUSTRY_LIST: string[] = [
  // e.g.:
  // "Technology",
  // "Energy",
  // "Defense",
  // "Finance",
  // "Healthcare",
  // "Real Estate",
  // "Retail",
  // "Automotive",
  // "Agriculture",
  // "Media & Entertainment",
];

// ── PASTE YOUR TICKER LIST HERE ──────────────────────────────────────────────
// Add every stock ticker you want the LLM to detect and validate against.
// The LLM will only return tickers found in this list.
// Leave empty to allow free-form ticker detection (LLM picks any symbol it sees).
export const TICKER_LIST: string[] = [
  // e.g.:
  // "AAPL",
  // "NVDA",
  // "TSLA",
  // "META",
  // "MSFT",
  // "AMZN",
  // "GOOGL",
];

// ── LLM MODEL ────────────────────────────────────────────────────────────────
const LLM_MODEL = 'gpt-4o';

// ── SYSTEM PROMPT ────────────────────────────────────────────────────────────
// Paste or edit the prompt below.
// INDUSTRY_LIST and TICKER_LIST are interpolated automatically.
const buildSystemPrompt = (industryList: string[], tickerList: string[]): string => `
Analyze the following content and return a JSON object with these keys:

timestamp: ISO 8601 string.

sentiment: "bullish" or "bearish" (strictly).

content: A clean, 2-sentence summary of the post.

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
  /** ISO 8601 timestamp of the original post. */
  timestamp: string;
  sentiment: 'bullish' | 'bearish';
  /** Clean 2-sentence summary produced by the LLM. */
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

  // timestamp
  const timestamp = obj['timestamp'];
  if (typeof timestamp !== 'string' || !timestamp) {
    throw new Error(`[processPost] Invalid or missing "timestamp": ${JSON.stringify(timestamp)}`);
  }

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

  return { timestamp, sentiment, content: content.trim(), confidence, industry, tickers };
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
 */
export async function processPost(post: ScrapedPost): Promise<AnalysisResult> {
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
