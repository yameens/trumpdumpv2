'use client';

import { useEffect, useState } from 'react';
import styles from './TrajectoryChart.module.css';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TrajectoryData {
  minutes: number[];
  negative: number[];
  neutral: number[];
  positive: number[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COLOR_NEGATIVE = '#71BC78';
const COLOR_POSITIVE = '#B31B1B';
const COLOR_NEUTRAL  = '#888888';

const SVG_W  = 900;
const SVG_H  = 480;
const PAD    = { top: 48, right: 32, bottom: 60, left: 72 };
const CHART_W = SVG_W - PAD.left - PAD.right;
const CHART_H = SVG_H - PAD.top  - PAD.bottom;

// ── Scale helpers ──────────────────────────────────────────────────────────────

function xScale(minute: number, minutes: number[]): number {
  const min = minutes[0];
  const max = minutes[minutes.length - 1];
  return PAD.left + ((minute - min) / (max - min)) * CHART_W;
}

function yScale(bps: number, yMin: number, yMax: number): number {
  return PAD.top + CHART_H - ((bps - yMin) / (yMax - yMin)) * CHART_H;
}

function buildPolyline(
  minutes: number[],
  values: number[],
  yMin: number,
  yMax: number,
): string {
  return values
    .map((v, i) => `${xScale(minutes[i], minutes).toFixed(1)},${yScale(v, yMin, yMax).toFixed(1)}`)
    .join(' ');
}

// ── Grid helpers ───────────────────────────────────────────────────────────────

function niceGridLines(yMin: number, yMax: number, step: number): number[] {
  const lines: number[] = [];
  const start = Math.ceil(yMin / step) * step;
  for (let v = start; v <= yMax + 0.001; v += step) {
    lines.push(parseFloat(v.toFixed(4)));
  }
  return lines;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function TrajectoryChart() {
  const [data, setData] = useState<TrajectoryData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/trajectory_data.json')
      .then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <p className={styles.loadingText}>Chart data unavailable.</p>;
  if (!data)  return <p className={styles.loadingText}>Loading chart…</p>;

  const allValues = [...data.negative, ...data.neutral, ...data.positive];
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const padding = (rawMax - rawMin) * 0.18 || 2;
  const yMin = rawMin - padding;
  const yMax = rawMax + padding;

  const gridStep = (() => {
    const range = yMax - yMin;
    if (range <= 6)   return 1;
    if (range <= 15)  return 2;
    if (range <= 40)  return 5;
    if (range <= 100) return 10;
    return 25;
  })();
  const gridLines = niceGridLines(yMin, yMax, gridStep);
  const zeroY = yScale(0, yMin, yMax);

  const xTickMinutes = [-10, -5, 0, 10, 20, 30, 40, 50, 60];

  const lines = [
    { key: 'negative', values: data.negative, color: COLOR_NEGATIVE, label: 'Negative posts' },
    { key: 'neutral',  values: data.neutral,  color: COLOR_NEUTRAL,  label: 'Neutral posts'  },
    { key: 'positive', values: data.positive, color: COLOR_POSITIVE, label: 'Positive posts' },
  ];

  return (
    <div className={styles.chartWrap}>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        className={styles.svg}
        aria-label="Minute-by-minute cumulative abnormal return by post sentiment"
      >
        {/* ── Pixel font declaration ──────────────────────────────────────── */}
        <defs>
          <style>{`text { font-family: var(--font-pixelify), monospace; }`}</style>
        </defs>

        {/* ── Chart area background ───────────────────────────────────────── */}
        <rect
          x={PAD.left} y={PAD.top}
          width={CHART_W} height={CHART_H}
          fill="#fafafa"
          shapeRendering="crispEdges"
        />

        {/* ── Horizontal grid lines ────────────────────────────────────────── */}
        {gridLines.map((v) => {
          const y = yScale(v, yMin, yMax);
          const isZero = Math.abs(v) < 0.001;
          return (
            <g key={v}>
              <line
                x1={PAD.left} x2={PAD.left + CHART_W}
                y1={y} y2={y}
                stroke={isZero ? '#000' : '#d4d4d4'}
                strokeWidth={isZero ? 1.5 : 1}
                strokeDasharray={isZero ? 'none' : '4 4'}
                shapeRendering="crispEdges"
              />
              <text
                x={PAD.left - 8} y={y + 4}
                textAnchor="end"
                fontSize={13}
                fill={isZero ? '#000' : '#888'}
                fontWeight={isZero ? 700 : 400}
              >
                {v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* ── Vertical tick lines (every 10 min + T=0) ─────────────────────── */}
        {xTickMinutes.map((m) => {
          const x = xScale(m, data.minutes);
          const isZero = m === 0;
          return (
            <line
              key={m}
              x1={x} x2={x}
              y1={PAD.top} y2={PAD.top + CHART_H}
              stroke={isZero ? '#000' : '#e2e2e2'}
              strokeWidth={isZero ? 1.5 : 1}
              strokeDasharray={isZero ? 'none' : '3 3'}
              shapeRendering="crispEdges"
            />
          );
        })}

        {/* ── Data lines + pixel markers ───────────────────────────────────── */}
        {lines.map(({ key, values, color }) => (
          <g key={key}>
            {/* Line (polyline with no smoothing = pure angular pixel path) */}
            <polyline
              points={buildPolyline(data.minutes, values, yMin, yMax)}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinejoin="miter"
              shapeRendering="crispEdges"
            />
            {/* Pixel-square markers every 5 minutes */}
            {values.map((v, i) => {
              if (data.minutes[i] % 5 !== 0) return null;
              const cx = xScale(data.minutes[i], data.minutes);
              const cy = yScale(v, yMin, yMax);
              return (
                <rect
                  key={i}
                  x={cx - 3} y={cy - 3}
                  width={6} height={6}
                  fill={color}
                  shapeRendering="crispEdges"
                />
              );
            })}
          </g>
        ))}

        {/* ── X-axis labels ────────────────────────────────────────────────── */}
        {xTickMinutes.map((m) => {
          const x = xScale(m, data.minutes);
          const label = m === 0 ? 'T₀' : m < 0 ? `T${m}` : `T+${m}`;
          return (
            <text
              key={m}
              x={x} y={PAD.top + CHART_H + 22}
              textAnchor="middle"
              fontSize={13}
              fill={m === 0 ? '#000' : '#555'}
              fontWeight={m === 0 ? 700 : 400}
            >
              {label}
            </text>
          );
        })}

        {/* ── Axis labels ──────────────────────────────────────────────────── */}
        {/* Y-axis title */}
        <text
          x={18} y={PAD.top + CHART_H / 2}
          textAnchor="middle"
          fontSize={13}
          fill="#444"
          transform={`rotate(-90, 18, ${PAD.top + CHART_H / 2})`}
        >
          Cumulative AR (bps)
        </text>
        {/* X-axis title */}
        <text
          x={PAD.left + CHART_W / 2}
          y={SVG_H - 6}
          textAnchor="middle"
          fontSize={13}
          fill="#444"
        >
          Minutes from post time (T₀)
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

        {/* ── Legend (top-right, pixel squares) ───────────────────────────── */}
        {lines.map(({ color, label }, i) => {
          const lx = PAD.left + CHART_W - 170;
          const ly = PAD.top + 16 + i * 24;
          return (
            <g key={label}>
              <rect x={lx} y={ly} width={12} height={12} fill={color} shapeRendering="crispEdges" />
              <text x={lx + 18} y={ly + 10} fontSize={13} fill="#222">{label}</text>
            </g>
          );
        })}

        {/* ── "Event" annotation at T=0 ────────────────────────────────────── */}
        <text
          x={xScale(0, data.minutes) + 5}
          y={PAD.top + 12}
          fontSize={11}
          fill="#000"
          fontWeight={700}
        >
          POST
        </text>
      </svg>
    </div>
  );
}
