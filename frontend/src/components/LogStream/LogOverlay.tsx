import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/context';
import LogStream from './LogStream';

// LogOverlay is a full-screen live-log panel opened from the syncing / "Node
// Error" screens (where the header gear — the only other way to reach logs — is
// hidden). It is portalled to <body> so it escapes the app <main> stacking
// context (z-10) and paints above the app header (z-60). Dismiss with Escape or
// the close button.
export function LogOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="fixed inset-0 z-[200] flex flex-col bg-[#0d0d0d]"
    >
      <div className="shrink-0 flex items-center justify-between px-[16px] h-[52px] border-b border-white/[0.06] bg-[#121212]">
        <p className="text-white text-[14px] font-semibold font-headline">{t('logs.title')}</p>
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="text-gray-400 hover:text-gray-200 transition-colors p-[6px] -mr-[6px]"
        >
          <X size={18} strokeWidth={1.8} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <LogStream />
      </div>
    </motion.div>,
    document.body,
  );
}
