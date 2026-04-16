'use client';

import { useEffect, useState } from 'react';
import styles from './TrajectoryChart.module.css'; // reuse same wrapper/loading styles

// ── Types ──────────────────────────────────────────────────────────────────────

interface TrajectoryData {
  sector_ar60_positive: Record<string, number>;
}

// ── Constants — MUST match TrajectoryChart viewBox exactly ────────────────────
const COLOR_POS  = '#71BC78';   // green  → positive AR (right bar)
const COLOR_NEG  = '#B31B1B';   // red    → negative AR (left bar)

const SVG_W   = 900;
const SVG_H   = 480;
const PAD     = { top: 48, right: 100, bottom: 60, left: 190 };
const CHART_W = SVG_W - PAD.left - PAD.right;
const CHART_H = SVG_H - PAD.top  - PAD.bottom;

// ── Component ──────────────────────────────────────────────────────────────────

export default function DivergingBarChart() {
  const [raw, setRaw] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/trajectory_data.json')
      .then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.json() as Promise<TrajectoryData>;
      })
      .then((d) => setRaw(d.sector_ar60_positive))
      .catch(() => setError(true));
  }, []);

  if (error) return <p className={styles.loadingText}>Chart data unavailable.</p>;
  if (!raw)  return <p className={styles.loadingText}>Loading chart…</p>;

  // Sort sectors ascending by value (most negative at top, most positive at bottom)
  const sectors = Object.entries(raw).sort((a, b) => a[1] - b[1]);
  const n = sectors.length;

  const values  = sectors.map(([, v]) => v);
  const absMax  = Math.max(...values.map(Math.abs), 1);
  const scale   = (absMax * 1.25);   // add 25% padding beyond extremes

  // X: map bps value to SVG x coordinate (zero = PAD.left + CHART_W/2)
  const zeroX = PAD.left + CHART_W / 2;
  function bpsToX(bps: number) {
    return zeroX + (bps / scale) * (CHART_W / 2);
  }

  // Y: evenly distribute sectors
  const rowH   = CHART_H / n;
  const barH   = Math.max(Math.min(rowH * 0.55, 32), 12);
  function rowY(i: number) {
    return PAD.top + i * rowH + rowH / 2;
  }

  // Grid lines at nice bps intervals
  const gridStep = absMax > 15 ? 5 : absMax > 8 ? 2 : 1;
  const gridVals: number[] = [];
  for (let v = -Math.ceil(scale / gridStep) * gridStep; v <= scale + 0.01; v += gridStep) {
    gridVals.push(parseFloat(v.toFixed(4)));
  }

  return (
    <div className={styles.chartWrap}>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        className={styles.svg}
        aria-label="Diverging bar chart: AR_60 by sector for positive Trump posts"
      >
        <defs>
          <style>{`text { font-family: var(--font-pixelify), monospace; }`}</style>
        </defs>

        {/* ── Background ──────────────────────────────────────────────────── */}
        <rect
          x={PAD.left} y={PAD.top}
          width={CHART_W} height={CHART_H}
          fill="#fafafa"
          shapeRendering="crispEdges"
        />

        {/* ── Vertical grid lines ──────────────────────────────────────────── */}
        {gridVals.map((v) => {
          const x = bpsToX(v);
          if (x < PAD.left || x > PAD.left + CHART_W) return null;
          const isZero = Math.abs(v) < 0.001;
          return (
            <g key={v}>
              <line
                x1={x} x2={x}
                y1={PAD.top} y2={PAD.top + CHART_H}
                stroke={isZero ? '#000' : '#d4d4d4'}
                strokeWidth={isZero ? 1.5 : 1}
                strokeDasharray={isZero ? 'none' : '4 3'}
                shapeRendering="crispEdges"
              />
              <text
                x={x}
                y={PAD.top + CHART_H + 20}
                textAnchor="middle"
                fontSize={11}
                fill={isZero ? '#000' : '#888'}
                fontWeight={isZero ? 700 : 400}
              >
                {v > 0 ? `+${v}` : v === 0 ? '0' : v}
              </text>
            </g>
          );
        })}

        {/* ── Bars ─────────────────────────────────────────────────────────── */}
        {sectors.map(([sector, bps], i) => {
          const cy   = rowY(i);
          const barY = cy - barH / 2;
          const x0   = bpsToX(0);
          const x1   = bpsToX(bps);
          const barX = Math.min(x0, x1);
          const barW = Math.abs(x1 - x0);
          const color = bps >= 0 ? COLOR_POS : COLOR_NEG;

          return (
            <g key={sector}>
              {/* Bar */}
              <rect
                x={barX} y={barY}
                width={Math.max(barW, 1)} height={barH}
                fill={color}
                shapeRendering="crispEdges"
              />
              {/* Sector label (left of chart) */}
              <text
                x={PAD.left - 8}
                y={cy + 4}
                textAnchor="end"
                fontSize={12}
                fill="#222"
              >
                {sector}
              </text>
              {/* Value label at bar tip */}
              <text
                x={bps >= 0 ? x1 + 5 : x1 - 5}
                y={cy + 4}
                textAnchor={bps >= 0 ? 'start' : 'end'}
                fontSize={11}
                fill={color}
                fontWeight={700}
              >
                {bps > 0 ? `+${bps.toFixed(1)}` : bps.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* ── X-axis title ─────────────────────────────────────────────────── */}
        <text
          x={PAD.left + CHART_W / 2}
          y={SVG_H - 6}
          textAnchor="middle"
          fontSize={13}
          fill="#444"
        >
          AR_60 (basis points) — positive posts only
        </text>

        {/* ── Y-axis title ─────────────────────────────────────────────────── */}
        <text
          x={14} y={PAD.top + CHART_H / 2}
          textAnchor="middle"
          fontSize={12}
          fill="#444"
          transform={`rotate(-90, 14, ${PAD.top + CHART_H / 2})`}
        >
          Sector ETF
        </text>

        {/* ── Chart border ─────────────────────────────────────────────────── */}
        <rect
          x={PAD.left} y={PAD.top}
          width={CHART_W} height={CHART_H}
          fill="none"
          stroke="#000"
          strokeWidth={1.5}
          shapeRendering="crispEdges"
        />

        {/* ── Legend ───────────────────────────────────────────────────────── */}
        {[
          { color: COLOR_NEG, label: 'Negative AR_60' },
          { color: COLOR_POS, label: 'Positive AR_60' },
        ].map(({ color, label }, i) => {
          const lx = PAD.left + CHART_W - 178;
          const ly = PAD.top + 10 + i * 22;
          return (
            <g key={label}>
              <rect x={lx} y={ly} width={12} height={12} fill={color} shapeRendering="crispEdges" />
              <text x={lx + 18} y={ly + 10} fontSize={12} fill="#222">{label}</text>
            </g>
          );
        })}

        {/* ── Annotation ────────────────────────────────────────────────────── */}
        <text x={PAD.left + 8} y={PAD.top + 14} fontSize={11} fill="#555" fontWeight={700}>
          Positive posts only  ·  60-min window
        </text>
      </svg>
    </div>
  );
}
