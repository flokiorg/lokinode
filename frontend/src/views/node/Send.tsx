import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '@/i18n/context';
import { useToast } from '@/hooks/useToast';
import { useBalance } from '@/hooks/useBalance';
import { fetcher, post } from '@/lib/fetcher';
import { Input } from '@/components/ui/input';
import { ArrowRight, Loader2, CheckCircle2, AlertCircle, ChevronLeft, Send as SendIcon, Info } from 'lucide-react';
import type { FeesResponse, FundPsbtResponse, FinalizePsbtResponse, SendResponse, OutputLock } from '@/lib/types';
import { Toaster } from '@/components/ui/toaster';
import { formatFLC } from '@/lib/utils';
import { BrowserOpenURL } from '../../../wailsjs/runtime';
import { Copy, ArrowUpRight, Check } from 'lucide-react';

type FeePreset = 'economy' | 'standard' | 'fast';

export default function Send() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: balance, mutate: mutateBalance } = useBalance();

  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [copied, setCopied] = useState(false);
  const [feePreset, setFeePreset] = useState<FeePreset>('standard');
  const [fees, setFees] = useState<FeesResponse | null>(null);
  
  // PSBT / Review state
  const [psbt, setPsbt] = useState<string | null>(null);
  const [totalFee, setTotalFee] = useState<number | null>(null);
  const [locks, setLocks] = useState<OutputLock[] | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [isCalculatingMax, setIsCalculatingMax] = useState(false);

  // Load recommended fees on mount
  useEffect(() => {
    fetcher<FeesResponse>('/api/fees/recommended')
      .then(setFees)
      .catch(() => {});
  }, []);

  // Auto-release locks on unmount if we haven't sent
  const unmountRef = useRef({ psbt, locks });
  useEffect(() => {
    unmountRef.current = { psbt, locks };
  }, [psbt, locks]);

  useEffect(() => {
    return () => {
      const { psbt, locks } = unmountRef.current;
      if (psbt && locks && locks.length > 0) {
        fetch('/api/send/release-psbt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locks }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, []);

  function handleRelease() {
    if (locks && locks.length > 0) {
      post('/api/send/release-psbt', { locks }).catch(() => {});
    }
    setPsbt(null);
    setTotalFee(null);
    setLocks(null);
  }

  const lokiPerVbyte = useMemo(() => {
    // Standard defaults if fees aren't loaded yet
    const defaults = { fast: 10, standard: 5, economy: 1 };
    if (!fees) return defaults[feePreset];
    
    if (feePreset === 'fast') return fees.fastestFee || defaults.fast;
    if (feePreset === 'standard') return fees.halfHourFee || defaults.standard;
    return fees.economyFee || defaults.economy;
  }, [fees, feePreset]);

  // Rough estimate for live feedback (standard tx ~140 vB)
  const roughFee = (140 * lokiPerVbyte) / 1e8;

  async function handleReview() {
    const loki = Math.round(parseFloat(amount) * 1e8);
    if (!address || !loki || loki <= 0) return;

    setIsReviewing(true);
    setError(null);
    try {
      const resp = await post<FundPsbtResponse>('/api/send/fund-psbt', {
        address,
        amount: loki,
        lokiPerVbyte
      });
      setPsbt(resp.psbt);
      setTotalFee(resp.totalFee);
      setLocks(resp.locks);
    } catch (err: any) {
      setError(err.message || String(err));
      toast({ variant: 'destructive', title: t('send.errors.failed'), description: err.message || String(err) });
    } finally {
      setIsReviewing(false);
    }
  }

  async function handleSend() {
    if (!psbt) return;
    setSending(true);
    try {
      // 1. Finalize
      const { txHex } = await post<FinalizePsbtResponse>('/api/send/finalize-psbt', { psbt });
      // 2. Publish
      const resp = await post<SendResponse>('/api/send/publish', { txHex });
      
      setDone(resp.txId);
      mutateBalance();
    } catch (err: any) {
      toast({ variant: 'destructive', title: t('send.errors.failed'), description: err.message || String(err) });
    } finally {
      setSending(false);
    }
  }

  function reset() {
    handleRelease();
    setAddress('');
    setAmount('');
    setDone(null);
    setError(null);
  }

  if (done) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-[32px] animate-in fade-in zoom-in duration-500">
        <div className="w-[80px] h-[80px] rounded-full bg-emerald-500/10 flex items-center justify-center mb-[24px]">
          <CheckCircle2 size={40} className="text-emerald-500" />
        </div>
        <h2 className="text-white text-[20px] font-bold font-headline mb-[24px]">{t('send.success')}</h2>
        
        <div className="flex flex-col items-center gap-[12px] mb-[32px] w-full max-w-[320px]">
          <div 
            onClick={() => BrowserOpenURL(`https://lokichain.info/tx/${done}`)}
            className="group relative bg-[#1c1c1e] border border-white/[0.06] rounded-2xl p-[16px] cursor-pointer hover:border-[#DA9526]/40 transition-all w-full"
          >
            <p className="text-gray-300 text-[11px] font-mono break-all leading-relaxed group-hover:text-white transition-colors">
              {done}
            </p>
            <div className="absolute top-[8px] right-[8px] opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowUpRight size={14} className="text-[#DA9526]" />
            </div>
          </div>
          
          <button
            onClick={() => {
              navigator.clipboard.writeText(done);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="flex items-center gap-[6px] text-[#DA9526] text-[11px] font-label uppercase tracking-widest hover:text-[#c8871f] transition-all"
          >
            <div className="relative w-[12px] h-[12px]">
              <Copy size={12} className={`absolute inset-0 transition-all duration-200 ${copied ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}`} />
              <Check size={12} className={`absolute inset-0 transition-all duration-200 ${copied ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`} />
            </div>
            <span>{copied ? t('common.copied') : t('common.copy')}</span>
          </button>
        </div>
        <button
          onClick={reset}
          className="h-[48px] px-[32px] rounded-xl bg-[#DA9526] text-black font-semibold font-label text-[14px] hover:bg-[#c8871f] active:scale-[0.98] transition-all"
        >
          {t('common.continue')}
        </button>
      </div>
    );
  }

  const amountLoki = Math.round(parseFloat(amount) * 1e8) || 0;
  const balanceLoki = balance?.confirmed || 0;
  const roughFeeLoki = Math.round(roughFee * 1e8);
  // Reserve the rough fee from the spendable balance so the Review call
  // can never fail with "insufficient funds" purely due to fee coverage.
  const spendableLoki = Math.max(0, balanceLoki - roughFeeLoki);
  const canReview = address && amountLoki > 0 && amountLoki <= spendableLoki;

  // ── REVIEW VIEW ──
  if (psbt && totalFee !== null) {
    return (
      <div className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
        <div className="px-[20px] py-[18px] border-b border-white/[0.04] flex items-center gap-[12px] bg-[#121212]/50 backdrop-blur-md">
          <button 
            onClick={handleRelease} 
            className="w-[32px] h-[32px] rounded-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/[0.05] transition-all"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-white text-[16px] font-bold font-headline tracking-tight">{t('send.review_title')}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-[20px] py-[24px]">
          <div className="flex flex-col gap-[24px]">
            
            {/* Recipient Card */}
            <div className="flex flex-col gap-[10px]">
              <label className="text-gray-400 text-[10px] font-label uppercase tracking-[0.12em] px-[4px]">
                {t('send.recipient')}
              </label>
              <div className="bg-[#1c1c1e] p-[20px] rounded-2xl border border-white/[0.06] shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
                <p className="text-white text-[14px] font-mono break-all leading-relaxed tracking-tight">
                  {address}
                </p>
              </div>
            </div>

            {/* Values Grid */}
            <div className="grid grid-cols-2 gap-[16px]">
              <div className="flex flex-col gap-[10px]">
                <label className="text-gray-400 text-[10px] font-label uppercase tracking-[0.12em] px-[4px]">
                  {t('send.sending_label')}
                </label>
                <div className="bg-[#1c1c1e] p-[20px] rounded-2xl border border-white/[0.06] h-full flex flex-col justify-center">
                  <p className="text-white text-[18px] font-mono font-bold leading-none mb-[6px]">
                    {formatFLC(amountLoki).split(' ')[0]}
                  </p>
                  <span className="text-gray-500 text-[11px] font-label uppercase tracking-[0.05em]">FLC</span>
                </div>
              </div>
              
              <div className="flex flex-col gap-[10px]">
                <label className="text-gray-400 text-[10px] font-label uppercase tracking-[0.12em] px-[4px]">
                  {t('send.network_fee')}
                </label>
                <div className="bg-[#1c1c1e] p-[20px] rounded-2xl border border-white/[0.06] h-full flex flex-col justify-center">
                  <p className="text-[#DA9526] text-[18px] font-mono font-bold leading-none mb-[6px]">
                    {formatFLC(totalFee).split(' ')[0]}
                  </p>
                  <span className="text-[#DA9526]/60 text-[11px] font-label uppercase tracking-[0.05em]">FLC</span>
                </div>
              </div>
            </div>

            {/* Total Cost Highlight */}
            <div className="mt-[8px] flex flex-col gap-[10px]">
              <label className="text-gray-400 text-[10px] font-label uppercase tracking-[0.12em] px-[4px]">
                {t('send.total_cost')}
              </label>
              <div className="bg-[#DA9526]/[0.03] border border-[#DA9526]/20 rounded-3xl p-[24px] relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-[120px] h-[120px] bg-[#DA9526]/[0.03] rounded-full -mr-[60px] -mt-[60px] blur-3xl transition-all group-hover:scale-125" />
                
                <div className="relative z-10 flex items-baseline gap-[10px]">
                  <p className="text-[#DA9526] text-[32px] font-mono font-bold tracking-tighter">
                    {formatFLC(amountLoki + totalFee).split(' ')[0]}
                  </p>
                  <span className="text-[#DA9526]/60 text-[15px] font-label uppercase tracking-widest font-semibold">FLC</span>
                </div>
                
                <div className="relative z-10 mt-6 flex items-center gap-[10px] text-gray-400 bg-white/[0.02] border border-white/[0.04] w-fit px-3 py-1.5 rounded-full">
                  <Info size={13} className="text-[#DA9526]/60" />
                  <span className="text-[11px] font-body">
                    {t('send.arrival_est', { time: feePreset === 'fast' ? '10' : feePreset === 'standard' ? '30' : '60' })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-[20px] py-[20px] bg-[#121212] border-t border-white/[0.05]">
          <button
            onClick={handleSend}
            disabled={sending}
            className="w-full h-[54px] rounded-2xl bg-[#DA9526] text-black font-bold font-label text-[15px] flex items-center justify-center gap-[12px] hover:bg-[#c8871f] active:scale-[0.98] shadow-[0_8px_20px_rgba(218,149,38,0.15)] disabled:opacity-50"
          >
            {sending ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>{t('send.sending')}</span>
              </>
            ) : (
              <>
                <span>{t('send.confirm_send')}</span>
                <SendIcon size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── INPUT VIEW ──
  return (
    <div className="flex flex-col h-full overflow-hidden animate-in fade-in duration-300">
      <div className="flex-1 overflow-y-auto px-[20px] py-[16px]">
        <div className="flex flex-col gap-[24px]">
          
          {/* Recipient */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-gray-500 text-[10px] font-label uppercase tracking-[0.1em]">
              {t('send.recipient')}
            </label>
            <div className="relative group">
              <Input
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder={t('send.address_ph')}
                className="bg-[#1c1c1e] border-white/[0.06] focus:border-[#DA9526]/50 text-white placeholder:text-gray-400 text-[13px] h-[52px] font-mono rounded-xl transition-all pr-[40px]"
              />
              {address && (
                <button onClick={() => setAddress('')} className="absolute right-[14px] top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  <AlertCircle size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Amount */}
          <div className="flex flex-col gap-[8px]">
            <div className="flex items-center justify-between">
              <label className="text-gray-500 text-[10px] font-label uppercase tracking-[0.1em]">
                {t('send.amount')}
              </label>
              {balance && (
                <button 
                  onClick={async () => {
                    if (!address) {
                      toast({ variant: 'default', title: t('common.info'), description: t('send.address_first') });
                      return;
                    }
                    setIsCalculatingMax(true);
                    try {
                      const resp = await post<{amount: number, totalFee: number}>('/api/send/max-sendable', {
                        address,
                        lokiPerVbyte
                      });
                      setAmount((resp.amount / 1e8).toString());
                    } catch (err: any) {
                      toast({ variant: 'destructive', title: t('send.errors.failed'), description: err.message });
                    } finally {
                      setIsCalculatingMax(false);
                    }
                  }}
                  disabled={isCalculatingMax}
                  className="flex items-center gap-[5px] text-[#DA9526] text-[10px] font-label uppercase tracking-[0.05em] hover:underline disabled:opacity-60 disabled:no-underline transition-opacity"
                >
                  {isCalculatingMax ? (
                    <>
                      <Loader2 size={10} className="animate-spin" />
                      <span>Calculating…</span>
                    </>
                  ) : (
                    <span>{t('send.available', { amount: formatFLC(balance.confirmed) })}</span>
                  )}
                </button>
              )}
            </div>
            <div className="relative group">
              <Input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={isCalculatingMax}
                placeholder="0.00000000"
                className={`bg-[#1c1c1e] border-white/[0.06] focus:border-[#DA9526]/50 text-white placeholder:text-gray-400 text-[24px] h-[64px] font-mono rounded-xl transition-all py-[16px] leading-none ${
                  isCalculatingMax ? 'animate-pulse opacity-60' : ''
                }`}
              />
              <span className="absolute right-[16px] top-1/2 -translate-y-1/2 text-gray-400 font-bold text-[14px] pointer-events-none">FLC</span>
            </div>
          </div>

          {/* Fee Speed */}
          <div className="flex flex-col gap-[12px]">
            <div className="flex items-center justify-between">
              <label className="text-gray-500 text-[10px] font-label uppercase tracking-[0.1em]">
                {t('send.fee_speed')}
              </label>
              {amountLoki > 0 && (
                <span className="text-[10px] font-mono text-gray-400">
                  Est. Fee: ~{roughFee.toFixed(8)} FLC
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-[10px]">
              {(['economy', 'standard', 'fast'] as const).map(p => {
                const isActive = feePreset === p;
                const defaults = { fast: 10, standard: 5, economy: 1 };
                const rate = p === 'economy' ? fees?.economyFee : p === 'standard' ? fees?.halfHourFee : fees?.fastestFee;
                return (
                  <button
                    key={p}
                    onClick={() => setFeePreset(p)}
                    className={`flex flex-col items-center justify-center py-[14px] rounded-2xl border transition-all duration-200 ${
                      isActive 
                        ? 'bg-[#DA9526]/10 border-[#DA9526]' 
                        : 'bg-[#1c1c1e] border-white/[0.06] hover:border-white/[0.15]'
                    }`}
                  >
                    <span className={`text-[12px] font-label uppercase tracking-[0.05em] mb-[4px] ${isActive ? 'text-[#DA9526]' : 'text-gray-400'}`}>
                      {t(`send.${p}`)}
                    </span>
                    <span className={`text-[10px] font-mono ${isActive ? 'text-[#DA9526]' : 'text-gray-400'}`}>
                      {rate || defaults[p]} loki/vB
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Insufficient balance warning */}
          {amountLoki > 0 && amountLoki > spendableLoki && (
            <div className="p-[16px] bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-[12px]">
              <AlertCircle size={16} className="text-red-400 shrink-0" />
              <p className="text-red-400/90 text-[12px] font-body">
                {amountLoki > balanceLoki
                  ? 'Amount exceeds your balance'
                  : `Amount too high — leave room for the network fee (~${roughFee.toFixed(8)} FLC)`
                }
              </p>
            </div>
          )}

          {error && (
            <div className="p-[16px] bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-[12px]">
              <AlertCircle size={16} className="text-red-400 shrink-0" />
              <p className="text-red-400/90 text-[12px] font-body">{error}</p>
            </div>
          )}

        </div>
      </div>

      <div className="px-[20px] py-[20px] bg-[#121212] border-t border-white/[0.05]">
        <button
          onClick={handleReview}
          disabled={!canReview || isReviewing}
          className={`w-full h-[54px] rounded-2xl font-bold font-label text-[15px] flex items-center justify-center gap-[12px] transition-all duration-300 ${
            canReview 
              ? 'bg-[#DA9526] text-black hover:bg-[#c8871f] active:scale-[0.98]' 
              : 'bg-white/[0.08] text-gray-400'
          }`}
        >
          {isReviewing ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <>
              <span>Review Transaction</span>
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </div>

      <Toaster />
    </div>
  );
}
