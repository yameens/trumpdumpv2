'use client';

import { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import styles from './page.module.css';

// ── Lazy-load all charts (SVG + fetch, client only) ───────────────────────────
const TrajectoryChart = dynamic(() => import('@/components/TrajectoryChart'), {
  ssr: false,
  loading: () => <p className={styles.loadingText}>Loading chart…</p>,
});
const DivergingBarChart = dynamic(() => import('@/components/DivergingBarChart'), {
  ssr: false,
  loading: () => <p className={styles.loadingText}>Loading chart…</p>,
});
const ScatterPlot = dynamic(() => import('@/components/ScatterPlot'), {
  ssr: false,
  loading: () => <p className={styles.loadingText}>Loading chart…</p>,
});
const SlopegraphChart = dynamic(() => import('@/components/SlopegraphChart'), {
  ssr: false,
  loading: () => <p className={styles.loadingText}>Loading chart…</p>,
});
const ClassifierChart = dynamic(() => import('@/components/ClassifierChart'), {
  ssr: false,
  loading: () => <p className={styles.loadingText}>Loading chart…</p>,
});

// ── Finding card data ─────────────────────────────────────────────────────────

interface FindingCard {
  color: string;
  title: string;
  body: string;
}

const TRAJECTORY_FINDINGS: FindingCard[] = [
  {
    color: '#71BC78',
    title: 'Negative posts',
    body: 'Sector ETFs trend above SPY for the full hour. The move persists and grows — real repricing of policy risk, not HFT noise.',
  },
  {
    color: '#888888',
    title: 'Neutral posts',
    body: 'Slight pop in the first 5 minutes, then flat. Classic noise pattern — fast reversion with no sustained direction.',
  },
  {
    color: '#B31B1B',
    title: 'Positive posts',
    body: 'Sector ETFs sink below SPY and keep falling for 60 minutes. Political cheerleading reads as noise — the market discounts it.',
  },
];

const DIVERGING_FINDINGS: FindingCard[] = [
  {
    color: '#71BC78',
    title: 'Energy & Utilities',
    body: 'The only two sectors with positive AR_60 after a positive Trump post (+10.1 and +23.9 bps). Pro-energy rhetoric is read as a deregulation signal.',
  },
  {
    color: '#B31B1B',
    title: 'Communications & Staples',
    body: 'Hardest hit at 60 min. Media-adjacent positive posts (−18.7 bps) and food/consumer brands (−16.7 bps) tank relative to SPY.',
  },
  {
    color: '#888888',
    title: 'The wall of red',
    body: '9 of 12 sectors show negative AR_60 after positive posts. Political cheerleading does not move sectors up — the market discounts it.',
  },
];

const SCATTER_FINDINGS: FindingCard[] = [
  {
    color: '#000000',
    title: 'r = 0.70 correlation',
    body: 'The 10-minute abnormal return predicts the 60-minute outcome with 70% Pearson correlation. The 10-min signal is not noise — it is a leading indicator.',
  },
  {
    color: '#71BC78',
    title: 'Slope > 1.0×',
    body: 'OLS slope of 1.03 means the effect amplifies rather than fades. Algo reactions are not erased by human traders an hour later — they compound them.',
  },
  {
    color: '#B31B1B',
    title: 'Dots above the 45° line',
    body: 'For negative-sentiment posts (green), most dots sit above y = x, confirming the effect grew from 10 to 60 minutes. Genuine information absorption.',
  },
];

const SLOPEGRAPH_FINDINGS: FindingCard[] = [
  {
    color: '#71BC78',
    title: 'Negative posts gain momentum',
    body: '+0.56 bps at T+10 → +1.79 bps at T+60. The initial outperformance above SPY triples over the hour — real repricing of policy risk, not mean-reversion.',
  },
  {
    color: '#B31B1B',
    title: 'Positive posts keep falling',
    body: '−1.81 bps at T+10 → −4.07 bps at T+60. Political cheerleading doesn\'t just get ignored — it actively drags sectors below SPY and the gap widens.',
  },
  {
    color: '#888888',
    title: 'Neutral converges to zero',
    body: '+0.41 bps at T+10 → −0.08 bps at T+60. Classic noise: a small initial pop fully reverts, with no sustained direction or information content.',
  },
];

const CLASSIFIER_FINDINGS: FindingCard[] = [
  {
    color: '#000000',
    title: '71% CV accuracy vs 47% baseline',
    body: '5-fold cross-validation accuracy of 71.0% against a 47.4% majority-class baseline — a 24-point lift that proves the model is learning genuine signal, not just memorising.',
  },
  {
    color: '#71BC78',
    title: 'Sector is the dominant predictor',
    body: '64% of XGBoost\'s decision weight comes from which sector the post addresses. The words matter less than the context — Energy posts behave completely differently from Communications posts.',
  },
  {
    color: '#888888',
    title: 'Sentiment adds independent signal',
    body: 'At 8% importance, the RoBERTa sentiment label contributes on top of sector and timing. It\'s not redundant — it captures tone that sector alone can\'t explain.',
  },
];

// ── Chart registry ────────────────────────────────────────────────────────────

const CHARTS = [
  {
    component: TrajectoryChart,
    subtitle: 'minute-by-minute',
    findings: TRAJECTORY_FINDINGS,
    intro:
      "Average Cumulative Abnormal Return (CAR) in the 10 minutes before and 60 minutes after each of Trump\u2019s 3,817 financially relevant Truth Social posts \u2014 grouped by sentiment. CAR = sector ETF return minus SPY return, measured in basis points (bps).",
  },
  {
    component: DivergingBarChart,
    subtitle: 'sector breakdown',
    findings: DIVERGING_FINDINGS,
    intro:
      "Mean AR_60 for each GICS sector when Trump posts something positive-toned. Bars left of zero (red) underperform SPY; bars right of zero (green) outperform. Sorted by magnitude.",
  },
  {
    component: ScatterPlot,
    subtitle: 'signal persistence',
    findings: SCATTER_FINDINGS,
    intro:
      "Every post plotted as AR\u2081\u2080 (x) vs AR\u2086\u2080 (y), coloured by sentiment. The dashed line is y\u202f=\u202fx (no change). The black line is the OLS trendline. Points above the dashed line amplified; points below faded.",
  },
  {
    component: SlopegraphChart,
    subtitle: 'the jaws effect',
    findings: SLOPEGRAPH_FINDINGS,
    intro:
      "Mean abnormal return for each sentiment group at two snapshots: T\u202f+\u202f10 and T\u202f+\u202f60 minutes. Upward slopes mean momentum; downward slopes mean deepening loss. Neutral converges to zero.",
  },
  {
    component: ClassifierChart,
    subtitle: 'can we predict it?',
    findings: CLASSIFIER_FINDINGS,
    intro:
      "XGBoost classifier trained on 3,784 posts to predict whether the target sector will outperform SPY (up), underperform (down), or stay flat at T\u202f+\u202f60 min. Features: sector, market period, sentiment, hour, and day of week.",
  },
];

const N = CHARTS.length;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MLPage() {
  const [idx, setIdx] = useState(0);

  const prev = () => setIdx((i) => (i - 1 + N) % N);
  const next = () => setIdx((i) => (i + 1) % N);

  const { subtitle, findings, intro } = CHARTS[idx];

  return (
    <div className={styles.page}>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className={styles.nav}>
        <Link href="/" className={styles.backLink}>← back</Link>
      </nav>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <h1 className={styles.title}>MARKET REACTION</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </header>

      {/* ── Intro (swaps per chart) ──────────────────────────────────────────── */}
      <p className={styles.intro}>{intro}</p>

      {/* ── Carousel ─────────────────────────────────────────────────────────── */}
      <div className={styles.carousel}>
        <button onClick={prev} className={styles.arrowBtn} aria-label="Previous chart">◀</button>

        {/*
          Both charts are always mounted so they load once and never collapse.
          The active chart is position:relative (takes up space + full opacity).
          The inactive chart is position:absolute overlapping it (opacity 0).
          CSS transition fades between them with zero layout shift.
        */}
        <div className={styles.chartArea}>
          {CHARTS.map(({ component: C }, i) => (
            <div key={i} className={i === idx ? styles.chartVisible : styles.chartHidden}>
              <C />
            </div>
          ))}
        </div>

        <button onClick={next} className={styles.arrowBtn} aria-label="Next chart">▶</button>
      </div>

      {/* ── Chart indicator dots ─────────────────────────────────────────────── */}
      <div className={styles.dots}>
        {CHARTS.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={i === idx ? `${styles.dot} ${styles.dotActive}` : styles.dot}
            aria-label={`Chart ${i + 1}`}
          />
        ))}
      </div>

      {/* ── Finding cards (swap per chart, fixed count = 3) ─────────────────── */}
      <section className={styles.findings}>
        {findings.map((f) => (
          <div key={f.title} className={styles.findingCard} style={{ borderColor: f.color }}>
            <span className={styles.findingDot} style={{ background: f.color }} />
            <div>
              <strong>{f.title}</strong>
              <p>{f.body}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── Methodology note ─────────────────────────────────────────────────── */}
      <p className={styles.methodology}>
        Data: 2022–2025 · 1-min bars via EODHD · baseline = last bar before post ·
        sentiment via Twitter RoBERTa · 99.2% intraday coverage across 801 trading days.
      </p>

    </div>
  );
}
