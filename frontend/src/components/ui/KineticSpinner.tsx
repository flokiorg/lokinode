import * as React from 'react';

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
    { name: 'P1', size: 3,  orbit: 60,  speed: 1.5, opacity: 0.9, delay: 0 },
    { name: 'P2', size: 5,  orbit: 85,  speed: 2.5, opacity: 0.7, delay: 0.2 },
    { name: 'P3', size: 4,  orbit: 110, speed: 3.5, opacity: 0.5, delay: 0.4 },
    { name: 'P4', size: 8,  orbit: 140, speed: 5.0, opacity: 0.4, delay: 0.6 },
    { name: 'P5', size: 7,  orbit: 170, speed: 6.5, opacity: 0.3, delay: 0.8 },
    { name: 'P6', size: 6,  orbit: 200, speed: 8.0, opacity: 0.2, delay: 1.0 },
    { name: 'P7', size: 5,  orbit: 230, speed: 10.0, opacity: 0.1, delay: 1.2 },
  ];

  // Scale planets based on size prop (original was 220)
  const scale = size / 220;

  return (
    <div 
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      {showCore && (
        <div 
          className="absolute rounded-full shadow-lg animate-pulse z-20" 
          style={{ 
            width: coreSize * scale, 
            height: coreSize * scale, 
            backgroundColor: color,
            boxShadow: `0 0 ${40 * scale}px ${color}88, 0 0 ${20 * scale}px ${color}aa`
          }} 
        />
      )}
      
      {planets.map((p) => (
        <div
          key={p.name}
          className="absolute rounded-full flex items-center justify-center"
          style={{
            width: `${p.orbit * scale}px`,
            height: `${p.orbit * scale}px`,
            border: `1px solid rgba(218, 149, 38, ${p.opacity * 0.15})`, // Clearer degraded orbit path
            borderTopColor: `rgba(218, 149, 38, ${p.opacity * 0.6})`,    // Brighter leading arc (trail)
            borderRightColor: `rgba(218, 149, 38, ${p.opacity * 0.3})`,  // Fading trail
            borderBottomColor: 'transparent',
            borderLeftColor: 'transparent',
            animation: `kinetic-spin ${p.speed}s linear infinite`,
            animationDelay: `-${p.delay}s`,
          }}
        >
          {/* The Planet itself */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: `${p.size * scale}px`,
              height: `${p.size * scale}px`,
              backgroundColor: color,
              opacity: Math.max(0.3, p.opacity), // Ensure outer planets aren't too dim
              boxShadow: `0 0 ${10 * scale}px ${color}`,
            }}
          />
        </div>
      ))}

      <style>{`
        @keyframes kinetic-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
