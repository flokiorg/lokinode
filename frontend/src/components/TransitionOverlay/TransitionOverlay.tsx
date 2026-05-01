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
    <div className="fixed inset-0 z-[9999] bg-[#121212]/60 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500 overflow-hidden">
      {/* Centralized Ambient Glow (Matches App.tsx) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          background: `radial-gradient(ellipse 70% 60% at 50% 30%, rgba(218,149,38,0.4) 0%, transparent 70%)`,
        }}
      />
      
      {/* Planetary System */}
      <motion.div 
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="mb-12"
      >
        <KineticSpinner size={220} />
      </motion.div>

      <div className="flex flex-col gap-3 max-w-[320px] relative z-20">
        <h2 className="text-white text-xl font-label font-bold tracking-tight">
          {label}
        </h2>
        {sublabel && (
          <p className="text-gray-400 text-[13px] leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-700 delay-300">
            {sublabel}
          </p>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
