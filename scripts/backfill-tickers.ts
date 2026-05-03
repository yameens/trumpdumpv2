/**
 * One-shot script: for every post in the DB that has an empty tickers array,
 * fill tickers with [industry_etf] and set the etf column.
 *
 * Run from repo root:
 *   node --env-file=.env --import tsx/esm scripts/backfill-tickers.ts
 */

import { createClient } from '@supabase/supabase-js';
import { INDUSTRY_ETF_MAP } from '../src/backend/processPost.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const { data: posts, error: fetchErr } = await supabase
  .from('posts')
  .select('id, industry, tickers, etf');

if (fetchErr) { console.error('Fetch failed:', fetchErr.message); process.exit(1); }
if (!posts?.length) { console.log('No posts found.'); process.exit(0); }

console.log(`Found ${posts.length} posts. Processing…`);

let updated = 0;
for (const post of posts) {
  const etf = INDUSTRY_ETF_MAP[post.industry as string] ?? 'SPY';
  const needsTicker = !post.tickers || (post.tickers as string[]).length === 0;
  const needsEtf    = !post.etf || post.etf === 'SPY';   // column may be missing or defaulted

  if (!needsTicker && !needsEtf) continue;

  const patch: Record<string, unknown> = { etf };
  if (needsTicker) patch.tickers = [etf];

  const { error: updateErr } = await supabase
    .from('posts')
    .update(patch)
    .eq('id', post.id);

  if (updateErr) {
    console.error(`  ✗ ${post.id}: ${updateErr.message}`);
  } else {
    console.log(`  ✓ ${post.id} | industry: ${post.industry} → etf/ticker: ${etf}`);
    updated++;
  }
}

console.log(`\nDone. Updated ${updated}/${posts.length} posts.`);
