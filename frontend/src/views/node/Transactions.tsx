import { useState } from 'react';
import { useTransactions } from '@/hooks/useTransactions';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/i18n/context';
import { formatFLC } from '@/lib/utils';
import { ArrowUpRight, ArrowDownLeft, Clock, Copy, ExternalLink, Check } from 'lucide-react';
import { BrowserOpenURL } from '../../../wailsjs/runtime';
import { useToast } from '@/hooks/useToast';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortHash(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 6) + '…' + hash.slice(-6) : hash;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="opacity-50 group-hover:opacity-100 p-[4px] hover:bg-white/5 rounded transition-all text-gray-400 hover:text-[#DA9526] relative"
    >
      <div className="w-[12px] h-[12px] relative">
        <Copy 
          size={12} 
          className={`absolute inset-0 transition-all duration-200 ${copied ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}`} 
        />
        <Check 
          size={12} 
          className={`absolute inset-0 text-[#DA9526] transition-all duration-200 ${copied ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`} 
        />
      </div>
    </button>
  );
}

export default function Transactions() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [limit, setLimit] = useState(50);
  const { data, isLoading } = useTransactions(limit, 0, true);

  if (isLoading) {
    return (
      <div className="px-[20px] py-[12px] flex flex-col gap-[8px]">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-[#1c1c1e] border border-white/[0.06] rounded-xl px-[14px] py-[12px] flex items-center justify-between">
            <div className="flex items-center gap-[10px]">
              <Skeleton className="w-[32px] h-[32px] rounded-full shrink-0" />
              <div className="flex flex-col gap-[6px]">
                <Skeleton className="h-[9px] w-[80px]" />
                <Skeleton className="h-[8px] w-[50px]" />
              </div>
            </div>
            <div className="flex flex-col items-end gap-[6px]">
              <Skeleton className="h-[9px] w-[90px]" />
              <Skeleton className="h-[8px] w-[50px]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const txs = data?.transactions ?? [];

  if (txs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[200px] gap-[8px] opacity-40">
        <Clock size={32} strokeWidth={1} />
        <p className="text-gray-400 text-[13px] font-body">{t('history.empty')}</p>
      </div>
    );
  }

  return (
    <div className="px-[20px] py-[12px] flex flex-col gap-[10px] animate-in fade-in duration-500">
      {txs.map(tx => {
        const incoming = tx.amount > 0;
        const unconfirmed = tx.confirmations === 0;
        const amountStr = formatFLC(Math.abs(tx.amount)).split(' ')[0];

        return (
          <div key={tx.txHash} className="bg-[#1c1c1e]/50 border border-white/[0.04] hover:border-[#DA9526]/20 rounded-2xl px-[16px] py-[14px] flex items-center justify-between transition-all group">
            <div className="flex items-center gap-[14px]">
              <div className={`w-[36px] h-[36px] rounded-full flex items-center justify-center transition-colors ${
                incoming 
                  ? 'bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20' 
                  : 'bg-red-500/10 text-red-400 group-hover:bg-red-500/20'
              }`}>
                {incoming 
                  ? <ArrowDownLeft size={18} strokeWidth={2} /> 
                  : <ArrowUpRight size={18} strokeWidth={2} />
                }
              </div>
              <div className="flex flex-col gap-[2px]">
                <div className="flex items-center gap-[6px]">
                    <p 
                    onClick={() => BrowserOpenURL(`https://explorer.flokicoin.org/tx/${tx.txHash}`)}
                    className="text-gray-300 text-[11px] font-mono tracking-tight cursor-pointer hover:text-[#DA9526] transition-colors flex items-center gap-[4px]"
                  >
                    {shortHash(tx.txHash)}
                    <ExternalLink size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </p>
                  <CopyButton text={tx.txHash} />
                </div>
                <p className="text-gray-400 text-[10px] font-label uppercase tracking-wide">
                  {tx.timestamp ? formatDate(tx.timestamp) : '—'}
                </p>
              </div>
            </div>
            <div className="text-right flex flex-col gap-[2px]">
              <p className={`text-[15px] font-mono font-bold tracking-tight ${incoming ? 'text-emerald-400' : 'text-red-400'}`}>
                {incoming ? '+' : '−'}{amountStr}
              </p>
              {unconfirmed ? (
                <div className="flex items-center justify-end gap-[4px] text-amber-500/80 animate-pulse">
                  <Clock size={10} />
                  <span className="text-[9px] font-label uppercase tracking-wider">{t('history.unconfirmed')}</span>
                </div>
              ) : (
                <p className="text-gray-400 text-[10px] font-mono tracking-tighter">
                  {tx.confirmations} CONF
                </p>
              )}
            </div>
          </div>
        );
      })}

      {data && data.total > txs.length && (
        <button
          onClick={() => setLimit((l) => l + 50)}
          className="w-full py-[16px] text-gray-400 text-[11px] font-label uppercase tracking-widest hover:text-[#DA9526] transition-colors mt-[8px]"
        >
          {t('history.load_more', { count: data.total - txs.length })}
        </button>
      )}
    </div>
  );
}
