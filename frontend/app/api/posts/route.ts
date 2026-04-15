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
      supabase
        .from('posts')
        .select('*')
        .gte('timestamp', sevenDaysAgo)
        .order('confidence', { ascending: false })
        .limit(5),
    ]);

    if (recentRes.error) throw recentRes.error;
    if (weeklyRes.error) throw weeklyRes.error;

    return NextResponse.json({
      recent: recentRes.data ?? [],
      weekly: weeklyRes.data ?? [],
    });
  } catch (err) {
    console.error('[api/posts] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
