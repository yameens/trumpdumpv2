'use client';

import { useEffect, useState } from 'react';
import styles from './ScatterPlot.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ScatterData {
  clip_bps:      number;
  pearson_r:     number;
  reg_slope:     number;
  reg_intercept: number;
  points: {
    negative: [number, number][];
    neutral:  [number, number][];
    positive: [number, number][];
  };
}

interface TrajData {
  scatter_data: ScatterData;
}

// ── Chart constants ───────────────────────────────────────────────────────────
const VW = 900, VH = 480;
const ML = 72, MR = 24, MT = 28, MB = 56;   // margins
const PW = VW - ML - MR;                     // plot width  = 804
const PH = VH - MT - MB;                     // plot height = 396

const CLIP = 300;

function toX(bps: number) { return ML + ((bps + CLIP) / (2 * CLIP)) * PW; }
function toY(bps: number) { return MT + ((CLIP - bps) / (2 * CLIP)) * PH; }

const COLORS = {
  negative: '#71BC78',
  neutral:  '#888888',
  positive: '#B31B1B',
};

const TICKS = [-200, -100, 0, 100, 200];

// ── Component ─────────────────────────────────────────────────────────────────
export default function ScatterPlot() {
  const [data, setData] = useState<ScatterData | null>(null);

  useEffect(() => {
    fetch('/trajectory_data.json')
      .then((r) => r.json() as Promise<TrajData>)
      .then((d) => setData(d.scatter_data));
  }, []);

  if (!data) {
    return <p className={styles.loading}>Loading chart…</p>;
  }

  const { pearson_r, reg_slope, reg_intercept, points } = data;

  // 45° reference line endpoints (clipped to chart box)
  const ref45x1 = toX(-CLIP), ref45y1 = toY(-CLIP);
  const ref45x2 = toX(CLIP),  ref45y2 = toY(CLIP);

  // Regression line endpoints
  const regY = (x: number) => reg_slope * x + reg_intercept;
  const regX1 = -CLIP, regX2 = CLIP;
  const reg_x1 = toX(regX1), reg_y1 = toY(regY(regX1));
  const reg_x2 = toX(regX2), reg_y2 = toY(regY(regX2));

  return (
    <div className={styles.wrap}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        className={styles.svg}
        style={{ shapeRendering: 'crispEdges', imageRendering: 'pixelated' }}
      >
        {/* ── Grid ─────────────────────────────────────────────────────────── */}
        {TICKS.map((t) => (
          <line key={`gx${t}`} x1={toX(t)} y1={MT} x2={toX(t)} y2={MT + PH}
            stroke={t === 0 ? '#555' : '#e8e8e8'} strokeWidth={t === 0 ? 1.5 : 1} />
        ))}
        {TICKS.map((t) => (
          <line key={`gy${t}`} x1={ML} y1={toY(t)} x2={ML + PW} y2={toY(t)}
            stroke={t === 0 ? '#555' : '#e8e8e8'} strokeWidth={t === 0 ? 1.5 : 1} />
        ))}

        {/* ── 45° reference (y = x) ─────────────────────────────────────── */}
        <line
          x1={ref45x1} y1={ref45y1} x2={ref45x2} y2={ref45y2}
          stroke="#cccccc" strokeWidth={1.5}
          strokeDasharray="6 4"
        />

        {/* ── Regression trendline ─────────────────────────────────────────── */}
        <line
          x1={reg_x1} y1={reg_y1} x2={reg_x2} y2={reg_y2}
          stroke="#000000" strokeWidth={2}
        />

        {/* ── Data points (rendered as 3×3 pixel squares) ───────────────── */}
        {(['negative', 'neutral', 'positive'] as const).map((s) =>
          points[s].map(([x, y], i) => (
            <rect
              key={`${s}${i}`}
              x={toX(x) - 1.5}
              y={toY(y) - 1.5}
              width={3}
              height={3}
              fill={COLORS[s]}
              opacity={0.55}
            />
          ))
        )}

        {/* ── Axes ─────────────────────────────────────────────────────────── */}
        <line x1={ML} y1={MT} x2={ML} y2={MT + PH} stroke="#000" strokeWidth={2} />
        <line x1={ML} y1={MT + PH} x2={ML + PW} y2={MT + PH} stroke="#000" strokeWidth={2} />

        {/* ── Axis ticks & labels ───────────────────────────────────────────── */}
        {TICKS.map((t) => (
          <g key={`tx${t}`}>
            <line x1={toX(t)} y1={MT + PH} x2={toX(t)} y2={MT + PH + 5}
              stroke="#000" strokeWidth={1.5} />
            <text x={toX(t)} y={MT + PH + 18}
              textAnchor="middle" fontSize={11}
              fontFamily="var(--font-pixelify), monospace" fill="#333">
              {t === 0 ? '0' : `${t > 0 ? '+' : ''}${t}`}
            </text>
          </g>
        ))}
        {TICKS.map((t) => (
          <g key={`ty${t}`}>
            <line x1={ML - 5} y1={toY(t)} x2={ML} y2={toY(t)}
              stroke="#000" strokeWidth={1.5} />
            <text x={ML - 8} y={toY(t) + 4}
              textAnchor="end" fontSize={11}
              fontFamily="var(--font-pixelify), monospace" fill="#333">
              {t === 0 ? '0' : `${t > 0 ? '+' : ''}${t}`}
            </text>
          </g>
        ))}

        {/* ── Axis titles ───────────────────────────────────────────────────── */}
        <text
          x={ML + PW / 2} y={VH - 6}
          textAnchor="middle" fontSize={12}
          fontFamily="var(--font-pixelify), monospace" fill="#555">
          AR₁₀  (bps)
        </text>
        <text
          x={14} y={MT + PH / 2}
          textAnchor="middle" fontSize={12}
          fontFamily="var(--font-pixelify), monospace" fill="#555"
          transform={`rotate(-90, 14, ${MT + PH / 2})`}>
          AR₆₀  (bps)
        </text>

        {/* ── Pearson r badge ───────────────────────────────────────────────── */}
        <rect x={ML + PW - 170} y={MT + 10} width={162} height={26}
          fill="#fff" stroke="#000" strokeWidth={1.5} />
        <text x={ML + PW - 89} y={MT + 27}
          textAnchor="middle" fontSize={12}
          fontFamily="var(--font-pixelify), monospace" fill="#000">
          Pearson  r = {pearson_r.toFixed(3)}
        </text>

        {/* ── Regression slope badge ────────────────────────────────────────── */}
        <rect x={ML + PW - 170} y={MT + 42} width={162} height={26}
          fill="#fff" stroke="#000" strokeWidth={1.5} />
        <text x={ML + PW - 89} y={MT + 59}
          textAnchor="middle" fontSize={12}
          fontFamily="var(--font-pixelify), monospace" fill="#000">
          slope = {reg_slope.toFixed(3)}×
        </text>

        {/* ── Legend ────────────────────────────────────────────────────────── */}
        {(['negative', 'neutral', 'positive'] as const).map((s, i) => {
          const lx = ML + 12;
          const ly = MT + 14 + i * 20;
          return (
            <g key={s}>
              <rect x={lx} y={ly - 5} width={10} height={10}
                fill={COLORS[s]} opacity={0.8} />
              <text x={lx + 14} y={ly + 4}
                fontSize={11} fontFamily="var(--font-pixelify), monospace"
                fill="#333" textAnchor="start">
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </text>
            </g>
          );
        })}

        {/* ── Reference line legend entry ───────────────────────────────────── */}
        <line x1={ML + 12} y1={MT + 74} x2={ML + 22} y2={MT + 74}
          stroke="#ccc" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={ML + 26} y={MT + 78}
          fontSize={11} fontFamily="var(--font-pixelify), monospace"
          fill="#888" textAnchor="start">
          y = x
        </text>

        <line x1={ML + 12} y1={MT + 92} x2={ML + 22} y2={MT + 92}
          stroke="#000" strokeWidth={2} />
        <text x={ML + 26} y={MT + 96}
          fontSize={11} fontFamily="var(--font-pixelify), monospace"
          fill="#333" textAnchor="start">
          OLS fit
        </text>
      </svg>
    </div>
  );
}
