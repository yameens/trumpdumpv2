import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { processPost } from './processPost.js';
import type { AnalysisResult } from './processPost.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScrapedPost {
  /** trumpstruth.org internal numeric ID, e.g. "37609" */
  statusId: string;
  /** Canonical TRUTH Social status ID, e.g. "116356081038721731" — the most stable unique identifier */
  truthSocialId: string;
  /** Raw timestamp string from the page, e.g. "April 6, 2026, 1:21 AM" */
  timestamp: string;
  content: string;
}

interface DbPost {
  timestamp: string;
  content: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const SCRAPE_URL = 'https://trumpstruth.org/';

/**
 * Update TABLE_NAME to match your Supabase table.
 * Schema reference: id (UUID), timestamp (DateTime), content (Text),
 * sentiment (Enum), confidence (Integer), industry (String), tickers (JSONB)
 */
const TABLE_NAME = 'posts';

function buildSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('[sync] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }
  return createClient(url, key);
}

// ─── Hash ────────────────────────────────────────────────────────────────────

/**
 * SHA-256 content hash. Whitespace-normalised so minor formatting
 * differences in the DB don't cause false positives.
 */
function computeHash(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex');
}

// ─── Retry / backoff ─────────────────────────────────────────────────────────

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
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        console.warn(
          `[sync] scrapeLatestPost attempt ${attempt}/${maxAttempts} failed. Retrying in ${delay}ms…`,
        );
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }

  throw lastError;
}

// ─── Scraper ─────────────────────────────────────────────────────────────────

async function scrapeLatestPost(): Promise<ScrapedPost> {
  const { data: html } = await axios.get<string>(SCRAPE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrumpDump/2.0)' },
    timeout: 10_000,
  });

  const $ = cheerio.load(html);

  // Posts are listed newest-first as div.status[data-status-url]
  const firstStatus = $('.status').first();
  if (!firstStatus.length) {
    throw new Error('[sync] No .status elements found — page structure may have changed');
  }

  // trumpstruth.org internal ID from data-status-url, e.g. "37609"
  const dataUrl = (firstStatus.attr('data-status-url') ?? '').trim();
  const statusIdMatch = dataUrl.match(/\/statuses\/(\d+)/);
  const statusId = statusIdMatch?.[1];
  if (!statusId) {
    throw new Error(`[sync] Could not parse statusId from data-status-url: "${dataUrl}"`);
  }

  // Canonical TRUTH Social ID from the "Original Post" external link href,
  // e.g. https://truthsocial.com/@realDonaldTrump/116356081038721731 → "116356081038721731"
  const externalHref = firstStatus.find('a.status__external-link').attr('href') ?? '';
  const truthSocialIdMatch = externalHref.match(/\/(\d+)\/?$/);
  const truthSocialId = truthSocialIdMatch?.[1];
  if (!truthSocialId) {
    throw new Error(`[sync] Could not parse TRUTH Social ID from href: "${externalHref}"`);
  }

  // Timestamp text from the meta link, e.g. "April 6, 2026, 1:21 AM"
  const timestamp = firstStatus
    .find('a.status-info__meta-item[href*="/statuses/"]')
    .text()
    .trim();

  // Full post text — cheerio's .text() strips tags; trim normalises whitespace
  const content = firstStatus.find('.status__content').text().trim();
  if (!content) {
    throw new Error(`[sync] Empty content scraped for status ${statusId}`);
  }

  return { statusId, truthSocialId, timestamp, content };
}

// ─── Database ────────────────────────────────────────────────────────────────

async function getLatestDbPost(supabase: SupabaseClient): Promise<DbPost | null> {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('content, timestamp')
    .order('timestamp', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`[sync] Supabase query failed: ${error.message}`);
  }

  if (!data || data.length === 0) return null;

  const row = data[0];
  if (!row) return null;

  return row as DbPost;
}

// ─── Database write ──────────────────────────────────────────────────────────

async function insertPost(
  supabase: SupabaseClient,
  scraped: ScrapedPost,
  result: AnalysisResult,
): Promise<void> {
  const { error } = await supabase.from(TABLE_NAME).insert({
    timestamp:  new Date(scraped.timestamp).toISOString(),
    sentiment:  result.sentiment,
    content:    scraped.content,
    confidence: result.confidence,
    industry:   result.industry,
    tickers:    result.tickers,
  });
  if (error) {
    throw new Error(`[sync] Supabase insert failed: ${error.message}`);
  }
  console.log(`[sync] Inserted status ${scraped.statusId} into DB`);
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

/**
 * Core sync entry point:
 *   1. Scrape the latest post from trumpstruth.org (with exponential backoff).
 *   2. Compute a SHA-256 hash of its content.
 *   3. Fetch the most-recent DB entry and hash its content.
 *   4. If hashes match → identical post already processed, stop.
 *   5. If hashes differ (or DB is empty) → call processPost().
 */
export async function syncLatestPost(): Promise<void> {
  console.log('[sync] Starting sync…');

  const supabase = buildSupabaseClient();

  // Step 1 — scrape with retry/backoff
  const scraped = await withRetry(scrapeLatestPost);
  console.log(
    `[sync] Scraped: statusId=${scraped.statusId} | truthSocialId=${scraped.truthSocialId} | ${scraped.timestamp}`,
  );

  // Step 2 — hash scraped content
  const scrapedHash = computeHash(scraped.content);

  // Step 3 — fetch latest DB entry
  const dbPost = await getLatestDbPost(supabase);

  if (!dbPost) {
    console.log('[sync] DB is empty — processing first post');
    const result = await processPost(scraped);
    if (result) {
      await insertPost(supabase, scraped, result);
    } else {
      console.log('[sync] Post not market-relevant — skipping DB write');
    }
    return;
  }

  // Step 4 — compare hashes
  const dbHash = computeHash(dbPost.content);

  if (scrapedHash === dbHash) {
    console.log(
      `[sync] Hash match (${scrapedHash.slice(0, 12)}…) — post already processed. Stopping.`,
    );
    return;
  }

  // Step 5 — new post detected
  console.log(
    `[sync] Hash mismatch: scraped=${scrapedHash.slice(0, 12)}… db=${dbHash.slice(0, 12)}… — triggering processPost()`,
  );
  const result = await processPost(scraped);
  if (result) {
    await insertPost(supabase, scraped, result);
  } else {
    console.log('[sync] Post not market-relevant — skipping DB write');
  }
}
