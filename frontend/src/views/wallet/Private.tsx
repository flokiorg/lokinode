import { Field } from "@/components/ui/field";
import { useState } from "react";
import { useWalletCreateStore } from '@/store/walletCreate';
import { useToast } from '@/hooks/useToast';
import { useNavigate } from 'react-router-dom';
import { ConfirmButton } from '@/components/ConfirmButton/ConfirmButton';
import { useTranslation } from '@/i18n/context';

function Private() {
  const { t } = useTranslation();
  const [privateKey, setPrivateKey] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { initWallet, pwd, setConfirmLoading } = useWalletCreateStore();
  const { toast } = useToast();

  const onSubmit = async () => {
    if (!privateKey.trim()) {
      setError(t('wallet.errors.key_required'));
      return;
    }
    setError('');
    setConfirmLoading(true);
    const { status, error } = await initWallet(pwd, '', 'aezeed', privateKey.trim());
    if (status === 'success') {
      setTimeout(() => { setConfirmLoading(false); navigate('/node'); }, 1000);
    } else {
      setConfirmLoading(false);
      toast({ variant: 'destructive', title: t('wallet.import.error'), description: (error as Error)?.message ?? String(error) });
    }
  };

  return (
    <div className="flex flex-col items-center w-full px-[20px]">
      <div className="flex flex-col gap-[16px] w-full">
        <Field label={t('wallet.private.label')} errorText={error}>
          <textarea
            className="w-full bg-[#1c1c1e] border border-white/[0.06] rounded-md p-3 text-white text-[13px] placeholder:text-gray-400 focus:border-[#DA9526]/60 outline-none min-h-[96px] resize-none transition-colors font-mono"
            placeholder={t('wallet.private.ph')}
            value={privateKey}
            onChange={(e) => { setPrivateKey(e.target.value); setError(''); }}
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </Field>
      </div>

      <div className="w-full mt-[32px]">
        <ConfirmButton content={t('wallet.import.restore')} onClick={onSubmit} />
      </div>
    </div>
  );
}

export default Private;
