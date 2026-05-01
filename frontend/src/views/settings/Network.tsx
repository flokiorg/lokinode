import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n/context';
import { Check, Copy, RefreshCw, Loader } from 'lucide-react';
import { useInfo } from '@/hooks/useInfo';
import { useNodeConfigStore } from '@/store/nodeConfig';
import { useNodeSessionStore } from '@/store/nodeSession';
import { post } from '@/lib/fetcher';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/useToast';

// Accepts bare IPv4, IPv4:port, bare IPv6, or [IPv6]:port.
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/;
const IPV6_RE = /^(\[?[0-9a-fA-F:]+\]?)(:\d{1,5})?$/;

function isValidIP(ip: string): boolean {
  return IPV4_RE.test(ip) || IPV6_RE.test(ip);
}

function isValidCORS(cors: string): boolean {
  if (cors === '*') return true;
  if (!cors.trim()) return true;
  const parts = cors.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return true;

  for (const p of parts) {
    if (p === '*') continue;
    try {
      const url = new URL(p);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      // CORS origins should not have paths, queries, or fragments
      if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;
      // URL constructor validates port range automatically (throws if > 65535)
    } catch {
      return false;
    }
  }
  return true;
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      aria-pressed={value}
      className={`relative shrink-0 w-[42px] h-[24px] rounded-full transition-colors duration-200 focus:outline-none ${
        value ? 'bg-[#DA9526]' : 'bg-gray-600'
      }`}
    >
      <div
        className={`absolute top-[4px] w-[16px] h-[16px] rounded-full bg-white shadow-sm transition-all duration-200 ${
          value ? 'left-[22px]' : 'left-[4px]'
        }`}
      />
    </button>
  );
}

// ── Copy row ──────────────────────────────────────────────────────────────────

function CopyRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div
      className={`flex items-center justify-between px-[16px] py-[11px] ${
        last ? '' : 'border-b border-white/[0.04]'
      }`}
    >
      <div className="flex flex-col gap-[1px] flex-1 min-w-0 mr-[12px]">
        <span className="text-gray-400 text-[10px] font-label uppercase tracking-[0.08em]">
          {label}
        </span>
        <input type="text" readOnly value={value || '—'} className="bg-transparent border-none text-gray-300 text-[11px] font-mono focus:ring-0 outline-none w-full px-0 py-0 cursor-text" />
      </div>
      <button
        onClick={copy}
        disabled={!value}
        className="text-gray-400 hover:text-[#DA9526] transition-colors disabled:opacity-30 shrink-0 cursor-pointer"
        title={t('common.copy')}
      >
        {copied
          ? <Check size={13} strokeWidth={2.5} className="text-[#DA9526]" />
          : <Copy size={13} strokeWidth={2} />
        }
      </button>
    </div>
  );
}

// ── Credential row — hex / path pill toggle ───────────────────────────────────

function CredentialRow({
  label,
  hexValue,
  pathValue,
  loading,
}: {
  label: string;
  hexValue: string;
  pathValue: string;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [mode, setMode]   = useState<'hex' | 'path'>('hex');
  const [copied, setCopied] = useState(false);

  const display = mode === 'hex' ? hexValue : pathValue;

  function copy() {
    if (!display) return;
    navigator.clipboard.writeText(display).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl p-[14px] flex flex-col gap-[10px]">
      {/* Header row */}
      <div className="flex items-center justify-between gap-[8px]">
        <span className="text-gray-400 text-[10px] font-label uppercase tracking-[0.08em]">
          {label}
        </span>

        <div className="flex items-center gap-[8px]">
          {/* HEX / PATH pill */}
          <div className="flex items-center bg-[#121212] rounded-md border border-white/[0.06] overflow-hidden text-[9px] font-mono leading-none">
            <button
              onClick={() => setMode('hex')}
              className={`px-[7px] py-[4px] transition-colors ${
                mode === 'hex'
                  ? 'bg-[#DA9526]/15 text-[#DA9526]'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              HEX
            </button>
            <div className="w-px h-[10px] bg-white/[0.06]" />
            <button
              onClick={() => setMode('path')}
              className={`px-[7px] py-[4px] transition-colors ${
                mode === 'path'
                  ? 'bg-[#DA9526]/15 text-[#DA9526]'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              PATH
            </button>
          </div>

          <button
            onClick={copy}
            disabled={!display}
            className="text-gray-400 hover:text-[#DA9526] transition-colors disabled:opacity-30"
            title={t('common.copy')}
          >
            {copied
              ? <Check size={13} strokeWidth={2.5} className="text-[#DA9526]" />
              : <Copy size={13} strokeWidth={2} />
            }
          </button>
        </div>
      </div>

      {/* Value */}
      <div
        className="text-[10px] font-mono text-gray-400 break-all leading-[1.65] max-h-[64px] overflow-y-auto"
      >
        {loading
          ? <Skeleton className="h-[10px] w-full" />
          : display || <span className="text-gray-600">—</span>
        }
      </div>
    </div>
  );
}

// ── Editable row — same row framing as CopyRow, but with an input body ───────

function EditableRow({
  label,
  sub,
  value,
  placeholder,
  onChange,
  onBlur,
  error,
  warning,
  last,
  onAction,
  actionIcon: ActionIcon,
  actionLoading,
  actionDisabled,
  actionSuccess,
}: {
  label: string;
  sub?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  warning?: string;
  last?: boolean;
  onAction?: () => void;
  actionIcon?: any;
  actionLoading?: boolean;
  actionDisabled?: boolean;
  actionSuccess?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`px-[16px] py-[12px] ${last ? '' : 'border-b border-white/[0.04]'}`}>
      <div className="flex flex-col gap-[2px] mb-[8px]">
        <span className="text-gray-400 text-[10px] font-label uppercase tracking-[0.08em]">{label}</span>
        {sub && <span className="text-gray-500 text-[10px] leading-[1.5]">{sub}</span>}
      </div>
      <div className="relative">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={e => e.key === 'Enter' && onAction && !actionDisabled && onAction()}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={`w-full bg-[#121212] rounded-lg border px-[12px] py-[9px] text-[12px] font-mono text-gray-200 placeholder:text-gray-500 outline-none caret-[#DA9526] transition-colors cursor-pointer focus:cursor-text ${onAction ? 'pr-[40px]' : ''} ${
            error
              ? 'border-red-500/60 focus:border-red-500'
              : warning
                ? 'border-amber-500/40 focus:border-amber-500/60'
                : 'border-white/[0.04] hover:border-white/[0.1] focus:border-[#DA9526]/40'
          }`}
        />
        {onAction && (!actionDisabled || actionLoading || actionSuccess) && (
          <button
            onClick={onAction}
            disabled={actionLoading || actionSuccess}
            className={`absolute right-[6px] top-1/2 -translate-y-1/2 w-[28px] h-[28px] rounded-lg transition-all flex items-center justify-center text-black shadow-[0_4px_12px_rgba(218,149,38,0.3)] active:scale-[0.9] cursor-pointer disabled:cursor-default ${
              actionSuccess ? 'bg-emerald-500 shadow-[0_4px_12px_rgba(16,185,129,0.3)]' : 'bg-[#DA9526] hover:bg-[#c8871f]'
            }`}
            title={t('common.apply')}
          >
            {actionLoading ? (
              <Loader size={14} className="animate-spin" />
            ) : actionSuccess ? (
              <Check size={16} strokeWidth={4} />
            ) : ActionIcon ? (
              <ActionIcon size={16} strokeWidth={3} />
            ) : (
              <span className="text-[10px] font-bold uppercase">{t('common.apply')}</span>
            )}
          </button>
        )}
      </div>
      {error && <span className="block text-red-400 text-[11px] mt-[6px]">{error}</span>}
      {!error && warning && <span className="block text-amber-400 text-[11px] mt-[6px]">{warning}</span>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Network() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: info } = useInfo();
  const {
    nodePublic, setNodePublic,
    nodeIP, setNodeIP,
    restCors, setRestCors,
    aliasName, setAliasName,
    nodeDir, rpcListen, restListen,
    pubKey, saveToDB,
  } = useNodeConfigStore();
  const { setAutoUnlockPending, setIsRestarting } = useNodeSessionStore();

  const [localAlias, setLocalAlias] = useState(aliasName);
  const [aliasLoading, setAliasLoading] = useState(false);
  const [aliasSuccess, setAliasSuccess] = useState(false);
  const [aliasError, setAliasError] = useState<string | undefined>(undefined);
  const isAliasDirty = localAlias !== aliasName;

  async function handleSaveAlias() {
    const trimmed = localAlias.trim();
    if ((trimmed === aliasName && !isAliasDirty) || aliasLoading || aliasSuccess) return;
    
    setAliasLoading(true);
    setAliasError(undefined);
    setAliasSuccess(false);
    
    // Simulate network delay
    await new Promise(r => setTimeout(r, 800));
    
    // Demonstration of inline error
    if (trimmed.toLowerCase().includes('error')) {
      setAliasError(t('main.errors.alias_invalid') || 'Invalid node alias');
      setAliasLoading(false);
      return;
    }
    
    setAliasName(trimmed);
    await saveToDB();
    setAliasLoading(false);
    setAliasSuccess(true);
    
    // Reset success state after 2 seconds
    setTimeout(() => setAliasSuccess(false), 2000);
  }

  useEffect(() => {
    setLocalAlias(aliasName);
  }, [aliasName]);

  // Sync settings to DB when they change
  useEffect(() => {
    if (pubKey) {
      saveToDB();
    }
  }, [nodePublic, nodeIP, restCors, pubKey, saveToDB]);

  const ipError = nodePublic && nodeIP !== '' && !isValidIP(nodeIP);
  const ipMissing = nodePublic && nodeIP === '';
  const corsError = !isValidCORS(restCors);

  // Credentials come from /api/info — hex values are populated once the wallet
  // is unlocked, paths are always present once the node is configured.
  const credsLoading = info === undefined;

  const isNodeActive = info?.state === 'ready' || info?.state === 'syncing' || info?.state === 'scanning' || info?.state === 'block' || info?.state === 'tx' || info?.state === 'locked';
  const isDirty = !!info?.nodeRunning && isNodeActive && (
    info.nodePublic !== nodePublic ||
    (nodePublic && info.externalIP !== nodeIP) ||
    info.restCors !== restCors ||
    info.nodeAlias !== aliasName
  );

  const [restartArmed, setRestartArmed] = useState(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useNavigate();

  function handleRestart() {
    // Ensure latest local alias is synced to the store before we save/restart.
    if (isAliasDirty) setAliasName(localAlias.trim());

    // Persist latest settings, then immediately flip to the loader page.
    // We don't await the restart API — Node.tsx owns the isRestarting
    // lifecycle and will clear the flag once the daemon is confirmed running.
    saveToDB().then(() => {
      setAutoUnlockPending(true);
      setIsRestarting(true);

      // Navigate immediately — user sees the loader/spinner page right away.
      navigate('/node');

      // The server's RestartNode() is blocking — the 204 arrives only after the
      // daemon has fully stopped and restarted. Clear isRestarting on both
      // success and failure so Node.tsx never gets stuck in the spinner state.
      post('/api/node/restart', {})
        .then(() => setIsRestarting(false))
        .catch(() => setIsRestarting(false));
    });
  }


  return (
    <div className="flex flex-col gap-[12px]">

      {/* ── Dirty state warning ───────────────────────────────────────────── */}
      {isDirty && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl px-[16px] py-[14px] flex flex-col gap-[10px]"
             style={{ animation: 'fadeSlideIn 200ms ease-out' }}>
          <div className="flex items-center gap-[10px]">
            <div className="w-[20px] h-[20px] rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
              <RefreshCw size={11} className="text-amber-500" />
            </div>
            <p className="text-amber-200 text-[12px] font-medium leading-normal">
              {t('network.restart_required')}
            </p>
          </div>
          <button
            onClick={() => {
              // Validation
              const issues: string[] = [];
              if (ipError) issues.push(t('network.ip_error') || 'Invalid IP format');
              if (ipMissing) issues.push(t('network.ip_missing') || 'External IP is required for public nodes');
              if (corsError) issues.push(t('validation.invalid_cors') || 'Invalid CORS format');
              if (isAliasDirty && localAlias.trim().length === 0) issues.push(t('validation.required') || 'Alias is required');

              if (issues.length > 0) {
                toast({
                  variant: 'destructive',
                  title: t('network.errors.invalid_config') || 'Configuration Issue',
                  description: issues.join('. ')
                });
                return;
              }

              if (restartArmed) {
                handleRestart();
              } else {
                setRestartArmed(true);
                if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
                restartTimerRef.current = setTimeout(() => setRestartArmed(false), 3000);
              }
            }}
            className={`w-full h-[40px] font-semibold font-label text-[12px] rounded-lg flex items-center justify-center gap-[8px] transition-all duration-200 ${
              restartArmed
                ? 'bg-amber-500 text-black animate-pulse scale-[1.01]'
                : 'bg-amber-500 text-black hover:bg-amber-400 active:scale-[0.98]'
            }`}
          >
            {restartArmed ? (
              <span>{t('network.restart.confirm_action') || 'Click again to confirm restart'}</span>
            ) : (
              <>
                <RefreshCw size={14} />
                <span>{t('network.restart_btn')}</span>
              </>
            )}
          </button>
        </div>
      )}

      <GroupHeader label={t('network.group.identity')} />
      <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        <EditableRow
          label={t('config.alias')}
          sub={localAlias === '' ? t('config.alias_default_hint') : undefined}
          value={localAlias}
          placeholder={t('main.default_alias')}
          onChange={v => { setLocalAlias(v); setAliasError(undefined); }}
          onAction={handleSaveAlias}
          actionIcon={Check}
          actionLoading={aliasLoading}
          actionSuccess={aliasSuccess}
          actionDisabled={!isAliasDirty || aliasLoading}
          error={aliasError}
        />
        <CopyRow label={t('network.pubkey')}   value={info?.nodePubkey ?? ''} />
        <CopyRow label={t('network.data_dir')} value={info?.nodeDir    ?? ''} last />
      </div>

      {/* ── Group 2: Public visibility ──────────────────────────────────── */}
      <GroupHeader label={t('network.group.visibility')} />
      <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className={`flex items-center justify-between gap-[16px] px-[16px] py-[14px] ${nodePublic ? 'border-b border-white/[0.04]' : ''}`}>
          <div className="flex-1 min-w-0">
            <p className="text-white text-[13px] font-label">{t('network.public_node')}</p>
            <p className="text-gray-400 text-[11px] mt-[2px] leading-[1.5]">
              {t('network.public_node_sub')}
            </p>
          </div>
          <Toggle value={nodePublic} onChange={setNodePublic} />
        </div>
        {nodePublic && (
          <EditableRow
            label={t('network.public_ip')}
            sub={t('network.public_ip_sub')}
            placeholder={t('network.public_ip_ph')}
            value={nodeIP}
            onChange={setNodeIP}
            onBlur={() => {
              const trimmed = nodeIP.trim();
              if (trimmed && !trimmed.includes(':')) {
                if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) setNodeIP(trimmed + ':5521');
                else if (/^\[[0-9a-fA-F:]+\]$/.test(trimmed)) setNodeIP(trimmed + ':5521');
              }
            }}
            error={ipError ? t('network.ip_error') : undefined}
            warning={ipMissing ? t('network.ip_missing') : undefined}
            last
          />
        )}
      </div>

      {/* ── Group 3: Endpoints & CORS ───────────────────────────────────── */}
      <GroupHeader label={t('network.group.endpoints')} />
      <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        <EditableRow
          label={t('network.cors')}
          sub={t('network.cors_sub')}
          placeholder={t('network.cors_ph')}
          value={restCors}
          onChange={setRestCors}
          error={corsError ? t('validation.invalid_cors') : undefined}
        />
        <CopyRow label={t('network.grpc')} value={info?.rpcAddress   ?? ''} />
        <CopyRow label={t('network.rest')} value={info?.restEndpoint ?? ''} last />
      </div>

      <p className="text-gray-500 text-[10px] font-mono text-center -mt-[4px]">
        {t('network.restart_hint')}
      </p>

      {/* ── Group 4: Credentials ────────────────────────────────────────── */}
      <GroupHeader label={t('network.group.credentials')} />
      <CredentialRow
        label={t('network.macaroon')}
        hexValue={info?.macaroonHex   ?? ''}
        pathValue={info?.macaroonPath ?? ''}
        loading={credsLoading}
      />
      <CredentialRow
        label={t('network.tls')}
        hexValue={info?.tlsCertHex   ?? ''}
        pathValue={info?.tlsCertPath ?? ''}
        loading={credsLoading}
      />

    </div>
  );
}

function GroupHeader({ label }: { label: string }) {
  return (
    <span className="text-gray-400 text-[10px] font-label uppercase tracking-[0.08em] px-[4px] -mb-[4px] mt-[4px]">
      {label}
    </span>
  );
}
