import * as React from 'react';
import { create } from 'zustand';
import { motion } from 'framer-motion';
import { KineticSpinner } from '@/components/ui/KineticSpinner';

interface TransitionState {
  isActive: boolean;
  label: string;
  sublabel?: string;
  startTransition: (label: string, sublabel?: string) => void;
  endTransition: () => void;
}

export const useTransitionStore = create<TransitionState>((set) => ({
  isActive: false,
  label: '',
  sublabel: '',
  startTransition: (label, sublabel) => set({ isActive: true, label, sublabel }),
  endTransition: () => set({ isActive: false, label: '', sublabel: '' }),
}));

/**
 * TransitionOverlay
 * 
 * A full-screen, high-priority UI mask used to signal major system state 
 * transitions. While atomic node restarts are handled natively by the 
 * Node dashboard's internal state machine, this overlay remains critical 
 * for covering non-atomic operations (like stopping/starting different 
 * node environments) or as a fallback for future high-latency tasks.
 */
export function TransitionOverlay() {
  const { isActive, label, sublabel } = useTransitionStore();

  if (!isActive) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-[#121212]/60 backdrop-blur-sm flex items-center justify-center overflow-hidden animate-in fade-in duration-500">
      {/* Ambient Glow */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          background: `radial-gradient(ellipse 70% 60% at 50% 30%, rgba(218,149,38,0.4) 0%, transparent 70%)`,
        }}
      />

      {/* Spinner — sole flex child so its center aligns with screen center.
          scale animates from/to the screen center, not an offset group midpoint. */}
      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <KineticSpinner size={220} />
      </motion.div>

      {/* Labels pinned below the spinner (spinner radius = 110px, +18px gap) */}
      <div
        className="absolute left-0 right-0 flex flex-col items-center gap-3 px-6 text-center z-20"
        style={{ top: 'calc(50% + 128px)' }}
      >
        <h2 className="text-white text-xl font-label font-bold tracking-tight">
          {label}
        </h2>
        {sublabel && (
          <p className="text-gray-400 text-[13px] leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-700 delay-300">
            {sublabel}
          </p>
        )}
      </div>
    </div>
  );
}
