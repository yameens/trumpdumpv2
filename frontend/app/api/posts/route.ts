import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key);
}

export async function GET() {
  try {
    const supabase = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [recentRes, weeklyRes] = await Promise.all([
      supabase
        .from('posts')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(5),
      // Fetch more than 5 so we have room to deduplicate by ticker
      supabase
        .from('posts')
        .select('*')
        .gte('timestamp', sevenDaysAgo)
        .order('confidence', { ascending: false })
        .limit(50),
    ]);

    if (recentRes.error) throw recentRes.error;
    if (weeklyRes.error) throw weeklyRes.error;

    // Keep only the highest-confidence post per ticker (already sorted desc by confidence)
    const seen = new Set<string>();
    const weekly = (weeklyRes.data ?? []).filter((post) => {
      const ticker = (post.tickers as string[])?.[0] ?? 'NONE';
      if (seen.has(ticker)) return false;
      seen.add(ticker);
      return true;
    }).slice(0, 5);

    return NextResponse.json({
      recent: recentRes.data ?? [],
      weekly,
    });
  } catch (err) {
    console.error('[api/posts] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
