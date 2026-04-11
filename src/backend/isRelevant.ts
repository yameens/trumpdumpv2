import OpenAI, { APIError } from 'openai';
import type { ScrapedPost } from './sync.js';

// ─────────────────────────────────────────────────────────────────────────────
// RELEVANCE PROMPT — paste your instructions here
// ─────────────────────────────────────────────────────────────────────────────
//
// This prompt is the ONLY thing to edit in this file.
//
// The model receives:
//   - Your prompt below as the system message
//   - The raw post content as the user message
//
// Your prompt should instruct the model to return ONLY:
//   { "relevant": true } or { "relevant": false }
//
// ─────────────────────────────────────────────────────────────────────────────
const RELEVANCE_PROMPT = `
You are a financial relevance classifier for a stock-market intelligence tool.

Determine whether a Trump Truth Social post has clear, direct implications for
any financial market, industry, commodity, or publicly traded company.

Mark as RELEVANT (true) if the post:
a. Announces or hints at tariffs, trade deals, or sanctions
b. Concerns energy policy, oil, gas, or commodities (e.g. threatening to close a strait)
c. Names a specific industry sector (defense, tech, pharma, banking, agriculture, etc.)
d. Mentions a regulatory change, executive order, or government contract with market impact
e. Discusses interest rates, the economy, jobs, GDP, inflation, or fiscal policy
f. References a specific publicly traded company or stock ticker
g. Involves geopolitical events that historically move markets (wars, blockades, alliances)

Mark as IRRELEVANT (false) if the post:
a. Is a historical photo, meme, or nostalgia ("New York City, 1929!")
b. Is personal praise, political cheerleading, or congratulations with no policy content
c. Attacks a celebrity, journalist, or political opponent without market implications
d. Is a link to an opinion piece with no direct policy announcement
e. Contains no actionable information for an investor

Return ONLY a JSON object with a single key:
{ "relevant": true }
or
{ "relevant": false }

No prose, no markdown, no extra keys.
`.trim();

// ── LLM MODEL ────────────────────────────────────────────────────────────────
const RELEVANCE_MODEL = 'gpt-4o';

// ─────────────────────────────────────────────────────────────────────────────
// Internal utilities
// ─────────────────────────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('[isRelevant] OPENAI_API_KEY is not set in environment');
  }
  return new OpenAI({ apiKey, timeout: 30_000 });
}

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
          `[isRelevant] OpenAI attempt ${attempt}/${maxAttempts} failed (${(err as APIError).status}). Retrying in ${delay}ms…`,
        );
        await new Promise((res) => setTimeout(res, delay));
      } else if (!isRateLimit) {
        throw err;
      }
    }
  }

  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether a scraped post is financially relevant before running
 * the full processPost() analysis pipeline.
 *
 * Edit RELEVANCE_PROMPT at the top of this file to control the classification logic.
 *
 * @param post  The scraped post to evaluate.
 * @returns     true if the post warrants full analysis, false to skip entirely.
 */
export async function isRelevant(post: ScrapedPost): Promise<boolean> {
  const openai = buildOpenAIClient();

  console.log(`[isRelevant] Checking relevance for status ${post.statusId}…`);

  const relevant = await withRetry(async () => {
    const completion = await openai.chat.completions.create({
      model: RELEVANCE_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: RELEVANCE_PROMPT },
        { role: 'user', content: post.content },
      ],
    });

    const text = completion.choices[0]?.message.content ?? '';
    if (!text) {
      throw new Error('[isRelevant] OpenAI returned an empty response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `[isRelevant] Response is not valid JSON.\nRaw response:\n${text}`,
      );
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`[isRelevant] Expected a JSON object, got: ${JSON.stringify(parsed)}`);
    }

    const raw = (parsed as Record<string, unknown>)['relevant'];
    if (typeof raw !== 'boolean') {
      throw new Error(
        `[isRelevant] "relevant" key missing or not a boolean: ${JSON.stringify(parsed)}`,
      );
    }

    return raw;
  });

  console.log(`[isRelevant] Status ${post.statusId} — relevant: ${relevant}`);
  return relevant;
}
