import { syncLatestPost } from '@backend/sync';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret') ?? '';

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET.trim()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await syncLatestPost();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/sync]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
