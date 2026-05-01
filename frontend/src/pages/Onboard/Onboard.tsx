import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { mutate } from 'swr';
import {
  ArrowLeft, X, ChevronDown, Sparkles, RotateCcw,
  KeyRound, FileKey, FolderOpen, Eye, EyeOff, Copy, Check,
  Power, Loader, AlertTriangle, ShieldCheck, Zap,
} from 'lucide-react';
import { useTranslation } from '@/i18n/context';
import type { Translations } from '@/i18n/translations';
type TFn = (key: keyof Translations, params?: Record<string, unknown>) => string;
import { useToast } from '@/hooks/useToast';
import { useNodeConfigStore, DEFAULT_REST_CORS, DEFAULT_RPC_LISTEN, DEFAULT_REST_LISTEN } from '@/store/nodeConfig';
import { useNodeSessionStore } from '@/store/nodeSession';
import { fetcher, post } from '@/lib/fetcher';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Toaster } from '@/components/ui/toaster';
import { GetDefaultNodeDir, OpenDirectorySelector } from '../../../wailsjs/go/wails/Bindings';
import { frontend } from '../../../wailsjs/go/models';
import type { InfoResponse, MnemonicResponse } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { KineticSpinner } from '@/components/ui/KineticSpinner';

// Linear, mode-dependent ordering. The seed for a newly created wallet is
// generated *by* the running daemon (aezeed is flnd-specific, cannot be
// generated client-side), so the reveal happens inside the launch overlay —
// not as a pre-launch step.
type Step =
  | 'node'
  | 'wallet-mode'
  | 'password'
  | 'seed-reveal'
  | 'restore'
  | 'review';

type WalletMode = 'create' | 'restore';
type RestoreKind = 'mnemonic' | 'hex';

type LaunchPhase =
  | 'idle'
  | 'verifying'
  | 'starting'
  | 'waiting-nowallet'
  | 'initializing-wallet'
  | 'done'
  | 'error';

function Onboard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();

  const {
    nodeDir, setNodeDir,
    setAliasName,
    restCors: storedRestCors, setRestCors,
    rpcListen: storedRpcListen, setRpcListen,
    restListen: storedRestListen, setRestListen,
    setNodePublic, setNodeIP,
  } = useNodeConfigStore();
  const { setUserStopped, setAutoUnlockPending } = useNodeSessionStore();

  // ── Wizard state (sensitive fields never persisted) ──────────────────────
  const [step, setStep] = useState<Step>('node');
  const [alias, setAlias] = useState('');
  const [aliasError, setAliasError] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [restCors, setLocalRestCors] = useState(storedRestCors || DEFAULT_REST_CORS);
  const [rpcListen, setLocalRpcListen] = useState(storedRpcListen || DEFAULT_RPC_LISTEN);
  const [restListen, setLocalRestListen] = useState(storedRestListen || DEFAULT_REST_LISTEN);

  const [walletMode, setWalletMode] = useState<WalletMode | null>(null);

  const [pwd, setPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [dirError, setDirError] = useState('');
  const [restCorsError, setRestCorsError] = useState('');
  const [rpcListenError, setRpcListenError] = useState('');
  const [restListenError, setRestListenError] = useState('');

  const [restoreKind, setRestoreKind] = useState<RestoreKind>('mnemonic');
  const [restoreMnemonic, setRestoreMnemonic] = useState('');
  const [restoreHex, setRestoreHex] = useState('');
  const [restoreSeedPassphrase, setRestoreSeedPassphrase] = useState('');
  const [restoreError, setRestoreError] = useState('');

  // Launch-overlay state — seed reveal lives here, not in a pre-launch step
  const [phase, setPhase] = useState<LaunchPhase>('idle');
  const [launchError, setLaunchError] = useState('');
  const [generatedWords, setGeneratedWords] = useState<string[]>([]);
  const [seedAck, setSeedAck] = useState(false);
  const [copied, setCopied] = useState(false);
  const cancelLaunchRef = useRef(false);

  // We no longer auto-populate the data directory so the user must actively choose one.
  useEffect(() => {
    if (step === 'node') {
      setNodeDir('');
    }
  }, []);

  const order: Step[] = walletMode === 'restore'
    ? ['node', 'wallet-mode', 'password', 'restore', 'review']
    : walletMode === 'create'
      ? ['node', 'wallet-mode', 'password', 'seed-reveal', 'review']
      : ['node', 'wallet-mode', 'password', 'review'];
  const stepIndex = Math.max(0, order.indexOf(step));
  const totalSteps = order.length;

  function goNext() {
    const idx = order.indexOf(step);
    if (idx >= 0 && idx < order.length - 1) setStep(order[idx + 1]);
  }
  function goBack() {
    const idx = order.indexOf(step);
    if (idx > 0) setStep(order[idx - 1]);
    else navigate('/');
  }

  function validateNode(): boolean {
    let valid = true;
    if (!alias.trim()) { setAliasError(true); valid = false; } else setAliasError(false);
    if (!nodeDir.trim()) { setDirError(t('validation.dir_required')); valid = false; }
    else if (dirError && dirError !== t('validation.dir_required')) valid = false; // preserve not_empty error
    
    if (restCors && !/^https?:\/\//.test(restCors) && restCors !== '*') {
      setRestCorsError(t('validation.invalid_cors')); valid = false;
    } else setRestCorsError('');

    const listenRegex = /^(\[?[0-9a-fA-F:]+\]?|(\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9.-]+)(:\d{1,5})?$/;
    if (rpcListen && !listenRegex.test(rpcListen)) {
      setRpcListenError(t('validation.invalid_listen')); valid = false;
    } else setRpcListenError('');

    if (restListen && !listenRegex.test(restListen)) {
      setRestListenError(t('validation.invalid_listen')); valid = false;
    } else setRestListenError('');

    if (!valid && (restCorsError || rpcListenError || restListenError)) {
      setShowAdvanced(true);
    }
    return valid;
  }
  function validatePassword(): boolean {
    if (pwd.length < 8) { setPwdError(t('onboard.errors.pwd_min')); return false; }
    if (pwd !== confirmPwd) { setPwdError(t('onboard.errors.pwd_match')); return false; }
    setPwdError('');
    return true;
  }
  function validateRestore(): boolean {
    if (restoreKind === 'mnemonic') {
      const words = restoreMnemonic.trim().split(/\s+/).filter(Boolean);
      if (words.length !== 24) { setRestoreError(t('onboard.errors.mnemonic_len')); return false; }
    } else if (walletMode === 'restore' && restoreKind === 'hex') {
      if (!restoreHex.trim()) { setRestoreError(t('onboard.errors.hex_required')); return false; }
    }
    setRestoreError('');
    return true;
  }

  async function handleNext() {
    if (step === 'node') {
      if (!validateNode()) return;
      // Re-verify directory emptiness on Continue click
      try {
        const { empty } = await fetcher<{empty: boolean}>(`/api/node/dir-empty?dir=${encodeURIComponent(nodeDir)}`);
        if (!empty) {
          setDirError(t('validation.dir_not_empty'));
          return;
        }
        setDirError('');
      } catch (err) {
        return; // Error already shown via toast in chooseNodeDir or similar
      }
    }
    if (step === 'wallet-mode' && !walletMode)         return;
    if (step === 'password'    && !validatePassword()) return;
    if (step === 'seed-reveal' && !seedAck)            return;
    if (step === 'restore'     && !validateRestore())  return;

    // Prefetch seed when going to seed-reveal
    const nextStep = order[order.indexOf(step) + 1];
    if (nextStep === 'seed-reveal' && generatedWords.length === 0) {
      try {
        const seed = await post<MnemonicResponse>('/api/wallet/seed', { aezeedPass: '' });
        setGeneratedWords(seed.mnemonic);
      } catch (err) {
        toast({ variant: 'destructive', title: t('onboard.errors.seed_gen_failed'), description: String(err) });
        return;
      }
    }

    goNext();
  }

  async function chooseNodeDir() {
    try {
      const defDir = await GetDefaultNodeDir().catch(() => '');
      const dir = await OpenDirectorySelector(frontend.OpenDialogOptions.createFrom({
        DefaultDirectory: nodeDir || defDir, DefaultFilename: '',
        Title: t('main.select_dir_title'), ShowHiddenFiles: true,
        CanCreateDirectories: true, ResolvesAliases: true,
        TreatPackagesAsDirectories: false,
      }));
      if (dir) {
        setNodeDir(dir);
        const { empty } = await fetcher<{empty: boolean}>(`/api/node/dir-empty?dir=${encodeURIComponent(dir)}`);
        if (!empty) {
          setDirError(t('validation.dir_not_empty'));
        } else {
          setDirError('');
        }
      }
    } catch (err) {
      const msg = String(err).toLowerCase();
      if (msg.includes('cancel') || msg === '') return;
      toast({ variant: 'destructive', title: t('main.errors.dir_error'), description: String(err) });
    }
  }

  async function copySeed() {
    try {
      await navigator.clipboard.writeText(generatedWords.join(' '));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  }

  function confirmSeedAck() {
    if (!seedAck) return;
    // No longer needed for launch phase, but kept for step validation
  }

  // ── Launch: verify → start → wait noWallet → (create: gen+reveal) → init ─
  async function handleLaunch() {
    if (phase !== 'idle') return;
    cancelLaunchRef.current = false;
    setLaunchError('');

    // Persist node config so power-on from Main works later
    setAliasName(alias.trim());
    setRestCors(restCors); setRpcListen(rpcListen); setRestListen(restListen);
    setNodePublic(true); setNodeIP('');
    setUserStopped(false);
    setAutoUnlockPending(false);

    try {
      setPhase('verifying');
      await post('/api/node/verify-config', {
        dir: nodeDir, alias: alias.trim(),
        restCors, rpcListen, restListen,
        nodePublic: true, nodeIP: '',
      });
      if (cancelLaunchRef.current) return;

      setPhase('starting');
      await post('/api/node/start', {});

      mutate('/api/info', (cur: InfoResponse | undefined) => ({
        ...cur,
        nodeRunning: true,
        state: 'starting',
        error: undefined,
        nodeAlias: cur?.nodeAlias || alias.trim(),
      } as InfoResponse), true);
      if (cancelLaunchRef.current) return;

      setPhase('waiting-nowallet');
      const info = await pollUntil<InfoResponse>(
        '/api/info',
        (r) => r.state === 'noWallet' || r.state === 'locked',
        { timeoutMs: 60_000, intervalMs: 500, cancelled: () => cancelLaunchRef.current },
      );
      if (cancelLaunchRef.current) return;
      if (info.state === 'locked') {
        throw new Error(t('onboard.errors.wallet_exists'));
      }

      // Create branch: use pre-generated seed from the wizard step.
      let mnemonicToUse = '';
      let aezeedPassToUse = '';
      if (walletMode === 'create') {
        mnemonicToUse = generatedWords.join(' ');
        aezeedPassToUse = '';
      } else if (restoreKind === 'mnemonic') {
        mnemonicToUse = restoreMnemonic.trim();
        aezeedPassToUse = restoreSeedPassphrase;
      } else {
        // Hex restore: we need a passphrase but it's not used for mnemonic conversion in InitWallet.
        // We'll pass an empty string or the provided pwd.
        aezeedPassToUse = '';
      }

      setPhase('initializing-wallet');
      await post('/api/wallet/init', {
        password: pwd,
        mnemonic: mnemonicToUse,
        aezeedPass: aezeedPassToUse,
        hex: walletMode === 'restore' && restoreKind === 'hex' ? restoreHex.trim() : '',
      });

      setPhase('done');
      // Clear seed from memory as soon as we navigate away.
      setGeneratedWords([]);
      
      mutate('/api/info');
      navigate('/node', { replace: true });
    } catch (err) {
      setPhase('error');
      setLaunchError(err instanceof Error ? err.message : String(err));
    }
  }

  function resetLaunch() {
    cancelLaunchRef.current = true;
    setPhase('idle');
    setLaunchError('');
    setSeedAck(false);
  }

  // ── UI classes ────────────────────────────────────────────────────────────
  const inputClass = "bg-[#1c1c1e] border-white/[0.06] text-white placeholder:text-gray-600 focus:border-[#DA9526]/60 focus:ring-0";

  const progressDots = order.map((s, i) => (
    <span
      key={s}
      className={`h-[4px] rounded-full transition-all duration-300 ${
        i < stepIndex ? 'w-[18px] bg-[#DA9526]'
        : i === stepIndex ? 'w-[28px] bg-[#DA9526]'
        : 'w-[18px] bg-white/[0.08]'
      }`}
    />
  ));

  const stepTitle = {
    'node':        t('onboard.node.title'),
    'wallet-mode': t('onboard.wallet.title'),
    'password':    t('onboard.password.title'),
    'seed-reveal': t('onboard.launch.reveal_title'),
    'restore':     t('onboard.restore.title'),
    'review':      t('onboard.review.title'),
  }[step];
  const stepDesc = {
    'node':        t('onboard.node.desc'),
    'wallet-mode': t('onboard.wallet.desc'),
    'password':    t('onboard.password.desc'),
    'seed-reveal': t('onboard.launch.reveal_desc'),
    'restore':     t('onboard.restore.desc'),
    'review':      t('onboard.review.desc'),
  }[step];

  const nextDisabled =
    step === 'wallet-mode' ? !walletMode :
    step === 'seed-reveal' ? !seedAck : false;


  return (
    <div className="relative flex flex-col h-full pt-[116px] overflow-hidden">
      {/* Top bar */}
      <div className="relative z-20 flex items-center justify-between px-[20px] pt-[18px] pb-[12px]">
        <button
          onClick={goBack}
          className="w-[32px] h-[32px] rounded-full flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] transition-colors"
          aria-label={t('onboard.back')}
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
        </button>
        <div className="flex items-center gap-[6px]">{progressDots}</div>
        <button
          onClick={() => navigate('/')}
          className="w-[32px] h-[32px] rounded-full flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] transition-colors"
          aria-label={t('onboard.cancel')}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="relative z-10 flex-1 overflow-hidden flex flex-col">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <div className="px-[24px] pt-[8px] pb-[4px] shrink-0">
              <p className="text-gray-500 text-[10px] font-label uppercase tracking-[0.12em]">
                {t('onboard.step_x_of_y', { x: stepIndex + 1, y: totalSteps })}
              </p>
              <h1 className="text-white text-[22px] font-bold font-headline tracking-tight mt-[6px]">
                {stepTitle}
              </h1>
              <p className="text-gray-500 text-[13px] font-body mt-[6px] leading-[1.4]">
                {stepDesc}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-[24px] py-[20px]">
              {step === 'node' && (
                <div className="flex flex-col gap-[18px]">
                  <Field label={t('onboard.node.alias')} errorText={aliasError ? t('validation.required') : undefined}>
                    <Input
                      type="text"
                      placeholder={t('onboard.node.alias_ph')}
                      value={alias}
                      onChange={e => { setAlias(e.target.value); setAliasError(false); }}
                      onKeyDown={e => e.key === 'Enter' && handleNext()}
                      className={`${inputClass} ${aliasError ? 'border-red-500 focus:border-red-500' : ''}`}
                      autoFocus
                    />
                  </Field>

                  <Field label={t('onboard.node.dir')} errorText={dirError}>
                    <div className={`flex items-center bg-[#1c1c1e] border rounded-md overflow-hidden ${dirError ? 'border-red-500' : 'border-white/[0.06]'}`}>
                      <input
                        type="text"
                        readOnly
                        value={nodeDir || t('main.select_dir_title')}
                        className="flex-1 px-[12px] bg-transparent border-none text-gray-400 text-[11px] font-mono py-[10px] focus:ring-0 outline-none w-full"
                      />
                      <button
                        type="button"
                        onClick={chooseNodeDir}
                        className="px-[12px] h-full flex items-center border-l border-white/[0.06] hover:bg-white/5 transition-colors py-[10px]"
                      >
                        <FolderOpen size={14} className="text-gray-500" />
                      </button>
                    </div>
                  </Field>

                  <button
                    type="button"
                    onClick={() => setShowAdvanced(v => !v)}
                    className="flex items-center gap-[8px] text-gray-500 hover:text-gray-300 transition-colors text-[12px] font-label uppercase tracking-[0.08em] mt-[4px]"
                  >
                    <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-0' : '-rotate-90'}`} />
                    {t('onboard.node.advanced')}
                  </button>
                  <div className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${showAdvanced ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="flex flex-col gap-[14px] pt-[4px]">
                      <Field label={t('config.rest_cors')} errorText={restCorsError}>
                        <Input className={`${inputClass} ${restCorsError ? 'border-red-500 focus:border-red-500' : ''}`} placeholder={DEFAULT_REST_CORS} value={restCors} onChange={e => { setLocalRestCors(e.target.value); setRestCorsError(''); }} />
                      </Field>
                      <Field label={t('config.rpc_listen')} errorText={rpcListenError}>
                        <Input className={`${inputClass} ${rpcListenError ? 'border-red-500 focus:border-red-500' : ''}`} placeholder={DEFAULT_RPC_LISTEN} value={rpcListen} onChange={e => { setLocalRpcListen(e.target.value); setRpcListenError(''); }} />
                      </Field>
                      <Field label={t('config.rest_listen')} errorText={restListenError}>
                        <Input className={`${inputClass} ${restListenError ? 'border-red-500 focus:border-red-500' : ''}`} placeholder={DEFAULT_REST_LISTEN} value={restListen} onChange={e => { setLocalRestListen(e.target.value); setRestListenError(''); }} />
                      </Field>
                    </div>
                  </div>
                </div>
              )}

              {step === 'wallet-mode' && (
                <div className="flex flex-col gap-[14px]">
                  <WalletModeCard
                    selected={false}
                    onClick={() => { setWalletMode('create'); goNext(); }}
                    icon={<Sparkles size={22} strokeWidth={1.8} />}
                    iconColor="#DA9526"
                    title={t('onboard.wallet.create')}
                    sub={t('onboard.wallet.create_sub')}
                  />
                  <WalletModeCard
                    selected={false}
                    onClick={() => { setWalletMode('restore'); goNext(); }}
                    icon={<RotateCcw size={22} strokeWidth={1.8} />}
                    iconColor="#5dc1c0"
                    title={t('onboard.wallet.restore')}
                    sub={t('onboard.wallet.restore_sub')}
                  />
                </div>
              )}

              {step === 'password' && (
                <div className="flex flex-col gap-[16px]">
                  <Field label={t('onboard.password.label')} errorText={pwdError && pwd.length < 8 ? pwdError : undefined}>
                    <div className="relative">
                      <Input
                        type={showPwd ? 'text' : 'password'}
                        placeholder={t('security.new_pwd_ph')}
                        value={pwd}
                        onChange={e => { setPwd(e.target.value); setPwdError(''); }}
                        onKeyDown={e => e.key === 'Enter' && handleNext()}
                        className={`${inputClass} pr-[44px] ${pwdError && pwd.length < 8 ? 'border-red-500 focus:border-red-500' : ''}`}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd(v => !v)}
                        className="absolute right-[12px] top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        {showPwd ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                      </button>
                    </div>
                  </Field>
                  <Field label={t('onboard.password.confirm')} errorText={pwdError && pwd.length >= 8 ? pwdError : undefined}>
                    <div className="relative">
                      <Input
                        type={showPwd ? 'text' : 'password'}
                        placeholder={t('wallet.pwd.repeat_ph')}
                        value={confirmPwd}
                        onChange={e => { setConfirmPwd(e.target.value); setPwdError(''); }}
                        onKeyDown={e => e.key === 'Enter' && handleNext()}
                        className={`${inputClass} pr-[44px] ${pwdError && pwd !== confirmPwd ? 'border-red-500 focus:border-red-500' : ''}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd(v => !v)}
                        className="absolute right-[12px] top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        {showPwd ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                      </button>
                    </div>
                  </Field>
                  <div className="flex items-start gap-[10px] mt-[4px] px-[2px]">
                    <AlertTriangle size={14} strokeWidth={1.8} className="text-[#DA9526] shrink-0 mt-[2px]" />
                    <p className="text-gray-500 text-[11px] font-body leading-[1.5]">
                      {t('onboard.password.warn')}
                    </p>
                  </div>
                </div>
              )}

              {step === 'restore' && (
                <div className="flex flex-col gap-[16px]">
                  <div className="grid grid-cols-2 gap-[8px] p-[4px] bg-[#1c1c1e] border border-white/[0.06] rounded-xl">
                    <RestoreTab
                      active={restoreKind === 'mnemonic'}
                      onClick={() => { setRestoreKind('mnemonic'); setRestoreError(''); }}
                      icon={<KeyRound size={14} strokeWidth={1.8} />}
                      label={t('onboard.restore.mnemonic')}
                    />
                    <RestoreTab
                      active={restoreKind === 'hex'}
                      onClick={() => { setRestoreKind('hex'); setRestoreError(''); }}
                      icon={<FileKey size={14} strokeWidth={1.8} />}
                      label={t('onboard.restore.hex')}
                    />
                  </div>

                  {restoreKind === 'mnemonic' ? (
                    <>
                      <Field label={t('onboard.restore.mnemonic_label')} errorText={restoreError || undefined}>
                        <textarea
                          className={`w-full bg-[#1c1c1e] border rounded-md p-3 text-white text-[13px] placeholder:text-gray-600 focus:border-[#DA9526]/60 outline-none min-h-[120px] resize-none transition-colors font-mono ${restoreError ? 'border-red-500' : 'border-white/[0.06]'}`}
                          placeholder={t('wallet.import.recovery_ph')}
                          value={restoreMnemonic}
                          onChange={e => { setRestoreMnemonic(e.target.value); setRestoreError(''); }}
                        />
                      </Field>
                      <Field label={`${t('wallet.import.seed_pwd')} · ${t('wallet.new.optional')}`}>
                        <Input
                          type="password"
                          placeholder={t('wallet.import.seed_pwd_ph')}
                          value={restoreSeedPassphrase}
                          onChange={e => setRestoreSeedPassphrase(e.target.value)}
                          className={inputClass}
                        />
                      </Field>
                    </>
                  ) : (
                    <Field label={t('onboard.restore.hex_label')} errorText={restoreError || undefined}>
                      <textarea
                        className={`w-full bg-[#1c1c1e] border rounded-md p-3 text-white text-[13px] placeholder:text-gray-600 focus:border-[#DA9526]/60 outline-none min-h-[120px] resize-none transition-colors font-mono break-all ${restoreError ? 'border-red-500' : 'border-white/[0.06]'}`}
                        placeholder="hex..."
                        value={restoreHex}
                        onChange={e => { setRestoreHex(e.target.value); setRestoreError(''); }}
                      />
                    </Field>
                  )}
                </div>
              )}
              
              {step === 'seed-reveal' && (
                <div className="flex flex-col gap-[14px]">
                  <div className="relative bg-[#1c1c1e] border border-white/[0.06] rounded-xl p-[16px]">
                    <div className="grid grid-cols-3 gap-x-[12px] gap-y-[10px]">
                      {generatedWords.map((word, i) => (
                        <div key={i} className="flex items-center gap-[6px]">
                          <span className="text-gray-600 text-[10px] w-[16px] text-right shrink-0">{i + 1}.</span>
                          <span className="text-white text-[13px] font-medium truncate">{word}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={copySeed}
                      className="absolute top-[10px] right-[10px] w-[28px] h-[28px] rounded-full flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] transition-colors"
                      aria-label={t('common.copy')}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>

                  <div className="flex items-start gap-[10px] mt-[14px] px-[2px]">
                    <AlertTriangle size={14} strokeWidth={1.8} className="text-[#DA9526] shrink-0 mt-[2px]" />
                    <p className="text-gray-500 text-[11px] font-body leading-[1.5]">
                      {t('onboard.seed.warn')}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSeedAck(v => !v)}
                    className={`mt-[16px] w-full flex items-center gap-[12px] p-[14px] rounded-xl border transition-all text-left ${
                      seedAck ? 'border-[#DA9526]/60 bg-[#DA9526]/10' : 'border-white/[0.06] bg-[#1c1c1e] hover:bg-white/[0.03]'
                    }`}
                  >
                    <span className={`w-[18px] h-[18px] shrink-0 rounded border flex items-center justify-center transition-colors ${
                      seedAck ? 'bg-[#DA9526] border-[#DA9526]' : 'border-white/[0.16]'
                    }`}>
                      {seedAck && <Check size={12} strokeWidth={3} color="#000" />}
                    </span>
                    <span className="text-white text-[13px] font-body">{t('onboard.seed.ack')}</span>
                  </button>
                </div>
              )}

              {step === 'review' && (
                <div className="flex flex-col items-center justify-center py-[4px]">
                  {/* Planetary Power Button Section */}
                  <div className="relative flex items-center justify-center w-[210px] h-[210px] mb-[10px]">
                    {/* Unified Kinetic Spinner - core hidden so button can take its place */}
                    <div className="absolute inset-0 pointer-events-none">
                      <KineticSpinner size={210} showCore={false} />
                    </div>

                    <button
                      type="button"
                      onClick={handleLaunch}
                      disabled={phase !== 'idle'}
                      className={`relative z-10 w-[72px] h-[72px] rounded-full border-2 border-[#DA9526] bg-[#1a1a1a] flex items-center justify-center transition-all duration-300 shadow-[0_0_40px_rgba(218,149,38,0.2)] group ${phase !== 'idle' ? 'cursor-wait opacity-50' : 'hover:scale-[1.08] hover:shadow-[0_0_50px_rgba(218,149,38,0.3)] active:scale-[0.96]'}`}
                    >
                      {phase !== 'idle' && phase !== 'error' ? (
                        <div className="scale-110">
                          <KineticSpinner size={28} coreSize={7} />
                        </div>
                      ) : (
                        <Power size={28} strokeWidth={2} className="text-[#DA9526] group-hover:scale-110 transition-transform" />
                      )}
                    </button>
                  </div>

                  {/* Compact Glassmorphic Summary Card */}
                  <div className="w-full max-w-[340px] bg-white/[0.03] border border-white/[0.06] rounded-xl p-[14px] backdrop-blur-md">
                    <div className="flex items-center justify-between mb-[12px]">
                      <div className="flex flex-col">
                        <span className="text-gray-500 text-[8px] font-label uppercase tracking-widest">Node Identity</span>
                        <h1 className="text-white text-[18px] font-bold font-headline">{alias || t('main.default_alias')}</h1>
                      </div>
                      <div className="flex items-center gap-[6px] px-[8px] py-[3px]">
                        <span className="w-[6px] h-[6px] rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                        <span className="text-emerald-500/80 text-[10px] font-bold uppercase tracking-widest">Ready</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-[8px]">
                      <div className="flex items-center gap-[8px] p-[8px] rounded-lg bg-white/[0.02] border border-white/[0.04]">
                        <ShieldCheck size={14} className="text-[#DA9526] shrink-0" />
                        <div className="flex flex-col">
                          <span className="text-gray-500 text-[8px] uppercase tracking-wider font-semibold">Security</span>
                          <span className="text-white text-[10px] font-medium">{walletMode === 'create' ? 'Secured' : 'Restored'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-[8px] p-[8px] rounded-lg bg-white/[0.02] border border-white/[0.04]">
                        <Zap size={14} className="text-cyan-400 shrink-0" />
                        <div className="flex flex-col">
                          <span className="text-gray-500 text-[8px] uppercase tracking-wider font-semibold">Network</span>
                          <span className="text-white text-[10px] font-medium">Mainnet</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-[12px] pt-[10px] border-t border-white/[0.05]">
                      <div className="flex items-start gap-[8px] text-gray-500 text-[10px] font-body leading-relaxed">
                        <Sparkles size={12} className="text-[#DA9526] shrink-0 mt-[2px]" />
                        <p>{t('onboard.review.sync_warn') || "Your first launch will synchronize with the blockchain. This may take some time depending on your connection."}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {step !== 'review' && step !== 'wallet-mode' && (
        <div className="relative z-10 shrink-0 px-[24px] py-[20px] border-t border-white/[0.05] bg-transparent">
          <button
            type="button"
            onClick={handleNext}
            disabled={nextDisabled}
            className="w-full h-[50px] rounded-xl bg-[#DA9526] text-black font-semibold font-label text-[15px] hover:bg-[#c8871f] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('onboard.next')}
          </button>
        </div>
      )}

      {phase !== 'idle' && (
        <LaunchOverlay
          phase={phase}
          error={launchError}
          words={generatedWords}
          copied={copied}
          onCopy={copySeed}
          seedAck={seedAck}
          onToggleAck={() => setSeedAck(v => !v)}
          onConfirmAck={confirmSeedAck}
          onDismiss={resetLaunch}
          t={t}
        />
      )}

      <Toaster />
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function WalletModeCard({
  selected, onClick, icon, iconColor, title, sub,
}: {
  selected: boolean; onClick: () => void;
  icon: React.ReactNode; iconColor: string; title: string; sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-[16px] p-[18px] rounded-xl border text-left transition-all ${
        selected
          ? 'border-[#DA9526] bg-[#DA9526]/[0.08]'
          : 'border-white/[0.06] bg-[#1c1c1e] hover:bg-white/[0.03]'
      }`}
    >
      <div className="w-[44px] h-[44px] rounded-full bg-[#121212] border border-white/[0.08] flex items-center justify-center shrink-0" style={{ color: iconColor }}>
        {icon}
      </div>
      <div className="flex flex-col gap-[2px]">
        <span className="text-white text-[15px] font-semibold font-headline">{title}</span>
        <span className="text-gray-500 text-[12px] font-body">{sub}</span>
      </div>
    </button>
  );
}

function RestoreTab({
  active, onClick, icon, label,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-[8px] h-[38px] rounded-lg text-[12px] font-label uppercase tracking-[0.06em] transition-all ${
        active
          ? 'bg-[#DA9526] text-black'
          : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.03]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}


function ReviewRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-[4px] p-[14px] rounded-xl bg-[#1c1c1e] border border-white/[0.06]">
      <span className="text-gray-500 text-[10px] font-label uppercase tracking-[0.08em]">{label}</span>
      <span className={`text-white text-[13px] ${mono ? 'font-mono break-all' : 'font-body'}`}>{value}</span>
    </div>
  );
}

function LaunchOverlay({
  phase, error, words, copied, onCopy,
  seedAck, onToggleAck, onConfirmAck, onDismiss, t,
}: {
  phase: LaunchPhase; error: string;
  words: string[]; copied: boolean; onCopy: () => void;
  seedAck: boolean; onToggleAck: () => void; onConfirmAck: () => void;
  onDismiss: () => void;
  t: TFn;
}) {
  const isError = phase === 'error';

  const phaseLabel = {
    'verifying':           t('onboard.launch.verifying'),
    'starting':            t('onboard.launch.starting'),
    'waiting-nowallet':    t('onboard.launch.waiting'),
    'initializing-wallet': t('onboard.launch.initializing'),
    'done':                t('onboard.launch.done'),
    'error':               t('onboard.launch.error'),
  }[phase as Exclude<LaunchPhase, 'idle' | 'reveal-seed'>] ?? '';
  const phaseSub = isError ? error : {
    'verifying':           t('onboard.launch.verifying_sub'),
    'starting':            t('onboard.launch.starting_sub'),
    'waiting-nowallet':    t('onboard.launch.waiting_sub'),
    'initializing-wallet': t('onboard.launch.initializing_sub'),
    'done':                '',
  }[phase as Exclude<LaunchPhase, 'idle' | 'reveal-seed' | 'error'>] ?? '';

  return (
    <div className={`fixed inset-0 z-[100] bg-[#121212] flex flex-col items-center justify-center p-[40px] ${!isError && phase !== 'done' ? 'cursor-wait' : ''}`}>
      <div className="relative flex items-center justify-center w-[200px] h-[200px]">
        {!isError && phase !== 'done' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <KineticSpinner size={200} />
          </div>
        )}
        <div className={`relative w-[80px] h-[80px] rounded-full border-2 ${isError ? 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]' : 'border-[#DA9526] bg-[#1a1a1a]'} flex items-center justify-center z-10`}>
          {isError
            ? <AlertTriangle size={30} strokeWidth={1.8} color="#ef4444" />
            : <Power size={30} strokeWidth={1.8} color="#DA9526" />}
        </div>
      </div>
      <h2 className={`text-[20px] font-bold font-headline mt-[28px] tracking-tight ${isError ? 'text-red-400' : 'text-white'}`}>
        {phaseLabel}
      </h2>
      <p className="text-gray-500 text-[13px] font-body mt-[8px] text-center max-w-[320px] leading-[1.5]">
        {phaseSub}
      </p>
      {isError && (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-[28px] h-[44px] px-[24px] rounded-xl border border-white/[0.08] text-gray-300 text-[13px] font-label uppercase tracking-[0.06em] hover:bg-white/[0.04] transition-colors"
        >
          {t('onboard.launch.dismiss')}
        </button>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function pollUntil<T>(
  url: string,
  predicate: (res: T) => boolean,
  opts: { timeoutMs: number; intervalMs: number; cancelled?: () => boolean },
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (opts.cancelled?.()) throw new Error('cancelled');
    try {
      const data = await fetcher<T>(url);
      if (predicate(data)) return data;
    } catch { /* transient fetch errors while daemon boots */ }
    await new Promise(r => setTimeout(r, opts.intervalMs));
  }
  throw new Error('Timed out waiting for daemon');
}

async function waitUntil(check: () => boolean, intervalMs: number): Promise<void> {
  while (!check()) {
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

export default Onboard;
