import * as React from 'react';
import { useRef } from 'react';

interface KineticSpinnerProps {
  size?: number;
  coreSize?: number;
  className?: string;
  color?: string;
  showCore?: boolean;
}

export function KineticSpinner({
  size = 220,
  coreSize = 32,
  className = '',
  color = '#DA9526',
  showCore = true
}: KineticSpinnerProps) {
  const planets = [
    { name: 'P1', size: 3,  orbit: 60,  speed: 1.5,  opacity: 0.9 },
    { name: 'P2', size: 5,  orbit: 85,  speed: 2.5,  opacity: 0.7 },
    { name: 'P3', size: 4,  orbit: 110, speed: 3.5,  opacity: 0.5 },
    { name: 'P4', size: 8,  orbit: 140, speed: 5.0,  opacity: 0.4 },
    { name: 'P5', size: 7,  orbit: 170, speed: 6.5,  opacity: 0.3 },
    { name: 'P6', size: 6,  orbit: 200, speed: 8.0,  opacity: 0.2 },
    { name: 'P7', size: 5,  orbit: 230, speed: 10.0, opacity: 0.1 },
  ];

  const delays = useRef(planets.map(p => Math.random() * p.speed));
  const uid = useRef(`ks${Math.random().toString(36).slice(2, 7)}`).current;
  const scale = size / 220;

  // Arc starting at 12 o'clock going CCW by `degrees`.
  // The SVG fills the orbit div so its center is at (r, r).
  // Planet center sits at (r, 0) — the div's transform-origin keeps this on the ring.
  function trailArc(r: number, degrees: number): string {
    const cx = r, cy = r;
    const s  = -Math.PI / 2;                        // 12 o'clock
    const e  = s - (degrees * Math.PI / 180);       // CCW ← behind a CW-rotating planet
    const x1 = (cx + r * Math.cos(s)).toFixed(2);   // ≈ r   (12 o'clock x)
    const y1 = (cy + r * Math.sin(s)).toFixed(2);   // = 0   (12 o'clock y)
    const x2 = (cx + r * Math.cos(e)).toFixed(2);
    const y2 = (cy + r * Math.sin(e)).toFixed(2);
    const la = degrees > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${la} 0 ${x2} ${y2}`;
  }

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {showCore && (
        <div
          className="absolute rounded-full shadow-lg animate-pulse z-20"
          style={{
            width: coreSize * scale,
            height: coreSize * scale,
            backgroundColor: color,
            boxShadow: `0 0 ${40 * scale}px ${color}88, 0 0 ${20 * scale}px ${color}aa`,
          }}
        />
      )}

      {planets.map((p, i) => {
        const r = (p.orbit * scale) / 2;
        const d = p.orbit * scale;
        const op = p.opacity;
        return (
          <div
            key={p.name}
            className="absolute rounded-full flex items-center justify-center"
            style={{
              width: d,
              height: d,
              border: `1px solid rgba(218, 149, 38, ${op * 0.15})`,
              borderTopColor:    `rgba(218, 149, 38, ${op * 0.6})`,
              borderRightColor:  `rgba(218, 149, 38, ${op * 0.3})`,
              borderBottomColor: 'transparent',
              borderLeftColor:   'transparent',
              animation: `kinetic-spin ${p.speed}s linear infinite`,
              animationDelay: `-${delays.current[i]}s`,
            }}
          >
            {/* Comet trail — drawn first so it sits beneath the planet dot */}
            <svg
              className="absolute inset-0"
              width={d}
              height={d}
              style={{ overflow: 'visible', pointerEvents: 'none' }}
            >
              <defs>
                {/* Soft blur used only on the ghost tail */}
                <filter id={`${uid}-b${i}`} x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="2.5" />
                </filter>
              </defs>

              {/* Ghost tail — wide, blurry, long */}
              <path
                d={trailArc(r, 100)}
                fill="none"
                stroke={color}
                strokeOpacity={0.07 * op}
                strokeWidth={6 * scale}
                strokeLinecap="round"
                filter={`url(#${uid}-b${i})`}
              />
              {/* Solid stacked arcs that shorten and brighten toward the planet */}
              <path d={trailArc(r, 80)} fill="none" stroke={color} strokeOpacity={0.12 * op} strokeWidth={2.2 * scale} strokeLinecap="round" />
              <path d={trailArc(r, 55)} fill="none" stroke={color} strokeOpacity={0.25 * op} strokeWidth={1.6 * scale} strokeLinecap="round" />
              <path d={trailArc(r, 30)} fill="none" stroke={color} strokeOpacity={0.45 * op} strokeWidth={1.1 * scale} strokeLinecap="round" />
              <path d={trailArc(r, 12)} fill="none" stroke={color} strokeOpacity={0.70 * op} strokeWidth={0.7 * scale} strokeLinecap="round" />
            </svg>

            {/* Planet dot — at 12 o'clock, on top of the trail */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: `${p.size * scale}px`,
                height: `${p.size * scale}px`,
                backgroundColor: color,
                opacity: Math.max(0.3, op),
                boxShadow: `0 0 ${10 * scale}px ${color}`,
              }}
            />
          </div>
        );
      })}

      <style>{`
        @keyframes kinetic-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
