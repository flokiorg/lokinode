import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { MnemonicAlert } from '@/views/wallet/MnemonicAlert';
import { ConfirmButton } from '@/components/ConfirmButton/ConfirmButton';
import { useTranslation } from '@/i18n/context';
import { useWalletCreateStore } from '@/store/walletCreate';
import { useToast } from '@/hooks/useToast';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

function New() {
  const { t } = useTranslation();
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [phase, setPhase] = useState<'phrase' | 'words'>('phrase');
  const { createPassphrase, setCreatePassphrase, genSeed, initWallet, pwd, createMnemonic, showCreateMnemonic, setShowMnemonicDialog, confirmLoading, setConfirmLoading } = useWalletCreateStore();
  const navigate = useNavigate();
  const { toast } = useToast();

  const onGenerate = async () => {
    if (confirmPassphrase !== createPassphrase) {
      toast({ variant: 'destructive', title: t('security.failed'), description: t('validation.no_match') });
      return;
    }
    const { status, error } = await genSeed(createPassphrase);
    if (status === 'success') {
      setPhase('words');
    } else {
      toast({ variant: 'destructive', title: t('security.failed'), description: String(error) });
    }
  };

  const onConfirm = async () => {
    setConfirmLoading(true);
    // Pass createPassphrase as-is. Empty string means no aezeed passphrase —
    // must match exactly what was used in genSeed; never substitute 'aezeed'.
    const { status, error } = await initWallet(pwd, createMnemonic, createPassphrase, '');
    if (status === 'success') {
      setTimeout(() => {
        setShowMnemonicDialog(false);
        setConfirmLoading(false);
        navigate('/node');
      }, 1000);
    } else {
      setConfirmLoading(false);
      toast({ variant: 'destructive', title: t('security.failed'), description: (error as Error)?.message ?? String(error) });
    }
  };

  const inputClass = "bg-[#1c1c1e] border-white/[0.06] text-white placeholder:text-gray-400 focus:border-[#DA9526]/60 focus:ring-0";

  return (
    <div className="flex flex-col items-center w-full px-[20px]">

      {phase === 'phrase' && (
        <>
          <p className="text-white text-[18px] font-semibold font-headline text-center mb-[24px]">
            {t('wallet.new.title')} <span className="text-gray-400 font-normal text-[14px]">{t('wallet.new.optional')}</span>
          </p>

          <div className={`flex flex-col gap-[16px] w-full transition-opacity ${confirmLoading ? 'opacity-50 pointer-events-none' : ''}`}>
            <Field label={t('wallet.new.seed_pwd')}>
              <div className="relative">
                <Input
                  type={showPassphrase ? 'text' : 'password'}
                  placeholder={t('wallet.new.seed_pwd_ph')}
                  value={createPassphrase}
                  onChange={(e) => setCreatePassphrase(e.target.value)}
                  className={`${inputClass} pr-[44px]`}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassphrase(v => !v)}
                  className="absolute right-[12px] top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors focus:outline-none"
                >
                  {showPassphrase ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                </button>
              </div>
            </Field>
            <Field label={t('wallet.new.confirm_pwd')}>
              <div className="relative">
                <Input
                  type={showPassphrase ? 'text' : 'password'}
                  placeholder={t('wallet.new.confirm_pwd_ph')}
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  className={`${inputClass} pr-[44px]`}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassphrase(v => !v)}
                  className="absolute right-[12px] top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors focus:outline-none"
                >
                  {showPassphrase ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                </button>
              </div>
            </Field>
          </div>

          <div className="w-full mt-[32px]">
            <ConfirmButton content={t('wallet.new.generate')} onClick={onGenerate} loading={confirmLoading} />
          </div>
        </>
      )}

      {phase === 'words' && (
        <>
          <p className="text-white text-[18px] font-semibold font-headline text-center mb-[16px]">
            {t('wallet.new.recovery_title')}
          </p>
          <p className="text-gray-400 text-[12px] text-center mb-[16px] px-[8px]">
            {t('wallet.new.recovery_desc')}
          </p>

          <div className="grid grid-cols-3 gap-x-[12px] gap-y-[8px] w-full bg-[#1c1c1e] border border-white/[0.06] rounded-xl p-[16px]">
            {showCreateMnemonic.map((word: string, i: number) => (
              <div key={i} className="flex items-center gap-[6px]">
                <span className="text-gray-400 text-[10px] w-[16px] text-right shrink-0">{i + 1}.</span>
                <span className="text-white text-[13px] font-medium truncate">{word}</span>
              </div>
            ))}
          </div>

          <div className="w-full mt-[24px]">
            <ConfirmButton content={t('wallet.new.saved_btn')} onClick={() => setShowMnemonicDialog(true)} />
          </div>
        </>
      )}

      <MnemonicAlert onSubmit={onConfirm} />
    </div>
  );
}

export default New;
