import React from 'react';
import { useTranslation } from '@/i18n/context';

type Props = {
  content: string
  onClick: () => void
  type?: 'submit' | 'reset' | 'button'
  style?: React.CSSProperties
  disable?: boolean
  loading?: boolean
};

export const ConfirmButton: React.FC<Props> = ({ content, onClick, type = 'button', style, disable = false, loading = false }) => {
  const { t } = useTranslation();
  return (
    <button
      type={type}
      style={style}
      disabled={disable || loading}
      onClick={onClick}
      className="w-full h-[50px] rounded-xl bg-[#DA9526] text-black font-semibold font-label text-[15px] hover:bg-[#c8871f] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-[8px]"
    >
      {loading && <div className="w-[16px] h-[16px] rounded-full border-2 border-black border-t-transparent animate-spin" />}
      {loading ? t('common.processing') : content}
    </button>
  );
};
