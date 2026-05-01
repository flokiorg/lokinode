import { Field } from "@/components/ui/field";
import { useState } from "react";
import { useWalletCreateStore } from '@/store/walletCreate';
import { useToast } from '@/hooks/useToast';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { ConfirmButton } from '@/components/ConfirmButton/ConfirmButton';
import { useTranslation } from '@/i18n/context';

function Import() {
  const { t } = useTranslation();
  const [mnemonic, setMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { initWallet, pwd, confirmLoading, setConfirmLoading } = useWalletCreateStore();
  const { toast } = useToast();

  const onSubmit = async () => {
    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 24) {
      setError(t('wallet.import.error_24words'));
      return;
    }
    setError('');
    setConfirmLoading(true);
    // Pass passphrase as-is. Empty string = no aezeed passphrase; never
    // substitute 'aezeed' — it must match what the wallet was originally created with.
    const { status, error } = await initWallet(pwd, mnemonic.trim(), passphrase, '');
    if (status === 'success') {
      setTimeout(() => { setConfirmLoading(false); navigate('/node'); }, 1000);
    } else {
      setConfirmLoading(false);
      toast({ variant: 'destructive', title: t('security.failed'), description: (error as Error)?.message ?? String(error) });
    }
  };

  const inputClass = "bg-[#1c1c1e] border-white/[0.06] text-white placeholder:text-gray-600 focus:border-[#DA9526]/60 focus:ring-0";

  return (
    <div className="flex flex-col items-center w-full px-[20px]">
      <div className="flex flex-col gap-[16px] w-full">
        <Field label={t('wallet.import.recovery')} errorText={error}>
          <textarea
            className="w-full bg-[#1c1c1e] border border-white/[0.06] rounded-md p-3 text-white text-[13px] placeholder:text-gray-600 focus:border-[#DA9526]/60 outline-none min-h-[96px] resize-none transition-colors"
            placeholder={t('wallet.import.recovery_ph')}
            value={mnemonic}
            onChange={(e) => { setMnemonic(e.target.value); setError(''); }}
          />
        </Field>

        <Field label={t('wallet.import.seed_pwd')}>
          <Input
            type="password"
            placeholder={t('wallet.import.seed_pwd_ph')}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="w-full mt-[32px]">
        <ConfirmButton content={t('wallet.import.restore')} onClick={onSubmit} loading={confirmLoading} />
      </div>
    </div>
  );
}

export default Import;
