import React, { useId } from 'react';

export interface SparklineProps {
  data?: number[];
  width?: number | string;
  height?: number;
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
  showDot?: boolean;
  className?: string;
  glow?: boolean;
}

export const MonochromeSparkline: React.FC<SparklineProps> = ({
  data = [12, 18, 15, 28, 45, 30, 22, 19, 35, 42],
  width = '100%',
  height = 50,
  strokeColor = '#ffffff',
  fillColor = '#ffffff',
  strokeWidth = 1.75,
  showDot = true,
  className = '',
  glow = true,
}) => {
  const rawId = useId();
  const id = rawId.replace(/\W/g, '');
  const w = 200;
  const h = 50;
  const py = 6;
  const px = 4;
  const d = data && data.length ? data : [0];
  const min = Math.min(...d);
  const max = Math.max(...d);
  const rng = max - min || 1;

  const pts = d.map((v, i) => ({
    x: px + (d.length > 1 ? (i / (d.length - 1)) * (w - px * 2) : (w - px * 2) / 2),
    y: py + (1 - (v - min) / rng) * (h - py * 2),
  }));

  const path = pts.reduce((acc, pt, i) => {
    if (!i) return `M ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    const p0 = pts[i - 2] || pts[i - 1];
    const p1 = pts[i - 1];
    const p3 = pts[i + 1] || pt;
    return `${acc} C ${(p1.x + (pt.x - p0.x) / 6).toFixed(1)},${(p1.y + (pt.y - p0.y) / 6).toFixed(1)} ${(pt.x - (p3.x - p1.x) / 6).toFixed(1)},${(pt.y - (p3.y - p1.y) / 6).toFixed(1)} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }, '');

  const last = pts[pts.length - 1];

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      className={`overflow-visible ${className}`}
    >
      <defs>
        <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillColor} stopOpacity="0.35" />
          <stop offset="45%" stopColor={fillColor} stopOpacity="0.12" />
          <stop offset="100%" stopColor={fillColor} stopOpacity="0.0" />
        </linearGradient>
        {glow && (
          <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>

      {/* Smooth Gradient Glow Fill */}
      <path
        d={`${path} L ${last.x.toFixed(1)},${h} L ${pts[0].x.toFixed(1)},${h} Z`}
        fill={`url(#grad-${id})`}
      />

      {/* Ambient Glow behind stroke */}
      {glow && (
        <path
          d={path}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth + 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.32"
          filter={`url(#glow-${id})`}
        />
      )}

      {/* Crisp Foreground Stroke */}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Pulsating Ping Dot on latest values */}
      {showDot && (
        <g>
          {/* Animated ping ring */}
          <circle
            cx={last.x}
            cy={last.y}
            r="6"
            fill={strokeColor}
            opacity="0.45"
            className="animate-ping"
          />
          {/* Secondary ambient pulse */}
          <circle
            cx={last.x}
            cy={last.y}
            r="3.5"
            fill={strokeColor}
            opacity="0.6"
            className="animate-pulse"
          />
          {/* White core dot with stroke outline */}
          <circle cx={last.x} cy={last.y} r="2.2" fill="#ffffff" />
          <circle cx={last.x} cy={last.y} r="1.2" fill={strokeColor} />
        </g>
      )}
    </svg>
  );
};

export default MonochromeSparkline;
