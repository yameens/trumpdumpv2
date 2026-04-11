import Image from 'next/image';
import styles from './PostBox.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PostBoxProps {
  content: string;
  confidence: number;
  sentiment: 'bullish' | 'bearish';
  industry: string;
  tickers: string[];
  timestamp: string;
}

// ── Assets ────────────────────────────────────────────────────────────────────

const TRUMP_PHOTOS = [
  '2ad31cdb60c2a4d218efa6320d52a075.png',
  '534ceee6bbe2671091bd0e9c63a5556d.png',
  '607719-djt-removebg-preview.png',
  'finaltrump.png',
  'image-removebg-preview.png',
  'rs-206809-GettyImages-484701034-.png',
];

// ── Verdict helper ─────────────────────────────────────────────────────────────

function getVerdict(sentiment: 'bullish' | 'bearish', confidence: number): string {
  if (sentiment === 'bullish') {
    return confidence >= 60 ? 'Strong Buy' : 'Buy';
  }
  return confidence >= 60 ? 'Strong Sell' : 'Sell';
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function PostBox({
  content,
  confidence,
  sentiment,
  industry,
  tickers,
  timestamp,
}: PostBoxProps) {
  const photo = TRUMP_PHOTOS[Math.floor(Math.random() * TRUMP_PHOTOS.length)];
  const verdict = getVerdict(sentiment, confidence);
  const date = new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className={styles.wrapper}>

      {/* ── Card: two-column flex ── */}
      <article className={styles.postBox}>

        {/* Left 70%: quote + date + signature */}
        <div className={styles.textColumn}>
          <blockquote className={styles.quote}>
            <span className={styles.openQuote}>&ldquo;</span>
            {content}
            <span className={styles.closeQuote}>&rdquo;</span>
          </blockquote>
          {/* Date + Signature on the same row */}
          <div className={styles.dateSigRow}>
            <p className={styles.date}>{date}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.signature}
              src="/trump-singature.png"
              alt="Trump signature"
            />
          </div>
        </div>

        {/* Right 30%: Trump photo, bottom of photo = bottom of card */}
        <div className={styles.photoColumn}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.bottomPhoto}
            src={`/trump-box-photos/${photo}`}
            alt="Donald Trump"
          />
        </div>

      </article>

      {/* ── Stats — plain text OUTSIDE the card ── */}
      <div className={styles.stats}>

        <div className={styles.statCell}>
          <span className={styles.statLabel}>Confidence</span>
          <span className={styles.statValue} title={`${confidence}/100`}>
            {confidence}<span className={styles.unit}>/100</span>
          </span>
        </div>

        <div className={styles.statCell}>
          <span className={styles.statLabel}>Ticker</span>
          <span className={styles.statValue} title={tickers.length > 0 ? tickers.join(', ') : '—'}>
            {tickers.length > 0 ? tickers.join(', ') : '—'}
          </span>
        </div>

        <div className={styles.statCell}>
          <span className={styles.statLabel}>Sentiment</span>
          <span className={styles.statValue} title={sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}>
            {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
          </span>
        </div>

        <div className={styles.statCell}>
          <span className={styles.statLabel}>Industry</span>
          <span className={styles.statValue} title={industry}>{industry}</span>
        </div>

        {/* Verdict — second to last, right before the image */}
        <div className={styles.statCell}>
          <span className={styles.statLabel}>Verdict</span>
          <span className={styles.statValue} title={verdict}>{verdict}</span>
        </div>

        {/* Sentiment image — vertically centered in the cell height */}
        <div className={`${styles.statCell} ${styles.imageCell}`}>
          <Image
            className={styles.sentimentImage}
            src={sentiment === 'bullish' ? '/bullish-image.png' : '/bearish-image.png'}
            alt={sentiment}
            width={sentiment === 'bullish' ? 616 : 1244}
            height={sentiment === 'bullish' ? 428 : 864}
          />
        </div>

      </div>
    </div>
  );
}
