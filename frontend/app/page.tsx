'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import PostBox from '@/components/PostBox';
import type { Post } from '@/types';
import styles from './page.module.css';

export default function Home() {
  const [recent, setRecent] = useState<Post[]>([]);
  const [weekly, setWeekly] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/posts')
      .then((res) => res.json())
      .then((data) => {
        setRecent(data.recent ?? []);
        setWeekly(data.weekly ?? []);
      })
      .catch((err) => console.error('Failed to load posts:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.page}>

      {/* ── Header: GIF above title image, both centered ── */}
      <header className={styles.header}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.gifAbove}
          src="/ezgif.com-reverse.gif"
          alt=""
          aria-hidden="true"
        />
        <Image
          className={styles.titleImage}
          src="/trumptitleFIX.png"
          alt="Trump Dump"
          width={2000}
          height={1000}
          priority
        />
      </header>

      {/* ── Description ── */}
      <p className={styles.description}>
        Trump&apos;s words carry some weight in the stock market, kinda. Here, we map Mr. President&apos;s latest Truth Social posts onto directional changes to stock tickers. The direction and magnitude are based on precedence (<Link href="/ml" className={styles.mlLink}>through ML</Link>).
      </p>

      {/* ── Recent Posts ── */}
      <div className={styles.sectionLabel}>
        <Image
          src="/recent-posts-text.png"
          alt="Recent Posts"
          width={1600}
          height={200}
        />
      </div>

      <main className={styles.content}>
        {loading && <p className={styles.loadingText}>Loading posts…</p>}
        {!loading && recent.length === 0 && (
          <p className={styles.emptyText}>No recent posts yet.</p>
        )}
        {recent.map((post) => (
          <PostBox key={post.id} {...post} />
        ))}
      </main>

      {/* ── Weekly Top 5 ── */}
      <div className={styles.sectionLabel}>
        <Image
          src="/weekly-picks-text.png"
          alt="Weekly Picks"
          width={1600}
          height={200}
        />
      </div>

      <main className={styles.content}>
        {loading && <p className={styles.loadingText}>Loading posts…</p>}
        {!loading && weekly.length === 0 && (
          <p className={styles.emptyText}>No weekly posts yet.</p>
        )}
        {weekly.map((post) => (
          <PostBox key={post.id} {...post} />
        ))}
      </main>

    </div>
  );
}
