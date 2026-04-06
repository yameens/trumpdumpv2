import OpenAI, { APIError } from 'openai';
import type { ScrapedPost } from './sync.js';
import type { AnalysisResult } from './processPost.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE SCORING PROMPT — paste your instructions here
// ─────────────────────────────────────────────────────────────────────────────
//
// This prompt is the ONLY thing to edit in this file.
//
// The model receives:
//   - Your prompt below as the system message
//   - A structured user message with the post content + initial analysis context
//     (sentiment, industry, tickers already identified)
//
// Your prompt should instruct the model to return ONLY:
//   { "confidence": <integer 0-100> }
//
// ─────────────────────────────────────────────────────────────────────────────
const CONFIDENCE_PROMPT = `
[PASTE YOUR CONFIDENCE SCORING PROMPT HERE]

Return ONLY a JSON object with a single key:
{ "confidence": <integer between 0 and 100> }

No prose, no markdown, no extra keys.
`.trim();

// ── LLM MODEL ────────────────────────────────────────────────────────────────
// Change this independently from the main analysis model if desired.
const CONFIDENCE_MODEL = 'gpt-4o';

// ─────────────────────────────────────────────────────────────────────────────
// Internal utilities
// ─────────────────────────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('[scoreConfidence] OPENAI_API_KEY is not set in environment');
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
          `[scoreConfidence] OpenAI attempt ${attempt}/${maxAttempts} failed (${(err as APIError).status}). Retrying in ${delay}ms…`,
        );
        await new Promise((res) => setTimeout(res, delay));
      } else if (!isRateLimit) {
        throw err;
      }
    }
  }

  throw lastError;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─────────────────────────────────────────────────────────────────────────────
// User message builder
// ─────────────────────────────────────────────────────────────────────────────

function buildUserMessage(post: ScrapedPost, analysis: AnalysisResult): string {
  return [
    `Post: ${post.content}`,
    ``,
    `Initial analysis context:`,
    `  Sentiment : ${analysis.sentiment}`,
    `  Industry  : ${analysis.industry}`,
    `  Tickers   : ${analysis.tickers.length > 0 ? analysis.tickers.join(', ') : 'none detected'}`,
    ``,
    `Score the investment confidence 0-100.`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Makes a dedicated LLM call whose sole job is returning a confidence score.
 *
 * Edit CONFIDENCE_PROMPT at the top of this file to control the scoring logic.
 *
 * @param post     The original scraped post (provides raw content as context).
 * @param analysis The AnalysisResult from the main processPost() call
 *                 (provides sentiment, industry, tickers as context).
 * @returns        An integer 0–100. Clamped to range if the model returns out-of-bounds.
 */
export async function scoreConfidence(
  post: ScrapedPost,
  analysis: AnalysisResult,
): Promise<number> {
  const openai = buildOpenAIClient();
  const userMessage = buildUserMessage(post, analysis);

  console.log(`[scoreConfidence] Scoring confidence for status ${post.statusId}…`);

  const score = await withRetry(async () => {
    const completion = await openai.chat.completions.create({
      model: CONFIDENCE_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CONFIDENCE_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const text = completion.choices[0]?.message.content ?? '';
    if (!text) {
      throw new Error('[scoreConfidence] OpenAI returned an empty response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `[scoreConfidence] Response is not valid JSON.\nRaw response:\n${text}`,
      );
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`[scoreConfidence] Expected a JSON object, got: ${JSON.stringify(parsed)}`);
    }

    const raw = (parsed as Record<string, unknown>)['confidence'];
    if (typeof raw !== 'number') {
      throw new Error(
        `[scoreConfidence] "confidence" key missing or not a number: ${JSON.stringify(parsed)}`,
      );
    }

    return clamp(Math.round(raw), 0, 100);
  });

  console.log(`[scoreConfidence] Score: ${score}`);
  return score;
}
