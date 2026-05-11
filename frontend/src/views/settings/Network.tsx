import * as React from 'react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n/context';
import { Check, Copy, RefreshCw, Loader } from 'lucide-react';
import { useNodeConfigStore, DEFAULT_REST_CORS, DEFAULT_RPC_LISTEN, DEFAULT_REST_LISTEN } from '@/store/nodeConfig';
import { useNodeSessionStore } from '@/store/nodeSession';
import { fetcher, post } from '@/lib/fetcher';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/useToast';
import type { InfoResponse } from '@/lib/types';

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
      if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;
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
    <div className={`flex items-center justify-between px-[16px] py-[11px] ${last ? '' : 'border-b border-white/[0.04]'}`}>
      <div className="flex flex-col gap-[1px] flex-1 min-w-0 mr-[12px]">
        <span className="text-gray-400 text-[10px] font-label uppercase tracking-[0.08em]">{label}</span>
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
  label, hexValue, pathValue, loading,
}: {
  label: string; hexValue: string; pathValue: string; loading: boolean;
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
      <div className="flex items-center justify-between gap-[8px]">
        <span className="text-gray-400 text-[10px] font-label uppercase tracking-[0.08em]">{label}</span>
        <div className="flex items-center gap-[8px]">
          <div className="flex items-center bg-[#121212] rounded-md border border-white/[0.06] overflow-hidden text-[9px] font-mono leading-none">
            <button onClick={() => setMode('hex')} className={`px-[7px] py-[4px] transition-colors ${mode === 'hex' ? 'bg-[#DA9526]/15 text-[#DA9526]' : 'text-gray-600 hover:text-gray-400'}`}>HEX</button>
            <div className="w-px h-[10px] bg-white/[0.06]" />
            <button onClick={() => setMode('path')} className={`px-[7px] py-[4px] transition-colors ${mode === 'path' ? 'bg-[#DA9526]/15 text-[#DA9526]' : 'text-gray-600 hover:text-gray-400'}`}>PATH</button>
          </div>
          <button onClick={copy} disabled={!display} className="text-gray-400 hover:text-[#DA9526] transition-colors disabled:opacity-30" title={t('common.copy')}>
            {copied ? <Check size={13} strokeWidth={2.5} className="text-[#DA9526]" /> : <Copy size={13} strokeWidth={2} />}
          </button>
        </div>
      </div>
      <div className="text-[10px] font-mono text-gray-400 break-all leading-[1.65] max-h-[64px] overflow-y-auto">
        {loading ? <Skeleton className="h-[10px] w-full" /> : display || <span className="text-gray-600">—</span>}
      </div>
    </div>
  );
}

// ── Editable row ──────────────────────────────────────────────────────────────

function EditableRow({
  label, sub, value, placeholder, onChange, onBlur, error, warning, last,
}: {
  label: string; sub?: string; value: string; placeholder?: string;
  onChange: (v: string) => void; onBlur?: () => void;
  error?: string; warning?: string; last?: boolean;
}) {
  return (
    <div className={`px-[16px] py-[12px] ${last ? '' : 'border-b border-white/[0.04]'}`}>
      <div className="flex flex-col gap-[2px] mb-[8px]">
        <span className="text-gray-400 text-[10px] font-label uppercase tracking-[0.08em]">{label}</span>
        {sub && <span className="text-gray-500 text-[10px] leading-[1.5]">{sub}</span>}
      </div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className={`w-full bg-[#121212] rounded-lg border px-[12px] py-[9px] text-[12px] font-mono text-gray-200 placeholder:text-gray-500 outline-none caret-[#DA9526] transition-colors cursor-pointer focus:cursor-text ${
          error
            ? 'border-red-500/60 focus:border-red-500'
            : warning
              ? 'border-amber-500/40 focus:border-amber-500/60'
              : 'border-white/[0.04] hover:border-white/[0.1] focus:border-[#DA9526]/40'
        }`}
      />
      {error   && <span className="block text-red-400   text-[11px] mt-[6px]">{error}</span>}
      {!error && warning && <span className="block text-amber-400 text-[11px] mt-[6px]">{warning}</span>}
    </div>
  );
}

// ── Form state ────────────────────────────────────────────────────────────────

interface NetworkForm {
  alias:      string
  nodePublic: boolean
  nodeIP:     string
  restCors:   string
  rpcListen:  string   // preserved from DB, not shown in UI
  restListen: string   // preserved from DB, not shown in UI
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Network({ info }: { info: InfoResponse | undefined }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { nodeDir, pubKey, setAliasName } = useNodeConfigStore();
  const { setAutoUnlockPending, setIsRestarting } = useNodeSessionStore();
  const navigate = useNavigate();

  const [form, setForm] = useState<NetworkForm | null>(null);
  // Tracks what's currently saved in DB so we can detect unsaved changes.
  const savedFormRef = useRef<NetworkForm | null>(null);

  // Load form from DB once on mount (or when nodeDir changes).
  useEffect(() => {
    if (!nodeDir) return;
    setForm(null);
    fetcher<{
      alias: string; nodePublic: boolean; nodeIP: string;
      restCors: string; rpcListen: string; restListen: string;
    }>(`/api/node/config?dir=${encodeURIComponent(nodeDir)}`)
      .then(cfg => {
        const loaded: NetworkForm = {
          alias:      cfg.alias      || '',
          nodePublic: cfg.nodePublic ?? true,
          nodeIP:     cfg.nodeIP     || '',
          restCors:   cfg.restCors   || DEFAULT_REST_CORS,
          rpcListen:  cfg.rpcListen  || DEFAULT_RPC_LISTEN,
          restListen: cfg.restListen || DEFAULT_REST_LISTEN,
        };
        savedFormRef.current = loaded;
        setForm(loaded);
      })
      .catch(() => {});
  }, [nodeDir]);

  function update<K extends keyof NetworkForm>(key: K, value: NetworkForm[K]) {
    setForm(f => f ? { ...f, [key]: value } : f);
  }

  // Auto-save to DB (debounced) when node is NOT running and form differs from DB.
  // When node IS running, changes are only persisted via Apply & Restart.
  useEffect(() => {
    if (!form || !nodeDir || info?.nodeRunning) return;
    if (JSON.stringify(form) === JSON.stringify(savedFormRef.current)) return;
    const timer = setTimeout(() => {
      post('/api/node/config', {
        pubKey, dir: nodeDir,
        alias:      form.alias,
        nodePublic: form.nodePublic,
        externalIP: form.nodeIP,
        restCors:   form.restCors,
        rpcListen:  form.rpcListen,
        restListen: form.restListen,
      }).then(() => { savedFormRef.current = form; }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [form, info?.nodeRunning, nodeDir, pubKey]);

  // isDirty: form vs running daemon — requires node to be active.
  const isDirty = useMemo(() => {
    if (!form || !info?.nodeRunning) return false;
    const state = info.state ?? '';
    const isActive = ['ready', 'syncing', 'scanning', 'block', 'tx', 'locked'].includes(state);
    if (!isActive) return false;
    return (
      info.nodePublic !== form.nodePublic ||
      (form.nodePublic && info.externalIP !== form.nodeIP) ||
      info.restCors !== form.restCors ||
      info.nodeAlias !== form.alias
    );
  }, [form, info]);

  const ipError   = !!form?.nodePublic && form.nodeIP !== '' && !isValidIP(form.nodeIP);
  const ipMissing = !!form?.nodePublic && form.nodeIP === '';
  const corsError = !!form && !isValidCORS(form.restCors);

  const [restartArmed, setRestartArmed] = useState(false);
  const [restarting,   setRestarting]   = useState(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleApplyAndRestart() {
    if (!form || restarting) return;

    const issues: string[] = [];
    if (ipError)   issues.push(t('network.ip_error') || 'Invalid IP format');
    if (ipMissing) issues.push(t('network.ip_missing') || 'External IP required for public nodes');
    if (corsError) issues.push(t('validation.invalid_cors') || 'Invalid CORS format');
    if (issues.length > 0) {
      toast({ variant: 'destructive', title: t('network.errors.invalid_config') || 'Configuration Issue', description: issues.join('. ') });
      return;
    }

    if (!restartArmed) {
      setRestartArmed(true);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => setRestartArmed(false), 3000);
      return;
    }

    setRestarting(true);
    try {
      await post('/api/node/config', {
        pubKey, dir: nodeDir,
        alias:      form.alias,
        nodePublic: form.nodePublic,
        externalIP: form.nodeIP,
        restCors:   form.restCors,
        rpcListen:  form.rpcListen,
        restListen: form.restListen,
      });
      savedFormRef.current = form;
      setAliasName(form.alias);

      setAutoUnlockPending(true);
      setIsRestarting(true);
      navigate('/node');

      // Fire-and-forget: Node.tsx watches the actual daemon state transition
      // and clears isRestarting when the cycle is done. Only clear on hard
      // failure so the spinner isn't stuck if the API call itself errors out.
      post('/api/node/restart', {}).catch(() => {
        setIsRestarting(false);
        setRestarting(false);
      });
    } catch (err) {
      setRestarting(false);
      setRestartArmed(false);
      toast({ variant: 'destructive', title: String(err) });
    }
  }

  const credsLoading = info === undefined;
  const loading = form === null;

  return (
    <div className="flex flex-col gap-[12px]">

      {/* ── Dirty state warning ─────────────────────────────────────────────── */}
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
            onClick={handleApplyAndRestart}
            disabled={restarting}
            className={`w-full h-[40px] font-semibold font-label text-[12px] rounded-lg flex items-center justify-center gap-[8px] transition-all duration-200 ${
              restartArmed
                ? 'bg-amber-500 text-black animate-pulse scale-[1.01]'
                : 'bg-amber-500 text-black hover:bg-amber-400 active:scale-[0.98]'
            }`}
          >
            {restarting ? (
              <Loader size={14} className="animate-spin" />
            ) : restartArmed ? (
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

      {/* ── Group 1: Identity ──────────────────────────────────────────────── */}
      <GroupHeader label={t('network.group.identity')} />
      <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="px-[16px] py-[12px]"><Skeleton className="h-[38px] w-full" /></div>
        ) : (
          <EditableRow
            label={t('config.alias')}
            sub={form.alias === '' ? t('config.alias_default_hint') : undefined}
            value={form.alias}
            placeholder={t('main.default_alias')}
            onChange={v => update('alias', v)}
          />
        )}
        <CopyRow label={t('network.pubkey')}   value={info?.nodePubkey ?? ''} />
        <CopyRow label={t('network.data_dir')} value={info?.nodeDir    ?? ''} last />
      </div>

      {/* ── Group 2: Public visibility ──────────────────────────────────────── */}
      <GroupHeader label={t('network.group.visibility')} />
      <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="px-[16px] py-[14px]"><Skeleton className="h-[24px] w-full" /></div>
        ) : (
          <>
            <div className={`flex items-center justify-between gap-[16px] px-[16px] py-[14px] ${form.nodePublic ? 'border-b border-white/[0.04]' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-white text-[13px] font-label">{t('network.public_node')}</p>
                <p className="text-gray-400 text-[11px] mt-[2px] leading-[1.5]">{t('network.public_node_sub')}</p>
              </div>
              <Toggle value={form.nodePublic} onChange={v => update('nodePublic', v)} />
            </div>
            {form.nodePublic && (
              <EditableRow
                label={t('network.public_ip')}
                sub={t('network.public_ip_sub')}
                placeholder={t('network.public_ip_ph')}
                value={form.nodeIP}
                onChange={v => update('nodeIP', v)}
                onBlur={() => {
                  if (!form) return;
                  const trimmed = form.nodeIP.trim();
                  if (trimmed && !trimmed.includes(':')) {
                    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) update('nodeIP', trimmed + ':5521');
                    else if (/^\[[0-9a-fA-F:]+\]$/.test(trimmed)) update('nodeIP', trimmed + ':5521');
                  }
                }}
                error={ipError ? t('network.ip_error') : undefined}
                warning={ipMissing ? t('network.ip_missing') : undefined}
                last
              />
            )}
          </>
        )}
      </div>

      {/* ── Group 3: Endpoints & CORS ───────────────────────────────────────── */}
      <GroupHeader label={t('network.group.endpoints')} />
      <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="px-[16px] py-[12px]"><Skeleton className="h-[38px] w-full" /></div>
        ) : (
          <EditableRow
            label={t('network.cors')}
            sub={t('network.cors_sub')}
            placeholder={t('network.cors_ph')}
            value={form.restCors}
            onChange={v => update('restCors', v)}
            error={corsError ? t('validation.invalid_cors') : undefined}
          />
        )}
        <CopyRow label={t('network.grpc')} value={info?.rpcAddress   ?? ''} />
        <CopyRow label={t('network.rest')} value={info?.restEndpoint ?? ''} last />
      </div>

      <p className="text-gray-500 text-[10px] font-mono text-center -mt-[4px]">
        {t('network.restart_hint')}
      </p>

      {/* ── Group 4: Credentials ────────────────────────────────────────────── */}
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
