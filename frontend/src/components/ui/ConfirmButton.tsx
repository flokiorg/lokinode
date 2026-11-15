import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  loadingLabel: string;
  icon: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'amber' | 'red';
  onConfirm: () => void;
  className?: string;
}

export function ConfirmButton({
  label,
  confirmLabel,
  loadingLabel,
  icon,
  loading = false,
  disabled = false,
  variant = 'amber',
  onConfirm,
  className = '',
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (armed && buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setArmed(false);
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [armed]);

  function arm() {
    setArmed(true);
    timerRef.current = setTimeout(() => setArmed(false), 3000);
  }

  function confirm() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setArmed(false);
    onConfirm();
  }

  function handleClick() {
    if (loading || disabled) return;
    armed ? confirm() : arm();
  }

  const colors = variant === 'red'
    ? { idle: 'border-red-500/30 text-red-400 hover:bg-red-500/10', armed: 'border-red-500/70 bg-red-500/15 text-red-300' }
    : { idle: 'border-amber-500/30 text-amber-400/80 hover:bg-amber-500/10', armed: 'border-amber-500/70 bg-amber-500/15 text-amber-300' };

  return (
    <button
      ref={buttonRef}
      onClick={handleClick}
      disabled={disabled}
      className={`flex-1 py-[13px] rounded-xl border flex flex-col items-center justify-center gap-[5px] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
        armed 
          ? colors.armed + ' scale-[1.02] animate-pulse' 
          : colors.idle
      } ${className}`}
    >
      {loading ? (
        <Loader2 size={14} strokeWidth={2} className="animate-spin drop-shadow-md" />
      ) : armed ? (
        <AlertCircle size={14} strokeWidth={2.5} />
      ) : (
        icon
      )}
      <span className="text-[11px] font-label tracking-wide">
        {loading ? loadingLabel : armed ? confirmLabel : label}
      </span>
    </button>
  );
}
