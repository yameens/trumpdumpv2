'use client';

import { useEffect, useState } from 'react';
import styles from './SlopegraphChart.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SlopeEntry { ar10: number; ar60: number; n: number; }
interface SlopeData {
  negative: SlopeEntry;
  neutral:  SlopeEntry;
  positive: SlopeEntry;
}
interface TrajData { slopegraph_data: SlopeData; }

// ── Chart geometry ────────────────────────────────────────────────────────────
const VW = 900, VH = 480;
// Two axis columns
const AX_LEFT  = 280;    // x for "T+10 min" axis
const AX_RIGHT = 620;    // x for "T+60 min" axis
const AXIS_TOP  = 60;
const AXIS_BOT  = 400;
const AXIS_H    = AXIS_BOT - AXIS_TOP;

// Y range in bps — cover negative→positive with padding
const Y_MIN = -6.0;
const Y_MAX =  3.5;
const Y_SPAN = Y_MAX - Y_MIN;

function toY(bps: number) {
  return AXIS_TOP + ((Y_MAX - bps) / Y_SPAN) * AXIS_H;
}

const COLORS: Record<string, string> = {
  negative: '#71BC78',
  neutral:  '#888888',
  positive: '#B31B1B',
};

const SENTIMENTS = ['negative', 'neutral', 'positive'] as const;
const YTICKS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3];

// ── Component ─────────────────────────────────────────────────────────────────
export default function SlopegraphChart() {
  const [data, setData] = useState<SlopeData | null>(null);

  useEffect(() => {
    fetch('/trajectory_data.json')
      .then((r) => r.json() as Promise<TrajData>)
      .then((d) => setData(d.slopegraph_data));
  }, []);

  if (!data) {
    return <p className={styles.loading}>Loading chart…</p>;
  }

  return (
    <div className={styles.wrap}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        className={styles.svg}
        style={{ shapeRendering: 'crispEdges', imageRendering: 'pixelated' }}
      >

        {/* ── Horizontal grid lines ─────────────────────────────────────────── */}
        {YTICKS.map((t) => {
          const y = toY(t);
          const isZero = t === 0;
          return (
            <line key={`g${t}`}
              x1={AX_LEFT} y1={y} x2={AX_RIGHT} y2={y}
              stroke={isZero ? '#555' : '#e8e8e8'}
              strokeWidth={isZero ? 1.5 : 1}
            />
          );
        })}

        {/* ── Left axis ticks + labels ──────────────────────────────────────── */}
        {YTICKS.map((t) => (
          <g key={`lt${t}`}>
            <line x1={AX_LEFT - 5} y1={toY(t)} x2={AX_LEFT} y2={toY(t)}
              stroke="#000" strokeWidth={1.5} />
            <text x={AX_LEFT - 9} y={toY(t) + 4}
              textAnchor="end" fontSize={11}
              fontFamily="var(--font-pixelify), monospace" fill="#555">
              {t === 0 ? '0' : `${t > 0 ? '+' : ''}${t}`}
            </text>
          </g>
        ))}

        {/* ── Right axis ticks ──────────────────────────────────────────────── */}
        {YTICKS.map((t) => (
          <line key={`rt${t}`}
            x1={AX_RIGHT} y1={toY(t)} x2={AX_RIGHT + 5} y2={toY(t)}
            stroke="#000" strokeWidth={1.5} />
        ))}

        {/* ── Axis lines ────────────────────────────────────────────────────── */}
        <line x1={AX_LEFT}  y1={AXIS_TOP} x2={AX_LEFT}  y2={AXIS_BOT}
          stroke="#000" strokeWidth={2} />
        <line x1={AX_RIGHT} y1={AXIS_TOP} x2={AX_RIGHT} y2={AXIS_BOT}
          stroke="#000" strokeWidth={2} />

        {/* ── Column headers ────────────────────────────────────────────────── */}
        <text x={AX_LEFT}  y={AXIS_TOP - 18}
          textAnchor="middle" fontSize={14} fontWeight="bold"
          fontFamily="var(--font-pixelify), monospace" fill="#000">
          T + 10 MIN
        </text>
        <text x={AX_RIGHT} y={AXIS_TOP - 18}
          textAnchor="middle" fontSize={14} fontWeight="bold"
          fontFamily="var(--font-pixelify), monospace" fill="#000">
          T + 60 MIN
        </text>

        {/* ── Y-axis unit label ─────────────────────────────────────────────── */}
        <text x={14} y={AXIS_TOP + AXIS_H / 2}
          textAnchor="middle" fontSize={12}
          fontFamily="var(--font-pixelify), monospace" fill="#555"
          transform={`rotate(-90, 14, ${AXIS_TOP + AXIS_H / 2})`}>
          avg  AR  (bps)
        </text>

        {/* ── Connecting slopes ─────────────────────────────────────────────── */}
        {SENTIMENTS.map((s) => {
          const color = COLORS[s];
          const y10  = toY(data[s].ar10);
          const y60  = toY(data[s].ar60);
          return (
            <line key={`slope${s}`}
              x1={AX_LEFT} y1={y10} x2={AX_RIGHT} y2={y60}
              stroke={color} strokeWidth={3}
            />
          );
        })}

        {/* ── Square endpoint markers + labels ──────────────────────────────── */}
        {SENTIMENTS.map((s) => {
          const color = COLORS[s];
          const y10  = toY(data[s].ar10);
          const y60  = toY(data[s].ar60);
          const v10  = data[s].ar10;
          const v60  = data[s].ar60;
          const label = s.charAt(0).toUpperCase() + s.slice(1);

          // Determine left/right label offset to avoid overlap
          const leftAnchor  = 'end';
          const rightAnchor = 'start';

          return (
            <g key={`end${s}`}>
              {/* Left dot */}
              <rect x={AX_LEFT  - 4} y={y10 - 4} width={8} height={8} fill={color} />
              {/* Right dot */}
              <rect x={AX_RIGHT - 4} y={y60 - 4} width={8} height={8} fill={color} />

              {/* Left labels */}
              <text x={AX_LEFT - 16} y={y10 - 6}
                textAnchor={leftAnchor} fontSize={12}
                fontFamily="var(--font-pixelify), monospace"
                fill={color} fontWeight="bold">
                {label}
              </text>
              <text x={AX_LEFT - 16} y={y10 + 9}
                textAnchor={leftAnchor} fontSize={11}
                fontFamily="var(--font-pixelify), monospace" fill={color}>
                {v10 > 0 ? '+' : ''}{v10.toFixed(2)} bps
              </text>

              {/* Right labels */}
              <text x={AX_RIGHT + 16} y={y60 - 6}
                textAnchor={rightAnchor} fontSize={12}
                fontFamily="var(--font-pixelify), monospace"
                fill={color} fontWeight="bold">
                {label}
              </text>
              <text x={AX_RIGHT + 16} y={y60 + 9}
                textAnchor={rightAnchor} fontSize={11}
                fontFamily="var(--font-pixelify), monospace" fill={color}>
                {v60 > 0 ? '+' : ''}{v60.toFixed(2)} bps
              </text>
            </g>
          );
        })}

        {/* ── Direction arrows in the middle ─────────────────────────────────── */}
        {SENTIMENTS.map((s) => {
          const y10 = toY(data[s].ar10);
          const y60 = toY(data[s].ar60);
          const mx  = (AX_LEFT + AX_RIGHT) / 2;
          const my  = (y10 + y60) / 2;
          const dir = y60 < y10 ? '↑' : y60 > y10 ? '↓' : '→';
          return (
            <text key={`arrow${s}`}
              x={mx} y={my + 5}
              textAnchor="middle" fontSize={16}
              fontFamily="var(--font-pixelify), monospace"
              fill={COLORS[s]}>
              {dir}
            </text>
          );
        })}

        {/* ── Subtitle ──────────────────────────────────────────────────────── */}
        <text x={VW / 2} y={VH - 10}
          textAnchor="middle" fontSize={11}
          fontFamily="var(--font-pixelify), monospace" fill="#aaa">
          mean CAR by sentiment · basis points above / below SPY
        </text>
      </svg>
    </div>
  );
}
