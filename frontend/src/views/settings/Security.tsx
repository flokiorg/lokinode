import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n/context';
import { Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useInfo } from '@/hooks/useInfo';
import { fetcher, post, patch } from '@/lib/fetcher';
import { useTransitionStore } from '@/components/TransitionOverlay/TransitionOverlay';

// ── Password input row ────────────────────────────────────────────────────────

function PwdRow({
  label,
  value,
  onChange,
  placeholder,
  error,
  last,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  last?: boolean;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className={`flex flex-col gap-[6px] px-[16px] py-[12px] ${last ? '' : 'border-b border-white/[0.04]'}`}>
      <span className="text-gray-500 text-[10px] font-label uppercase tracking-[0.08em]">
        {label}
      </span>
      <div className="flex items-center gap-[8px]">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? '••••••••'}
          className="flex-1 bg-transparent text-white text-[13px] placeholder:text-gray-700 outline-none border-none focus:ring-0 caret-[#DA9526]"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="text-gray-600 hover:text-gray-400 transition-colors shrink-0"
          tabIndex={-1}
        >
          {show
            ? <EyeOff size={13} strokeWidth={1.8} />
            : <Eye    size={13} strokeWidth={1.8} />
          }
        </button>
      </div>
      {error && (
        <span className="text-red-400 text-[10px] font-mono">{error}</span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Security() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { data: info, mutate: mutateInfo } = useInfo();

  const [currentPwd,  setCurrentPwd]  = useState('');
  const [newPwd,      setNewPwd]      = useState('');
  const [confirmPwd,  setConfirmPwd]  = useState('');
  const [changing,    setChanging]    = useState(false);

  // Inline field-level errors
  const [errors, setErrors] = useState<{ current?: string; newpwd?: string; confirm?: string }>({});

  function validate(): boolean {
    const e: typeof errors = {};
    if (!currentPwd)                     e.current = t('validation.required');
    if (!newPwd)                         e.newpwd  = t('validation.required');
    else if (newPwd.length < 8)          e.newpwd  = t('validation.min8');
    if (newPwd && newPwd !== confirmPwd) e.confirm = t('validation.no_match');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const isActive = info?.state === 'ready';

  const navigate = useNavigate();
  const { startTransition, endTransition } = useTransitionStore();

  async function handleChangePassword() {
    if (!validate()) return;
    setChanging(true);
    
    startTransition(
      t('security.updating'), 
      t('security.update_sub') || 'Re-keying your wallet. This will take a moment.'
    );

    try {
      // The backend now handles the full "Stop -> Update -> Start -> Unlock" 
      // cycle automatically if the node is running. A single call is all 
      // that's needed for a pro experience.
      await patch('/api/wallet/password', { currentPassword: currentPwd, newPassword: newPwd });
      
      // Move to the dashboard immediately while the overlay is up
      navigate('/node');

      toast({ variant: 'default', title: t('security.updated') });
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setErrors({});

      // Give it a moment to actually trigger the state change in the backend
      await new Promise(r => setTimeout(r, 2000));
      await mutateInfo();
    } catch (err: any) {
      toast({ 
        variant: 'destructive', 
        title: t('security.failed'), 
        description: err.message || String(err) 
      });
    } finally {
      setChanging(false);
      // Keep overlay for a tiny bit extra to feel smooth
      setTimeout(endTransition, 500);
    }
  }

  return (
    <div className={`flex flex-col gap-[16px] ${changing ? 'cursor-wait' : ''}`}>

      {/* ── Change password card ───────────────────────────────────────────── */}
      <div className={`bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden transition-opacity duration-300 ${changing ? 'opacity-50 pointer-events-none' : ''}`}>

        {/* Section label row */}
        <div className="px-[16px] py-[11px] border-b border-white/[0.04]">
          <span className="text-gray-500 text-[10px] font-label uppercase tracking-[0.08em]">
            {t('security.section')}
          </span>
        </div>

        <PwdRow
          label={t('security.current_pwd')}
          value={currentPwd}
          onChange={v => { setCurrentPwd(v); setErrors(e => ({ ...e, current: undefined })); }}
          error={errors.current}
        />
        <PwdRow
          label={t('security.new_pwd')}
          value={newPwd}
          onChange={v => { setNewPwd(v); setErrors(e => ({ ...e, newpwd: undefined })); }}
          placeholder={t('security.new_pwd_ph')}
          error={errors.newpwd}
        />
        <PwdRow
          label={t('security.confirm_pwd')}
          value={confirmPwd}
          onChange={v => { setConfirmPwd(v); setErrors(e => ({ ...e, confirm: undefined })); }}
          error={errors.confirm}
          last
        />
      </div>

      {/* Primary action */}
      <button
        onClick={handleChangePassword}
        disabled={changing}
        className="w-full h-[46px] rounded-xl bg-[#DA9526] text-black font-semibold font-label text-[13px] hover:bg-[#c8871f] active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-[8px]"
      >
        {changing && <div className="w-[14px] h-[14px] rounded-full border-2 border-black border-t-transparent animate-spin" />}
        {changing ? t('security.updating') : t('security.update')}
      </button>

    </div>
  );
}
