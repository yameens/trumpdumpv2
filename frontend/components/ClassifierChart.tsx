'use client';

import { useEffect, useState } from 'react';
import styles from './ClassifierChart.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ClassData {
  n_samples:          number;
  threshold_bps:      number;
  accuracy:           number;
  baseline_accuracy:  number;
  cv_mean:            number;
  cv_std:             number;
  classes:            string[];
  per_class: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  confusion_matrix:   number[][];
  feature_importance: Record<string, number>;
}

// ── Chart geometry ────────────────────────────────────────────────────────────
const VW = 900, VH = 480;

// ── Left panel — grouped P/R/F1 bars ─────────────────────────────────────────
const L_X0 = 52, L_X1 = 420;
const L_Y0 = 70, L_Y1 = 390;
const L_PW = L_X1 - L_X0;   // 368
const L_PH = L_Y1 - L_Y0;   // 320

// ── Right panel — feature importance ─────────────────────────────────────────
const R_X0 = 590, R_X1 = 880;
const R_Y0 = 100, R_Y1 = 390;
const R_PW = R_X1 - R_X0;   // 401
const R_PH = R_Y1 - R_Y0;   // 290

const CLASS_COLORS: Record<string, string> = {
  down: '#71BC78',
  flat: '#888888',
  up:   '#B31B1B',
};

// Opacity levels per metric within each class group
const METRIC_OPACITY = { precision: 1.0, recall: 0.65, f1: 0.38 };

const FEAT_LABELS: Record<string, string> = {
  target_sector: 'sector',
  market_period: 'mkt period',
  tw_sentiment:  'sentiment',
  hour:          'hour',
  day_of_week:   'day of week',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function ClassifierChart() {
  const [data, setData] = useState<ClassData | null>(null);

  useEffect(() => {
    fetch('/classifier_data.json')
      .then((r) => r.json() as Promise<ClassData>)
      .then(setData);
  }, []);

  if (!data) return <p className={styles.loading}>Loading chart…</p>;

  const { cv_mean, cv_std, baseline_accuracy, per_class, feature_importance } = data;
  const classes  = ['down', 'flat', 'up'];
  const metrics  = ['precision', 'recall', 'f1'] as const;

  // ── Left panel layout ───────────────────────────────────────────────────────
  const nGroups  = classes.length;
  const nBars    = metrics.length;
  const gapGroup = 20;                               // px between groups
  const gapBar   = 3;                                // px between bars in a group
  const groupW   = (L_PW - (nGroups - 1) * gapGroup) / nGroups;   // ~109px
  const barW     = (groupW - (nBars - 1) * gapBar) / nBars;        // ~35px

  function lBarX(gi: number, bi: number) {
    return L_X0 + gi * (groupW + gapGroup) + bi * (barW + gapBar);
  }
  function lBarY(val: number) { return L_Y0 + (1 - val) * L_PH; }
  function lBarH(val: number) { return val * L_PH; }

  // ── Right panel layout ──────────────────────────────────────────────────────
  const featEntries = Object.entries(feature_importance);  // already sorted desc
  const maxFeat     = featEntries[0][1];
  const barH        = 36;
  const barGap      = 16;

  function rBarW(val: number) { return (val / (maxFeat * 1.08)) * R_PW; }
  function rBarY(i: number)   { return R_Y0 + i * (barH + barGap); }

  // ── Y-axis ticks (left panel) ───────────────────────────────────────────────
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];

  return (
    <div className={styles.wrap}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        className={styles.svg}
        style={{ shapeRendering: 'crispEdges', imageRendering: 'pixelated' }}
      >

        {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}

        {/* Panel title */}
        <text x={(L_X0 + L_X1) / 2} y={20}
          textAnchor="middle" fontSize={13} fontWeight="bold"
          fontFamily="var(--font-pixelify), monospace" fill="#000">
          precision / recall / f1  by  class
        </text>

        {/* Accuracy badge */}
        <rect x={L_X0} y={28} width={L_PW} height={26}
          fill="#000" />
        <text x={(L_X0 + L_X1) / 2} y={45}
          textAnchor="middle" fontSize={12}
          fontFamily="var(--font-pixelify), monospace" fill="#fff">
          {(cv_mean * 100).toFixed(1)}% CV accuracy
          {'  '}vs{'  '}
          {(baseline_accuracy * 100).toFixed(1)}% baseline
          {'  '}·{'  '}±{(cv_std * 100).toFixed(1)}%
        </text>

        {/* Grid lines */}
        {yTicks.map((t) => (
          <line key={`gl${t}`}
            x1={L_X0} y1={lBarY(t)} x2={L_X1} y2={lBarY(t)}
            stroke={t === 0 ? '#000' : '#e0e0e0'} strokeWidth={t === 0 ? 1.5 : 1}
          />
        ))}
        {/* Left axis */}
        <line x1={L_X0} y1={L_Y0} x2={L_X0} y2={L_Y1} stroke="#000" strokeWidth={2} />

        {/* Y-axis ticks + labels */}
        {yTicks.map((t) => (
          <g key={`yt${t}`}>
            <line x1={L_X0 - 4} y1={lBarY(t)} x2={L_X0} y2={lBarY(t)}
              stroke="#000" strokeWidth={1.5} />
            <text x={L_X0 - 7} y={lBarY(t) + 4}
              textAnchor="end" fontSize={10}
              fontFamily="var(--font-pixelify), monospace" fill="#555">
              {t === 0 ? '0' : t === 1 ? '1' : t.toFixed(2).replace('0.', '.')}
            </text>
          </g>
        ))}

        {/* Bars + class labels */}
        {classes.map((cls, gi) => {
          const color = CLASS_COLORS[cls];
          const groupCx = L_X0 + gi * (groupW + gapGroup) + groupW / 2;
          return (
            <g key={cls}>
              {/* Class label below axis */}
              <text x={groupCx} y={L_Y1 + 16}
                textAnchor="middle" fontSize={12} fontWeight="bold"
                fontFamily="var(--font-pixelify), monospace" fill={color}>
                {cls}
              </text>

              {metrics.map((metric, bi) => {
                const val = per_class[cls][metric];
                const bx  = lBarX(gi, bi);
                const by  = lBarY(val);
                const bh  = lBarH(val);
                return (
                  <g key={metric}>
                    <rect
                      x={bx} y={by} width={barW} height={bh}
                      fill={color} opacity={METRIC_OPACITY[metric]}
                    />
                    {/* Value label on top of bar (only if bar tall enough) */}
                    {bh > 22 && (
                      <text x={bx + barW / 2} y={by + 13}
                        textAnchor="middle" fontSize={9}
                        fontFamily="var(--font-pixelify), monospace"
                        fill="#fff">
                        {(val * 100).toFixed(0)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Metric legend (P / R / F1 opacities) */}
        {(['precision', 'recall', 'f1'] as const).map((m, i) => {
          const lx = L_X0 + i * 80;
          const ly = L_Y1 + 36;
          return (
            <g key={m}>
              <rect x={lx} y={ly - 8} width={14} height={14}
                fill="#555" opacity={METRIC_OPACITY[m]} />
              <text x={lx + 18} y={ly + 3}
                fontSize={10} fontFamily="var(--font-pixelify), monospace"
                fill="#555">
                {m === 'f1' ? 'F1' : m.charAt(0).toUpperCase() + m.slice(1)}
              </text>
            </g>
          );
        })}

        {/* ══ DIVIDER ════════════════════════════════════════════════════════ */}
        <line x1={448} y1={20} x2={448} y2={VH - 20}
          stroke="#e0e0e0" strokeWidth={1.5} strokeDasharray="4 3" />

        {/* ══ RIGHT PANEL ═════════════════════════════════════════════════════ */}

        {/* Panel title */}
        <text x={(R_X0 + R_X1) / 2} y={20}
          textAnchor="middle" fontSize={13} fontWeight="bold"
          fontFamily="var(--font-pixelify), monospace" fill="#000">
          feature  importance
        </text>

        {/* Subtitle */}
        <text x={(R_X0 + R_X1) / 2} y={38}
          textAnchor="middle" fontSize={10}
          fontFamily="var(--font-pixelify), monospace" fill="#888">
          XGBoost gain · what the model actually uses
        </text>

        {/* Bottom axis */}
        <line x1={R_X0} y1={R_Y1} x2={R_X1} y2={R_Y1}
          stroke="#000" strokeWidth={2} />

        {/* Bars */}
        {featEntries.map(([feat, val], i) => {
          const bw = rBarW(val);
          const by = rBarY(i);
          const isTop = i === 0;
          return (
            <g key={feat}>
              {/* Feature label */}
              <text x={R_X0 - 6} y={by + barH / 2 + 4}
                textAnchor="end" fontSize={11}
                fontFamily="var(--font-pixelify), monospace" fill="#333">
                {FEAT_LABELS[feat] ?? feat}
              </text>

              {/* Bar */}
              <rect x={R_X0} y={by} width={bw} height={barH}
                fill={isTop ? '#71BC78' : '#aaaaaa'} />

              {/* Value label */}
              <text x={R_X0 + bw + 5} y={by + barH / 2 + 4}
                textAnchor="start" fontSize={11}
                fontFamily="var(--font-pixelify), monospace"
                fill={isTop ? '#71BC78' : '#666'} fontWeight={isTop ? 'bold' : 'normal'}>
                {(val * 100).toFixed(1)}%
              </text>
            </g>
          );
        })}

        {/* "sector dominates" callout arrow */}
        <text x={R_X0 + rBarW(featEntries[0][1]) / 2} y={rBarY(0) - 5}
          textAnchor="middle" fontSize={9}
          fontFamily="var(--font-pixelify), monospace" fill="#71BC78">
          dominates
        </text>

      </svg>
    </div>
  );
}
