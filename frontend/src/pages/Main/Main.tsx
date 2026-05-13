import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { mutate } from 'swr';
import { useInfo } from '@/hooks/useInfo';
import { Loader, Power, Plus, FolderOpen, Edit2, Check, X, Trash2 } from 'lucide-react';
import { KineticSpinner } from '@/components/ui/KineticSpinner';
import type { InfoResponse } from '@/lib/types';

import { useTranslation } from '@/i18n/context';
import { useNodeConfigStore, DEFAULT_REST_CORS, DEFAULT_RPC_LISTEN, DEFAULT_REST_LISTEN } from '@/store/nodeConfig';

type NodeConfigDTO = {
  pubKey: string; alias: string; nodePublic: boolean; nodeIP: string;
  restCors: string; rpcListen: string; restListen: string;
};
import { useNodeSessionStore } from '@/store/nodeSession';
import { useEventStream } from '@/hooks/useEventStream';
import { useTransitionStore } from '@/components/TransitionOverlay/TransitionOverlay';
import { useToast } from '@/hooks/useToast';
import { fetcher, post, patch } from '@/lib/fetcher';
import { Toaster } from '@/components/ui/toaster';
import { GetDefaultNodeDir, OpenDirectorySelector } from '../../../wailsjs/go/wails/Bindings';
import { frontend } from '../../../wailsjs/go/models';

function Main() {
  const { t } = useTranslation();
  const {
    aliasName, setAliasName,
    nodeDir,   setNodeDir,
    setPubKey,
    fetchLastNode,
  } = useNodeConfigStore();
  const { userStopped, setUserStopped, setAutoUnlockPending } = useNodeSessionStore();
  const navigate = useNavigate();
  const { data: info } = useInfo();
  const { toast } = useToast();
  const autoStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { connected } = useEventStream();
  const transitionActive = useTransitionStore(s => s.isActive);
  const endTransition   = useTransitionStore(s => s.endTransition);

  // Dismiss the stopping overlay once the SSE disconnects (daemon down).
  useEffect(() => {
    if (!transitionActive || !userStopped) return;
    if (connected) return;
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    endTransition();
  }, [transitionActive, userStopped, connected]);

  // Safety net: clear overlay after 30 s in case SSE never disconnects.
  useEffect(() => {
    if (!transitionActive || !userStopped) return;
    safetyTimerRef.current = setTimeout(() => endTransition(), 30_000);
    return () => { if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current); };
  }, [transitionActive, userStopped]);

  // existingDir: true once we confirm the current nodeDir contains flnd data
  const [existingDir, setExistingDir] = useState(false);

  // power button shown for returning users (stored alias) OR discovered existing dir
  const hasStoredNode = !!(nodeDir && aliasName);
  const hasPriorNode  = hasStoredNode || existingDir;

  // alias to display — fallback to translated default when dir found but no alias yet
  const displayAlias = aliasName || t('main.default_alias');

  // autoStarting drives the power-button pulse while a manual start is
  // in flight. We no longer auto-start on mount — the user always lands
  // on this screen and taps power themselves.
  const [autoStarting, setAutoStarting] = useState(false);
  const [isEditingAlias, setIsEditingAlias] = useState(false);
  const [tempAlias, setTempAlias] = useState('');

  // Check a dir for existing flnd data
  async function checkDir(dir: string) {
    try {
      const res = await fetcher<{ exists: boolean }>(`/api/node/check-dir?dir=${encodeURIComponent(dir)}`);
      setExistingDir(res.exists);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchLastNode();
  }, []);

  // Sanity-check the stored nodeDir for existing data on mount / dir change.
  useEffect(() => {
    if (nodeDir) {
      checkDir(nodeDir);
      return;
    }
    GetDefaultNodeDir()
      .then(dir => { if (dir) { setNodeDir(dir); checkDir(dir); } })
      .catch(() => {});
  }, [nodeDir]);

  // If the daemon is already running (e.g. navigated back here from /settings),
  // jump straight to /node. This never fires on a fresh launch because the
  // backend service is nil until RunNode() is called.
  useEffect(() => {
    if (!info?.nodeRunning) return;
    navigate('/node', { replace: true });
  }, [info?.nodeRunning]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowRecentModal(false);
        setIsEditingAlias(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);


  function handleEditAlias() {
    setTempAlias(displayAlias);
    setIsEditingAlias(true);
  }

  const [aliasLoading, setAliasLoading] = useState(false);
  const [aliasError, setAliasError] = useState<string | undefined>(undefined);
  const [aliasSuccess, setAliasSuccess] = useState(false);

  async function handleSaveAlias() {
    const trimmed = tempAlias.trim();
    if (!isAliasDirty || aliasLoading || aliasSuccess) {
      setIsEditingAlias(false);
      return;
    }

    setAliasLoading(true);
    setAliasError(undefined);
    setAliasSuccess(false);

    try {
      setAliasName(trimmed);
      if (nodeDir) {
        await patch('/api/node/identity', { dir: nodeDir, alias: trimmed });
      }
      setAliasLoading(false);
      setAliasSuccess(true);
      setTimeout(() => { setAliasSuccess(false); setIsEditingAlias(false); }, 2000);
    } catch (err: any) {
      setAliasError(String(err));
      setAliasLoading(false);
    }
  }

  const isAliasDirty = tempAlias !== displayAlias;

  // Manual-start watchdog: if the user taps power and the daemon never comes
  // up within 60s, surface a timeout toast and restore the idle state.
  useEffect(() => {
    if (!autoStarting) {
      if (autoStartTimerRef.current) {
        clearTimeout(autoStartTimerRef.current);
        autoStartTimerRef.current = null;
      }
      return;
    }
    autoStartTimerRef.current = setTimeout(() => {
      setAutoStarting(false);
      toast({ variant: 'destructive', title: t('main.errors.start_failed'), description: t('node.errors.start_timeout') });
    }, 60_000);
    return () => {
      if (autoStartTimerRef.current) {
        clearTimeout(autoStartTimerRef.current);
        autoStartTimerRef.current = null;
      }
    };
  }, [autoStarting]);

  // ── Start handlers ───────────────────────────────────────────────────────────
  // `setAutoUnlockPending(true)` tells /node to pop the unlock sheet as soon
  // as the daemon reports `locked`. We only set it for user-initiated starts
  // from Main, so other flows (manual nav to /node, restart-from-down, etc.)
  // keep the default "tap lock icon to unlock" behaviour.
  async function performStart(dir: string, alias: string) {
    setUserStopped(false);
    setAutoUnlockPending(true);
    setAutoStarting(true);
    try {
      // Fetch config from DB — authoritative source for this node's settings.
      const cfg = await fetcher<NodeConfigDTO>(`/api/node/config?dir=${encodeURIComponent(dir)}`);
      // Prefer DB alias; fall back to the passed alias (e.g. freshly entered in wizard).
      const effectiveAlias = cfg.alias || alias;
      await post('/api/node/verify-config', {
        dir, alias: effectiveAlias,
        restCors:   cfg.restCors   || DEFAULT_REST_CORS,
        rpcListen:  cfg.rpcListen  || DEFAULT_RPC_LISTEN,
        restListen: cfg.restListen || DEFAULT_REST_LISTEN,
        nodePublic: cfg.nodePublic ?? true,
        nodeIP:     cfg.nodeIP     || '',
      });
      await post('/api/node/start', {});

      mutate('/api/info', (cur: InfoResponse | undefined) => ({
        ...cur,
        nodeRunning: true,
        state: 'starting',
        error: undefined,
        nodeAlias: cur?.nodeAlias || effectiveAlias,
      } as InfoResponse), true);

      navigate('/node');
    } catch (error) {
      setAutoStarting(false);
      setAutoUnlockPending(false);
      toast({ variant: 'destructive', title: t('main.errors.node_error'), description: String(error) });
    }
  }

  async function startNode() {
    // Pass store alias as fallback; performStart prefers the DB alias when available.
    await performStart(nodeDir, aliasName || t('main.default_alias'));
  }

  // ── Recent Nodes Logic ──────────────────────────────────────────────────────
  const [recentNodes, setRecentNodes] = useState<any[]>([]);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [sheetDrag, setSheetDrag] = useState(0);
  const sheetDragStart = useRef(0);
  const isDraggingSheet = useRef(false);
  
  async function fetchRecent() {
    try {
      const nodes = await fetcher<any[]>('/api/node/list');
      setRecentNodes(nodes || []);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchRecent();
  }, []);

  async function handleSwitchNode(node: any) {
    setShowRecentModal(false);

    // Update identity fields in the store for display.
    const store = useNodeConfigStore.getState();
    store.setNodeDir(node.dir);
    store.setAliasName(node.alias || '');
    store.setPubKey(node.pubKey || '');

    // Re-save the full record so last_opened is updated (marks this as the current node).
    await post('/api/node/config', {
      pubKey:     node.pubKey     || '',
      dir:        node.dir,
      alias:      node.alias      || '',
      nodePublic: node.nodePublic ?? true,
      externalIP: node.externalIP || '',
      restCors:   node.restCors   || DEFAULT_REST_CORS,
      rpcListen:  node.rpcListen  || DEFAULT_RPC_LISTEN,
      restListen: node.restListen || DEFAULT_REST_LISTEN,
    });
    await fetchRecent();

    const currentAlias = node.alias || t('main.default_alias');
    await performStart(node.dir, currentAlias);
  }

  async function handleRemoveNode(dir: string) {
    if (confirmRemove !== dir) { setConfirmRemove(dir); return; }
    setConfirmRemove(null);
    try {
      await fetcher(`/api/node/remove?dir=${encodeURIComponent(dir)}`, { method: 'DELETE' });
      setRecentNodes(prev => prev.filter(n => n.dir !== dir));
    } catch { /* ignore */ }
  }

  async function handleOpenExisting() {
    await fetchRecent();
    if (recentNodes.length === 0) {
      chooseNodeDir();
      return;
    }
    setShowRecentModal(true);
  }

  async function chooseNodeDir() {
    setShowRecentModal(false);
    try {
      const dir = await OpenDirectorySelector(frontend.OpenDialogOptions.createFrom({
        DefaultDirectory: nodeDir,
        DefaultFilename: '',
        Title: t('main.select_dir_title'),
        ShowHiddenFiles: true,
        CanCreateDirectories: true,
        ResolvesAliases: true,
        TreatPackagesAsDirectories: false,
        CanSelectFiles: false,
      }));
      if (dir) {
        // Sanity check: is this a node?
        const res = await fetcher<{ exists: boolean }>(`/api/node/check-dir?dir=${encodeURIComponent(dir)}`);
        if (res.exists) {
          const cfg = await fetcher<NodeConfigDTO>(`/api/node/config?dir=${encodeURIComponent(dir)}`);
          setNodeDir(dir);
          setAliasName(cfg.alias || '');
          setPubKey(cfg.pubKey || '');
          setExistingDir(true);
          // Persist to DB (touches last_opened so it appears in "Recent").
          await post('/api/node/config', {
            pubKey:     cfg.pubKey     || '',
            dir,
            alias:      cfg.alias      || '',
            nodePublic: cfg.nodePublic ?? true,
            externalIP: cfg.nodeIP     || '',
            restCors:   cfg.restCors   || DEFAULT_REST_CORS,
            rpcListen:  cfg.rpcListen  || DEFAULT_RPC_LISTEN,
            restListen: cfg.restListen || DEFAULT_REST_LISTEN,
          });
          await fetchRecent();
          const currentAlias = cfg.alias || t('main.default_alias');
          await performStart(dir, currentAlias);
        } else {
          toast({
            variant: 'destructive',
            title: t('main.errors.node_error'),
            description: t('main.errors.not_a_node')
          });
        }
      }
    } catch (error) {
      const msg = String(error).toLowerCase();
      if (msg.includes('cancel') || msg === '') return;
      toast({ variant: 'destructive', title: t('main.errors.dir_error'), description: String(error) });
    }
  }

  // ── Status pill label ────────────────────────────────────────────────────────
  const statusLabel = autoStarting ? t('main.status.starting') : t('main.status.offline');
  const statusDot   = autoStarting ? 'bg-amber-500' : 'bg-red-500';

  // ── Unified layout ────────────────────────────────────────────────────────────
  return (
    <div className={`relative flex flex-col h-screen overflow-hidden select-none ${autoStarting ? 'cursor-wait' : ''}`}>
      {/* Spinner overlay — absolute so it centers at screen center independently
          of the flex spacers below. Appears when power-on is in flight. */}
      {hasPriorNode && autoStarting && (
        <motion.div
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
        >
          <KineticSpinner size={260} />
        </motion.div>
      )}

      {/* ── Power button section — only for returning users ── */}
      {hasPriorNode && (
        <div className={`flex-1 flex flex-col items-center justify-center relative z-10 ${autoStarting ? 'pointer-events-none' : ''}`}>
          {/* Top spacer for header */}
          {!autoStarting && <div className="h-[96px] shrink-0" />}
          
          <div className="flex-1 flex flex-col items-center justify-center">
            {/* Concentric rings + button */}
            <div className="relative flex items-center justify-center w-[260px] h-[260px]">
              {!autoStarting && (
                <>
                  <div className={`absolute w-[250px] h-[250px] rounded-full border border-amber-500 opacity-[0.04]`} />
                  <div className={`absolute w-[210px] h-[210px] rounded-full border border-amber-500 opacity-[0.08]`} />
                  <div className={`absolute w-[170px] h-[170px] rounded-full border border-amber-500 opacity-[0.14]`} />
                  <div className={`absolute w-[130px] h-[130px] rounded-full border border-amber-500 opacity-[0.25]`} />
                </>
              )}

              <button
                onClick={startNode}
                disabled={autoStarting}
                title={autoStarting ? t('main.power_hint_starting') : t('main.power_hint')}
                aria-label={autoStarting ? t('main.power_hint_starting') : t('main.power_hint')}
                className={`relative w-[96px] h-[96px] rounded-full flex items-center justify-center transition-all duration-300 focus:outline-none z-10 ${
                  autoStarting 
                    ? 'border-none bg-transparent scale-[1.04]' 
                    : 'border-2 border-[#DA9526] bg-[#1a1a1a] hover:scale-[1.04] active:scale-[0.97]'
                }`}
              >
                {!autoStarting && (
                  <Power size={38} strokeWidth={1.8} color="#DA9526" />
                )}
              </button>
            </div>

            {/* Node identity + status */}
            <div className="flex flex-col items-center gap-[4px] relative group mt-[20px]">
              {isEditingAlias ? (
                <div className="flex flex-col items-center gap-[8px]">
                  <div className="flex items-center gap-[8px]">
                    <input
                      autoFocus
                      type="text"
                      value={tempAlias}
                      placeholder={t('main.default_alias')}
                      disabled={aliasLoading}
                      onChange={e => { setTempAlias(e.target.value); setAliasError(undefined); }}
                      onKeyDown={e => e.key === 'Enter' && handleSaveAlias()}
                      onBlur={() => !aliasLoading && !aliasError && handleSaveAlias()}
                      className="bg-transparent border-b border-white/20 text-white text-[32px] font-bold font-headline text-center focus:outline-none focus:border-cyan-500/50 w-[300px] cursor-pointer focus:cursor-text disabled:opacity-50 placeholder:text-gray-600"
                    />
                    {(isAliasDirty || aliasLoading || aliasSuccess) && (
                      <button 
                        onClick={handleSaveAlias}
                        disabled={aliasLoading || aliasSuccess}
                        className={`w-[36px] h-[36px] rounded-lg transition-all flex items-center justify-center text-black shadow-lg active:scale-[0.9] cursor-pointer disabled:cursor-default ${
                          aliasSuccess ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-cyan-500 hover:bg-cyan-400 shadow-cyan-500/30'
                        }`}
                      >
                        {aliasLoading ? (
                          <Loader size={20} className="animate-spin" />
                        ) : aliasSuccess ? (
                          <Check size={20} strokeWidth={4} />
                        ) : (
                          <Check size={20} strokeWidth={3} />
                        )}
                      </button>
                    )}
                  </div>
                  {tempAlias === '' && (
                    <motion.span 
                      initial={{ opacity: 0, y: -5 }} 
                      animate={{ opacity: 1, y: 0 }} 
                      className="text-cyan-500/60 text-[10px] font-label uppercase tracking-widest"
                    >
                      {t('config.alias_default_hint')}
                    </motion.span>
                  )}
                  {aliasError && <span className="text-red-400 text-[11px] mt-[4px]">{aliasError}</span>}
                </div>
              ) : (
                <div className="flex items-center gap-[12px] translate-x-[16px]">
                  <h1 className="text-white text-[32px] font-bold font-headline">{displayAlias}</h1>
                  <button
                    onClick={handleEditAlias}
                    className="opacity-0 group-hover:opacity-100 p-2 hover:bg-white/5 rounded-full transition-all text-gray-400 hover:text-white"
                    title={t('main.configure')}
                  >
                    <Edit2 size={16} />
                  </button>
                </div>
              )}

              {/* Status pill */}
              <div className="flex items-center gap-[7px] px-[16px] py-[7px] rounded-full bg-[#1e1e1e] border border-white/[0.06] mt-[10px]">
                <span className={`w-[7px] h-[7px] rounded-full ${statusDot} ${autoStarting ? 'animate-pulse' : ''}`} />
                <span className="text-[11px] font-mono tracking-widest text-gray-400 uppercase">
                  {statusLabel}
                </span>
              </div>
            </div>

            <p className="text-gray-400 text-[11px] font-body mt-[10px] tracking-wide">
              {autoStarting ? t('main.power_hint_starting') : t('main.power_hint')}
            </p>
          </div>

          {/* Bottom spacer for action menu */}
          {!autoStarting && <div className="h-[280px] shrink-0" />}
        </div>
      )}

      {/* No prior node: center the action buttons in the remaining space */}
      {!hasPriorNode && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-full border-t border-white/[0.05]">
            <button
              onClick={() => navigate('/onboard')}
              className="w-full flex items-center gap-[16px] px-[24px] py-[18px] hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors text-left"
            >
              <div className="w-[44px] h-[44px] rounded-full bg-[#1e1e1e] border border-white/[0.08] flex items-center justify-center shrink-0">
                <Plus size={20} strokeWidth={1.8} className="text-[#DA9526]" />
              </div>
              <div className="flex flex-col gap-[2px]">
                <span className="text-white text-[15px] font-semibold font-headline">{t('main.create_new')}</span>
                <span className="text-gray-400 text-[12px] font-body">{t('main.create_new_sub')}</span>
              </div>
            </button>
            <div className="h-[1px] bg-white/[0.05] mx-[24px]" />
            <button
              onClick={handleOpenExisting}
              className="w-full flex items-center gap-[16px] px-[24px] py-[18px] hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors text-left"
            >
              <div className="w-[44px] h-[44px] rounded-full bg-[#1e1e1e] border border-white/[0.08] flex items-center justify-center shrink-0">
                <FolderOpen size={20} strokeWidth={1.8} className="text-cyan-400" />
              </div>
              <div className="flex flex-col gap-[2px]">
                <span className="text-white text-[15px] font-semibold font-headline">{t('main.open_existing')}</span>
                <span className="text-gray-400 text-[12px] font-body">{t('main.open_existing_sub')}</span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ── Another instance warning ── */}
      {info?.anotherInstance && (
        <div className="mx-[20px] mb-[12px] px-[14px] py-[10px] rounded-xl bg-red-500/10 border border-red-500/30 relative z-10">
          <p className="text-red-400 text-[12px] font-body">{t('node.errors.another_instance')}</p>
        </div>
      )}

      {/* ── Collapsible: action rows + logs button ──
          Positioned absolute bottom to ensure the power button above remains perfectly centered in the window.
          Only rendered for returning users — the !hasPriorNode case uses the centered layout above. */}
      {hasPriorNode && <div
        aria-hidden={autoStarting}
        className={`absolute bottom-0 left-0 right-0 z-20 overflow-hidden transition-[max-height,opacity,transform] duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
          autoStarting
            ? 'max-h-0 opacity-0 translate-y-[20px] pointer-events-none'
            : 'max-h-[380px] opacity-100 translate-y-0'
        }`}
      >
        {/* Action rows */}
        <div className="bg-gradient-to-t from-[#121212] via-[#121212]/95 to-transparent pt-[40px] pb-[20px]">
          <div className="border-t border-white/[0.05]">
          {/* Create New Node */}
          <button
            onClick={() => navigate('/onboard')}
            className="w-full flex items-center gap-[16px] px-[24px] py-[18px] hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors text-left"
          >
            <div className="w-[44px] h-[44px] rounded-full bg-[#1e1e1e] border border-white/[0.08] flex items-center justify-center shrink-0">
              <Plus size={20} strokeWidth={1.8} className="text-[#DA9526]" />
            </div>
            <div className="flex flex-col gap-[2px]">
              <span className="text-white text-[15px] font-semibold font-headline">{t('main.create_new')}</span>
              <span className="text-gray-400 text-[12px] font-body">{t('main.create_new_sub')}</span>
            </div>
          </button>

          <div className="h-[1px] bg-white/[0.05] mx-[24px]" />

          {/* Open Existing Node */}
          <button
            onClick={handleOpenExisting}
            className="w-full flex items-center gap-[16px] px-[24px] py-[18px] hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors text-left"
          >
            <div className="w-[44px] h-[44px] rounded-full bg-[#1e1e1e] border border-white/[0.08] flex items-center justify-center shrink-0">
              <FolderOpen size={20} strokeWidth={1.8} className="text-cyan-400" />
            </div>
            <div className="flex flex-col gap-[2px]">
              <span className="text-white text-[15px] font-semibold font-headline">{t('main.open_existing')}</span>
              <span className="text-gray-400 text-[12px] font-body">{t('main.open_existing_sub')}</span>
            </div>
          </button>
        </div>
        </div>
      </div>}

      {/* Recent Nodes Modal / Bottom Sheet */}
      <AnimatePresence>
        {showRecentModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-end backdrop-blur-sm"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={e => { if (e.target === e.currentTarget) setShowRecentModal(false); }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: sheetDrag }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full bg-[#1c1c1e] border-t border-white/[0.08] rounded-t-3xl flex flex-col max-h-[85vh] shadow-[0_-20px_60px_rgba(0,0,0,0.6)]"
              onPointerDown={e => { isDraggingSheet.current = true; sheetDragStart.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={e => { if (!isDraggingSheet.current) return; setSheetDrag(Math.max(0, e.clientY - sheetDragStart.current)); }}
              onPointerUp={e => {
                if (!isDraggingSheet.current) return;
                isDraggingSheet.current = false;
                const d = Math.max(0, e.clientY - sheetDragStart.current);
                setSheetDrag(0);
                if (d >= 80) setShowRecentModal(false);
              }}
              onPointerCancel={() => { isDraggingSheet.current = false; setSheetDrag(0); }}
            >
              {/* Drag handle */}
              <div className="flex justify-center items-center py-[12px] shrink-0 select-none cursor-grab active:cursor-grabbing">
                <div className="w-[40px] h-[4px] bg-gray-500 rounded-full" />
              </div>

              {/* Stop pointer events from propagating to the drag sheet so
                  node selection buttons and Browse button fire correctly. */}
              <div
                className="px-[24px] pb-[40px] flex flex-col gap-[24px] overflow-y-auto"
                onPointerDown={e => e.stopPropagation()}
              >
                <div>
                  <p className="text-white text-[20px] font-bold font-headline mb-[4px]">Open Existing Node</p>
                  <p className="text-gray-400 text-[13px] font-body">Select a previously managed node or browse your filesystem.</p>
                </div>

                <div className="rounded-2xl border border-white/[0.05] overflow-hidden divide-y divide-white/[0.04]">
                  {recentNodes.map(node => {
                    const isCurrent = node.dir === nodeDir;
                    const isConfirming = confirmRemove === node.dir;
                    const shortDir = (() => {
                      const parts = node.dir.replace(/\\/g, '/').split('/').filter(Boolean);
                      return parts.length <= 2 ? node.dir : '…/' + parts.slice(-2).join('/');
                    })();
                    return (
                      <div key={node.dir}>
                        {isConfirming ? (
                          <div className="flex items-center justify-between px-[16px] py-[13px] bg-red-500/[0.07]">
                            <span className="text-red-300 text-[12px] font-medium">Remove from list?</span>
                            <div className="flex items-center gap-[6px]">
                              <button
                                onClick={() => setConfirmRemove(null)}
                                className="px-[10px] py-[4px] rounded-lg border border-white/[0.08] text-gray-400 text-[11px] hover:bg-white/[0.05] transition-all"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleRemoveNode(node.dir)}
                                className="px-[10px] py-[4px] rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-[11px] font-semibold hover:bg-red-500/30 transition-all"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => handleSwitchNode(node)}
                            className="flex items-center gap-[12px] px-[16px] py-[13px] hover:bg-white/[0.03] group transition-colors cursor-pointer"
                          >
                            {/* Status dot */}
                            <div className={`w-[6px] h-[6px] rounded-full shrink-0 self-start mt-[5px] ${isCurrent ? 'bg-[#DA9526] shadow-[0_0_6px_rgba(218,149,38,0.7)]' : 'bg-gray-700'}`} />

                            {/* Text */}
                            <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
                              <div className="flex items-center gap-[7px]">
                                <span className="text-[13px] font-semibold text-white leading-none">{node.alias || t('main.default_alias')}</span>
                                {isCurrent && (
                                  <span className="px-[5px] py-[1px] rounded bg-[#DA9526]/20 text-[#DA9526] text-[9px] font-bold uppercase tracking-wider shrink-0">Current</span>
                                )}
                              </div>
                              <span className="text-[11px] text-gray-600 font-mono">{shortDir}</span>
                            </div>

                            {/* Actions — revealed on hover, current always shown */}
                            <div className="flex items-center gap-[4px] shrink-0">
                              {!isCurrent && (
                                <button
                                  onClick={e => { e.stopPropagation(); setConfirmRemove(node.dir); }}
                                  className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-gray-700 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                                >
                                  <Trash2 size={12} strokeWidth={1.8} />
                                </button>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); handleSwitchNode(node); }}
                                className={`w-[28px] h-[28px] rounded-full flex items-center justify-center transition-all ${
                                  isCurrent
                                    ? 'text-[#DA9526] bg-[#DA9526]/10'
                                    : 'text-gray-700 group-hover:text-[#DA9526] group-hover:bg-[#DA9526]/10 opacity-0 group-hover:opacity-100'
                                }`}
                              >
                                <Power size={13} strokeWidth={1.8} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-[12px] pt-[8px]">
                  <div className="flex items-center gap-[12px]">
                    <div className="h-[1px] flex-1 bg-white/[0.06]" />
                    <span className="text-gray-500 text-[10px] font-label uppercase tracking-widest">or</span>
                    <div className="h-[1px] flex-1 bg-white/[0.06]" />
                  </div>
                  
                  <button
                    onClick={chooseNodeDir}
                    className="w-full flex items-center justify-center gap-[12px] h-[56px] rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white font-semibold hover:bg-white/[0.08] active:scale-[0.98] transition-all"
                  >
                    <FolderOpen size={20} className="text-cyan-400" />
                    {t('main.browse_folder')}
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

export default Main;

