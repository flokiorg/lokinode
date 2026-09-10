import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatFLC(loki: number): string {
  return (loki / 1e8).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

// shortPath collapses a filesystem path to "…/parent/leaf" for compact display.
export function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length <= 2 ? p : '…/' + parts.slice(-2).join('/');
}

