import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Power, Lock, Zap, Loader, Loader2, Check, Copy, RefreshCw, X, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/i18n/context';
import { useToast } from '@/hooks/useToast';
import { useInfo } from '@/hooks/useInfo';
import { useBalance } from '@/hooks/useBalance';
import { useNotifyIncoming } from '@/hooks/useNotifyIncoming';
import { post, ApiError } from '@/lib/fetcher';

import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/toaster';
import { Input } from '@/components/ui/input';
import Transactions from '@/views/node/Transactions';
import Receive from '@/views/node/Receive';
import Send from '@/views/node/Send';
import { useNodeSessionStore } from '@/store/nodeSession';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { KineticSpinner } from '@/components/ui/KineticSpinner';
import { formatFLC } from '@/lib/utils';

const STATUS_READY     = 'ready';
const STATUS_BLOCK     = 'block';
const STATUS_TX        = 'tx';
const STATUS_LOCKED    = 'locked';
const STATUS_NO_WALLET = 'noWallet';
const STATUS_DOWN      = 'down';

type ActiveTab = 'overview' | 'history' | 'receive' | 'send';

function formatUptime(start: number): string {
  const secs = Math.floor((Date.now() / 1000) - start);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}


function Node() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { data: info, mutate: mutateInfo } = useInfo(true);
  const nodeActive = info?.state === STATUS_READY || info?.state === STATUS_BLOCK || info?.state === STATUS_TX;
  const { data: balance } = useBalance(nodeActive);
  useNotifyIncoming(nodeActive);
  const {
    walletUnlocked,
    setWalletUnlocked,
    setUserStopped,
    autoUnlockPending,
    setAutoUnlockPending,
    isRestarting,
    setIsRestarting,
    clearSession,
  } = useNodeSessionStore();

  const [tab, setTab] = useState<ActiveTab>('overview');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [pwdError, setPwdError] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [startTime] = useState(() => Math.floor(Date.now() / 1000));
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigatingAwayRef = useRef(false);
  // Tracks that the restart cycle visibly started (node went down or hit a
  // transient boot state). Prevents clearing isRestarting from stale SWR
  // cache when the pre-restart state already happens to be "locked".
  const seenRestartProgressRef = useRef(false);

  // drag-to-dismiss for unlock sheet
  const [sheetDrag, setSheetDrag] = useState(0);
  const sheetDragStart = useRef(0);
  const isDraggingSheet = useRef(false);


  const state      = info?.state ?? '';
  // Suppress the "active" branch while a settings restart is in flight so we
  // never flash the overview mid-restart and then jump straight to the unlock
  // sheet with no loading indicator.
  const isActive   = !isRestarting && (state === STATUS_READY || state === STATUS_BLOCK || state === STATUS_TX);
  const isLocked   = state === STATUS_LOCKED;
  const isNoWallet = state === STATUS_NO_WALLET;
  const isDown     = state === STATUS_DOWN;

  // ── Unlock ────────────────────────────────────────────────────────────────────
  async function handleUnlock() {
    if (isUnlocking) return;
    if (!password) { setPwdError(true); return; }
    setPwdError(false);
    setIsUnlocking(true);
    try {
      await post('/api/wallet/unlock', { password });
      setWalletUnlocked(true);
      setShowUnlock(false);
      setPassword('');
      setIsUnlocking(false);
      mutateInfo();
    } catch {
      setIsUnlocking(false);
      setPwdError(true);
    }
  }

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowUnlock(false);
        setPassword('');
        setPwdError(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  // ── Stop ─────────────────────────────────────────────────────────────────────
  async function handleStop() {
    if (isStopping || isLocking) return;
    setIsStopping(true);
    setUserStopped(true);
    clearSession();
    try {
      await post('/api/node/stop', {});
      mutateInfo(cur => cur ? { ...cur, nodeRunning: false, state: STATUS_DOWN } : cur, false);
    } catch (err) {
      setIsStopping(false);
      setUserStopped(false);
      if (err instanceof ApiError && err.status === 429) {
        toast({ variant: 'destructive', title: t('node.errors.rate_limited') });
      } else {
        toast({ variant: 'destructive', title: t('node.errors.stop_failed'), description: String(err) });
      }
    }
  }

  // ── Lock — single atomic restart
  async function handleLock() {
    if (!isActive || isLocking || isStopping) return;
    setIsLocking(true);
    clearSession();
    setShowUnlock(false);
    setPassword('');
    setPwdError(false);
    try {
      await post('/api/wallet/lock', {});
      mutateInfo();
    } catch (err) {
      setIsLocking(false);
      if (err instanceof ApiError && err.status === 429) {
        toast({ variant: 'destructive', title: t('node.errors.rate_limited') });
      } else if (err instanceof ApiError && err.status === 503) {
        toast({ variant: 'destructive', title: t('node.errors.daemon_not_ready') });
      } else {
        toast({ variant: 'destructive', title: t('main.errors.start_failed') });
      }
    }
  }

  // ── Restart (from down)
  async function handleRestart() {
    if (restarting) return;
    setRestarting(true);
    try {
      await post('/api/node/stop', {});
      await post('/api/node/start', {});
      mutateInfo();
    } catch (err) {
      setRestarting(false);
      if (err instanceof ApiError && err.status === 429) {
        toast({ variant: 'destructive', title: t('node.errors.rate_limited') });
      } else {
        toast({ variant: 'destructive', title: t('node.errors.restart_failed'), description: String(err) });
      }
    }
  }

  useEffect(() => {
    if (isLocking && isLocked && info?.nodeRunning) {
      setIsLocking(false);
    }
  }, [isLocking, isLocked, info?.nodeRunning]);

  useEffect(() => {
    if (!isLocking) {
      if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null; }
      return;
    }
    lockTimerRef.current = setTimeout(() => {
      setIsLocking(false);
      toast({ variant: 'destructive', title: t('node.errors.lock_timeout_title'), description: t('node.errors.lock_timeout_desc') });
    }, 60_000);
    return () => { if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null; } };
  }, [isLocking]);

  useEffect(() => {
    if (!autoUnlockPending) return;
    if (isRestarting) return;
    if (!isLocked || !info?.nodeRunning) return;
    if (walletUnlocked) return;
    setAutoUnlockPending(false);
    setShowUnlock(true);
  }, [autoUnlockPending, isRestarting, isLocked, info?.nodeRunning, walletUnlocked]);

  useEffect(() => {
    if (info === undefined || info.nodeRunning) return;
    if (isLocking) return;
    // Don't navigate away while a settings-triggered restart is in flight —
    // the daemon is intentionally down and will come back shortly.
    if (isRestarting) return;
    if (!navigatingAwayRef.current) {
      navigatingAwayRef.current = true;
      navigate('/', { replace: true });
    }
  }, [info?.nodeRunning, isLocking, isRestarting]);

  useEffect(() => {
    if (isNoWallet && !navigatingAwayRef.current) {
      navigatingAwayRef.current = true;
      navigate('/create', { replace: true });
    }
  }, [isNoWallet]);

  // Mark that the restart cycle has visibly started (node down or boot state).
  useEffect(() => {
    if (!isRestarting) {
      seenRestartProgressRef.current = false;
      return;
    }
    if (!info?.nodeRunning || state === 'starting' || state === 'init' || state === 'none') {
      seenRestartProgressRef.current = true;
    }
  }, [isRestarting, info?.nodeRunning, state]);

  useEffect(() => {
    if (!info?.nodeRunning && info !== undefined && !isLocking) {
      clearSession();
    }
    // Clear isRestarting only after we've witnessed the restart actually
    // begin (node went down or entered a transient boot state). This prevents
    // stale SWR cache from triggering the clear the moment we arrive at /node
    // when the pre-restart state happened to already be "locked".
    if (isRestarting && seenRestartProgressRef.current && (isLocked || isActive)) {
      setIsRestarting(false);
    }
  }, [info?.nodeRunning, isRestarting, isLocked, isActive]);

  useEffect(() => {
    if (!isLocked && !isLocking && showUnlock) {
      setShowUnlock(false);
    }
  }, [isLocked, isLocking, showUnlock]);

  useEffect(() => {
    if (!showUnlock) {
      setPassword('');
      setPwdError(false);
    }
  }, [showUnlock]);

  useEffect(() => {
    if (restarting && state !== STATUS_DOWN && state !== '') setRestarting(false);
  }, [state]);

  useEffect(() => {
    if (!restarting) {
      if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
      return;
    }
    restartTimerRef.current = setTimeout(() => {
      setRestarting(false);
      toast({ variant: 'destructive', title: t('node.status.error'), description: t('node.errors.start_timeout') });
    }, 45_000);
    return () => { if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; } };
  }, [restarting]);

  // ── Phase config ──────────────────────────────────────────────────────────────
  const syncing    = !isActive && !isLocked && !isDown && !restarting && !isLocking && state !== '' && state !== 'stopped';
  const phaseKey   = isLocking ? 'locking' : (restarting || isRestarting) ? 'restarting' : isDown ? 'down' : isLocked ? 'locked' : isActive ? 'active' : syncing ? 'syncing' : 'locked';
  const bootStates = new Set(['init', 'starting', 'none', '']);
  const syncingLabel = bootStates.has(state) ? t('node.status.starting') : t('node.status.syncing');
  const syncingSub: Record<string, string> = {
    init: t('node.sync.init'), none: t('node.sync.none'), unlocked: t('node.sync.unlocked'),
    syncing: t('node.sync.syncing'), scanning: t('node.sync.scanning'), tx: t('node.sync.tx'),
  };

  const phaseConfig = {
    locked:     { label: t('node.status.locked'),      sub: t('node.status.sub.locked'),      glowColor: 'rgba(120,120,120,0.18)', ringColor: 'border-gray-600',  btnColor: 'border-gray-400 text-gray-300',   iconColor: '#d1d5db' },
    locking:    { label: t('node.status.locking_wallet'), sub: t('node.status.sub.locking'),  glowColor: 'rgba(120,120,120,0.18)', ringColor: 'border-gray-600',  btnColor: 'border-gray-400 text-gray-300',   iconColor: '#d1d5db' },
    syncing:    { label: syncingLabel,                  sub: syncingSub[state] ?? t('node.sync.default'), glowColor: 'rgba(218,149,38,0.22)', ringColor: 'border-amber-500', btnColor: 'border-[#DA9526] text-[#DA9526]', iconColor: '#DA9526' },
    restarting: { label: t('node.status.restarting'),  sub: t('node.status.sub.restarting'),  glowColor: 'rgba(218,149,38,0.22)', ringColor: 'border-amber-500', btnColor: 'border-[#DA9526] text-[#DA9526]', iconColor: '#DA9526' },
    active:     { label: t('node.status.active'),       sub: formatUptime(startTime),           glowColor: 'rgba(218,149,38,0.28)', ringColor: 'border-amber-500', btnColor: 'border-[#DA9526] text-[#DA9526]', iconColor: '#DA9526' },
    down:       { label: t('node.status.error'),        sub: t('node.status.sub.retrying'),    glowColor: 'rgba(239,68,68,0.12)',  ringColor: 'border-red-500',   btnColor: 'border-red-500/60 text-red-400',  iconColor: '#f87171' },
  }[phaseKey];

  const TABS: { key: ActiveTab; label: string }[] = [
    { key: 'overview', label: t('tab.overview') },
    { key: 'history',  label: t('tab.history') },
    { key: 'receive',  label: t('tab.receive') },
    { key: 'send',     label: t('tab.send') },
  ];

  if (info === undefined) {
    return (
      <div className="flex flex-col h-[calc(100vh-116px)] bg-[#121212] overflow-hidden">
        <div className="px-[20px] pt-[20px] pb-[16px] border-b border-white/[0.04]">
          <Skeleton className="h-[9px] w-[80px] mb-[10px]" />
          <Skeleton className="h-[28px] w-[150px]" />
        </div>
        <div className="flex border-b border-white/[0.04]">
          {['Overview','Transactions','Receive','Send'].map(label => (
            <div key={label} className="flex-1 py-[11px] flex justify-center">
              <Skeleton className="h-[9px] w-[40px]" />
            </div>
          ))}
        </div>
        <div className="flex-1 px-[20px] py-[16px] flex flex-col gap-[12px]">
          <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
            {[90, 70, 60, 110].map((w, i, arr) => (
              <div key={i} className={`flex items-center justify-between px-[16px] py-[12px] ${i < arr.length - 1 ? 'border-b border-white/[0.04]' : ''}`}>
                <Skeleton className="h-[9px] w-[50px]" /><Skeleton style={{ width: w }} className="h-[9px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isActive) {
    return (
      <div className="flex flex-col h-full pt-[116px] overflow-hidden">
        <div className="px-[20px] pt-[20px] pb-[16px] border-b border-white/[0.04]">
          <p className="text-gray-400 text-[11px] font-label uppercase tracking-[0.08em] mb-[4px]">{t('node.balance')}</p>
          {balance?.ready ? (
            <div className="flex items-baseline gap-[8px]">
              <span className="text-white text-[28px] font-semibold font-headline tabular-nums">{formatFLC(balance.total)}</span>
              <span className="text-gray-400 text-[14px] font-label">FLC</span>
            </div>
          ) : (
            <div className="flex items-baseline gap-[8px]">
              <Skeleton className="h-[28px] w-[160px]" />
              <Skeleton className="h-[14px] w-[28px]" />
            </div>
          )}
          {balance?.ready && balance.unconfirmed !== 0 && (
            <p className="text-[#DA9526] text-[11px] font-mono mt-[2px] font-medium">
              +{formatFLC(balance.unconfirmed)} FLC {t('overview.pending').toLowerCase()}
            </p>
          )}
        </div>

        <div className="flex border-b border-white/[0.04]">
          {TABS.map(entry => (
            <button key={entry.key} onClick={() => setTab(entry.key)}
              className={`flex-1 py-[10px] text-[12px] font-label tracking-wide transition-colors ${tab === entry.key ? 'text-[#DA9526] border-b-2 border-[#DA9526]' : 'text-gray-400 hover:text-gray-200'}`}
            >{entry.label}</button>
          ))}
        </div>

        <div className="flex-1 overflow-x-hidden relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -20, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="h-full overflow-y-auto overscroll-y-contain"
            >
              {tab === 'overview' && <OverviewTab info={info} balance={balance} onStop={handleStop} onLock={handleLock} isStopping={isStopping} isLocking={isLocking} />}
              {tab === 'history'  && <Transactions />}
              {tab === 'receive'  && <Receive />}
              {tab === 'send'     && <Send />}
            </motion.div>
          </AnimatePresence>
        </div>

        <Toaster />
      </div>
    );
  }

  const isLoading = restarting || isLocking || isStopping || isUnlocking || syncing || isRestarting;

  return (
    <div className={`relative flex flex-col h-screen overflow-hidden select-none ${isLoading ? 'cursor-wait' : ''}`}>
      <div className={`flex-1 flex flex-col items-center justify-center relative z-10 ${isLoading ? 'pointer-events-none' : ''}`}>
        {!isLoading && <div className="h-[116px] shrink-0" />}
        
        <div className="flex-1 flex flex-col items-center justify-center relative">
          {isLoading && (
            <motion.div 
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <KineticSpinner size={420} coreSize={48} />
            </motion.div>
          )}

          <motion.div 
            initial={isLoading ? { scale: 0.8, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
            className={`flex flex-col items-center relative z-10 transition-transform duration-400 ${isLoading ? 'translate-y-[60px]' : ''}`}
          >
            <div className={`relative flex items-center justify-center w-[260px] h-[260px] ${isLoading ? 'h-0' : 'mb-[20px]'}`}>
              {!isLoading && (
                <>
                  <div className={`absolute w-[250px] h-[250px] rounded-full border border-amber-500 opacity-[0.04]`} />
                  <div className={`absolute w-[210px] h-[210px] rounded-full border border-amber-500 opacity-[0.08]`} />
                  <div className={`absolute w-[170px] h-[170px] rounded-full border border-amber-500 opacity-[0.14]`} />
                  <div className={`absolute w-[130px] h-[130px] rounded-full border border-amber-500 opacity-[0.25]`} />
                </>
              )}
              
              <button
                onClick={() => {
                  if (isLoading) return;
                  if (isLocked) setShowUnlock(true);
                  else if (isDown) handleRestart();
                  else if (restarting) handleStop();
                }}
                disabled={isLoading}
                className={`relative w-[96px] h-[96px] rounded-full flex items-center justify-center transition-all duration-500 focus:outline-none z-10 ${
                  isLoading 
                    ? 'border-none bg-transparent opacity-0' 
                    : 'border-2 border-white/[0.08] bg-[#1a1a1a] hover:border-[#DA9526]/40 hover:scale-[1.04] active:scale-[0.97]'
                }`}
              >
                {!isLoading && (
                  isDown ? (
                    <RefreshCw size={38} strokeWidth={1.8} className="text-gray-300 group-hover:text-[#DA9526] transition-colors" />
                  ) : (
                    <Lock size={38} strokeWidth={1.8} className="text-gray-300 group-hover:text-[#DA9526] transition-colors" />
                  )
                )}
              </button>
            </div>

            <div className={`text-center transition-all duration-700 ${isLoading ? 'mt-[160px]' : ''}`}>
              <h1 className="text-white text-[24px] font-bold font-headline tracking-tight">
                {isLocking ? t('node.status.locking_wallet') : phaseConfig.label}
              </h1>
              <p className="text-gray-400 text-[14px] font-body mt-[4px]">
                {isLocking ? t('node.status.sub.locking') : phaseConfig.sub}
              </p>
            </div>
            
            {isDown && !restarting && !isLocking && (
              <div className="flex flex-col items-center gap-[4px] mt-[12px]">
                {info?.portConflict && <p className="text-red-400/80 text-[11px] font-body text-center px-[16px]">{t('node.errors.port_conflict')}</p>}
                {info?.anotherInstance && <p className="text-red-400/80 text-[11px] font-body text-center px-[16px]">{t('node.errors.another_instance')}</p>}
                {info?.error && !info?.portConflict && !info?.anotherInstance && (
                  <p className="text-red-400/80 text-[11px] font-body text-center px-[16px] max-w-[280px]">{info.error}</p>
                )}
              </div>
            )}
            {(!isDown || restarting) && syncing && <SyncProgress info={info} />}
            {(!isDown || restarting) && !syncing && info?.blockHeight ? (
              <p className="text-gray-500 text-[11px] font-mono mt-[4px]">{t('overview.block')} {info.blockHeight.toLocaleString()}</p>
            ) : null}
          </motion.div>
        </div>
      </div>


      {/* Unlock bottom sheet */}
      <AnimatePresence>
        {showUnlock && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-end backdrop-blur-sm bg-black/50"
            onClick={e => { if (e.target === e.currentTarget && !isUnlocking) setShowUnlock(false); }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: sheetDrag }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full bg-[#1c1c1e] border-t border-white/[0.08] rounded-t-3xl flex flex-col max-h-[80vh] shadow-[0_-20px_60px_rgba(0,0,0,0.6)]"
              onPointerDown={e => { if (isUnlocking) return; isDraggingSheet.current = true; sheetDragStart.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={e => { if (!isDraggingSheet.current) return; setSheetDrag(Math.max(0, e.clientY - sheetDragStart.current)); }}
              onPointerUp={e => {
                if (!isDraggingSheet.current) return;
                isDraggingSheet.current = false;
                const d = Math.max(0, e.clientY - sheetDragStart.current);
                setSheetDrag(0);
                if (d >= 80) setShowUnlock(false);
              }}
              onPointerCancel={() => { isDraggingSheet.current = false; setSheetDrag(0); }}
            >
              {/* Drag handle */}
              <div className="flex justify-center items-center py-[12px] shrink-0 select-none cursor-grab active:cursor-grabbing">
                <div className="w-[40px] h-[4px] bg-gray-500 rounded-full" />
              </div>

              <div className="px-[24px] pb-[32px] flex flex-col gap-[20px]">
                <div>
                  <p className="text-white text-[18px] font-bold font-headline mb-[2px]">{t('unlock.title')}</p>
                  <p className="text-gray-400 text-[13px] font-body">{t('unlock.subtitle')}</p>
                </div>

                {/* Stop pointer events from propagating to the drag sheet so clicks on
                    the input, eye-toggle, and Unlock button are not swallowed. */}
                <div
                  className="w-full flex flex-col gap-[16px]"
                  onPointerDown={e => e.stopPropagation()}
                >
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      autoFocus
                      placeholder={t('unlock.placeholder')}
                      value={password}
                      disabled={isUnlocking}
                      onChange={e => { setPassword(e.target.value); setPwdError(false); }}
                      onKeyDown={e => { if (e.key === 'Enter' && !isUnlocking) handleUnlock(); }}
                      className={`bg-[#121212] border-white/[0.08] text-white h-[52px] pl-[16px] pr-[48px] rounded-xl focus:border-[#DA9526]/60 transition-colors placeholder:text-gray-400 ${pwdError ? 'border-red-500 focus:border-red-500' : ''}`}
                    />
                    {!isUnlocking && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute right-[16px] top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors focus:outline-none"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    )}
                    {isUnlocking && (
                      <div className="absolute right-[14px] top-1/2 -translate-y-1/2 scale-[0.6] origin-right">
                        <KineticSpinner size={32} />
                      </div>
                    )}
                  </div>
                  {pwdError && <span className="text-red-400 text-[11px] font-body mt-[-8px]">{t('unlock.error.desc')}</span>}

                  <button
                    onClick={handleUnlock}
                    disabled={isUnlocking || !password}
                    className="w-full h-[52px] rounded-xl bg-[#DA9526] text-black font-semibold font-label text-[14px] hover:bg-[#c8871f] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 shadow-[0_8px_20px_rgba(218,149,38,0.2)]"
                  >
                    {isUnlocking ? t('unlock.loading') : t('unlock.button')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toaster />
    </div>
  );
}

// ── Sync progress ──────────────────────────────────────────────────────────────
function SyncProgress({ info }: { info: any }) {
  const { t } = useTranslation();
  const tip = info?.mempoolHeight ?? 0;
  const cur = info?.blockHeight ?? 0;
  const ts  = info?.bestHeaderTimestamp ?? 0;
  const pct = tip > 0 ? Math.min(100, (cur / tip) * 100) : 0;

  function relativeTime(s: number): string {
    if (!s) return '';
    const d = Math.floor(Date.now() / 1000) - s;
    if (d < 60)       return t('time.seconds_ago', { n: d });
    if (d < 3600)     return t('time.minutes_ago', { n: Math.floor(d / 60) });
    if (d < 86400)    return t('time.hours_ago',   { n: Math.floor(d / 3600) });
    if (d < 2592000)  return t('time.days_ago',    { n: Math.floor(d / 86400) });
    if (d < 31536000) return t('time.months_ago',  { n: Math.floor(d / 2592000) });
    return t('time.years_ago', { n: Math.floor(d / 31536000) });
  }

  return (
    <div className="flex flex-col items-center gap-[8px] mt-[10px]">
      {tip > 0 && (
        <div className="flex items-center gap-[8px]">
          <div className="w-[140px] h-[3px] bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-[#DA9526] rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[#DA9526] text-[10px] font-mono">{pct.toFixed(1)}%</span>
        </div>
      )}
      {cur > 0 && (
        <div className="flex items-center gap-[6px]">
          <span className="text-gray-400 text-[10px] font-label uppercase tracking-[0.08em]">{t('overview.block')}</span>
          <span className="text-gray-400 text-[11px] font-mono">
            {cur.toLocaleString()}
            {tip > 0 ? <span className="text-gray-400"> / {tip.toLocaleString()}</span> : null}
          </span>
        </div>
      )}
      {relativeTime(ts) && (
        <span className="text-gray-400 text-[10px] font-mono">
          {t('overview.last_block', { time: relativeTime(ts) })}
        </span>
      )}
    </div>
  );
}

// ── Overview tab ───────────────────────────────────────────────────────────────
function OverviewTab({ info, balance, onStop, onLock, isStopping, isLocking }: {
  info: any; balance: any;
  onStop: () => void; onLock: () => void;
  isStopping: boolean; isLocking: boolean;
}) {
  const { t } = useTranslation();
  const isSynced = info?.syncedToChain === true;
  const syncPct  = isSynced ? 100
    : info?.mempoolHeight && info?.blockHeight
    ? Math.min(100, (info.blockHeight / info.mempoolHeight) * 100) : 0;
  const networkDisplay = info?.network === 'main' ? 'mainnet' : info?.network;
  const networkColor: Record<string, string> = { main: '#DA9526', mainnet: '#DA9526', testnet: '#60a5fa', regtest: '#a78bfa' };
  const netColor = networkColor[info?.network ?? ''] ?? '#DA9526';

  return (
    <div className="px-[20px] py-[16px] flex flex-col gap-[12px]">
      <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        <InfoRow label={t('overview.network')}>
          {networkDisplay
            ? <span className="text-[12px] font-mono px-[8px] py-[2px] rounded-full" style={{ color: netColor, background: netColor + '20' }}>{networkDisplay}</span>
            : <Skeleton className="h-[18px] w-[60px] rounded-full" />}
        </InfoRow>
        <InfoRow label={t('overview.alias')}>
          {info?.nodeAlias
            ? <span className="text-white text-[12px] font-mono">{info.nodeAlias}</span>
            : <Skeleton className="h-[9px] w-[80px]" />}
        </InfoRow>
        <InfoRow label={t('overview.sync')}>
          {info?.blockHeight
            ? <div className="flex items-center gap-[8px]">
                <div className="w-[60px] h-[4px] bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500 bg-[#DA9526]" style={{ width: `${syncPct}%` }} />
                </div>
                <span className="text-white text-[12px] font-mono">{isSynced ? t('overview.synced') : `${syncPct.toFixed(1)}%`}</span>
              </div>
            : <Skeleton className="h-[9px] w-[80px]" />}
        </InfoRow>
        <InfoRow label={t('overview.block')}>
          {info?.blockHeight
            ? <span className="text-white text-[12px] font-mono">{info.blockHeight.toLocaleString()}</span>
            : <Skeleton className="h-[9px] w-[60px]" />}
        </InfoRow>
        <InfoRow label={t('overview.pubkey')} last>
          {info?.nodePubkey
            ? <div className="flex items-center w-[160px]">
                <input type="text" readOnly value={info.nodePubkey} className="bg-transparent border-none text-gray-400 text-[11px] font-mono focus:ring-0 outline-none w-full px-0 py-0 cursor-text" />
                <CopyButton text={info.nodePubkey} />
              </div>
            : <Skeleton className="h-[9px] w-[120px]" />}
        </InfoRow>
      </div>

      {balance?.ready ? (
        <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          <InfoRow label={t('overview.confirmed')}><span className="text-white text-[13px] font-mono">{formatFLC(balance.confirmed)} FLC</span></InfoRow>
          {balance.unconfirmed !== 0 && <InfoRow label={t('overview.pending')}><span className="text-[#DA9526] text-[13px] font-mono">{formatFLC(balance.unconfirmed)} FLC</span></InfoRow>}
          {balance.locked !== 0 && <InfoRow label={t('overview.locked')}><span className="text-gray-400 text-[13px] font-mono">{formatFLC(balance.locked)} FLC</span></InfoRow>}
        </div>
      ) : (
        <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
          {[1, 2].map((_, i, arr) => (
            <div key={i} className={`flex items-center justify-between px-[16px] py-[12px] ${i < arr.length - 1 ? 'border-b border-white/[0.04]' : ''}`}>
              <Skeleton className="h-[9px] w-[60px]" /><Skeleton className="h-[9px] w-[130px]" />
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-[10px] mt-[4px]">
        <ConfirmButton
          label={t('node.lock')} confirmLabel={t('node.lock.confirm')} loadingLabel={t('node.locking')}
          icon={<Lock size={14} strokeWidth={2} />} loading={isLocking} disabled={isStopping}
          variant="amber" onConfirm={onLock}
        />
        <ConfirmButton
          label={t('node.stop')} confirmLabel={t('node.stop.confirm')} loadingLabel={t('node.stopping')}
          icon={<Power size={14} strokeWidth={2} />} loading={isStopping} disabled={isLocking}
          variant="red" onConfirm={onStop}
        />
      </div>
    </div>
  );
}

function InfoRow({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-[16px] py-[11px] ${last ? '' : 'border-b border-white/[0.04]'}`}>
      <span className="text-gray-400 text-[11px] font-label uppercase tracking-[0.08em]">{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  function copy() { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }
  return (
    <button onClick={copy} className="text-gray-400 hover:text-[#DA9526] transition-colors ml-[6px] cursor-pointer" title={t('common.copy')}>
      {copied ? <Check size={13} strokeWidth={2.5} className="text-[#DA9526]" /> : <Copy size={13} strokeWidth={2} />}
    </button>
  );
}

export default Node;
