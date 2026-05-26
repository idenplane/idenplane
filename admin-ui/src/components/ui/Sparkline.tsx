import { useId } from 'react';

export interface SparklineProps {
  data: number[];
  w?: number;
  h?: number;
  /** Stroke/fill colour (any CSS colour, incl. `var(--accent)`). */
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
}

export function Sparkline({ data, w = 120, h = 36, color = 'var(--accent)', fill = true, strokeWidth = 1.75 }: SparklineProps) {
  const gradientId = useId();
  if (data.length === 0) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i): [number, number] => [
    (i / (data.length - 1 || 1)) * w,
    h - 4 - ((v - min) / range) * (h - 8),
  ]);
  const path = pts.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(' ');
  const area = `${path} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}
