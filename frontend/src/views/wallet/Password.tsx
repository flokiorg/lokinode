import { useToast } from '@/hooks/useToast';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useWalletCreateStore } from '@/store/walletCreate';
import { Field } from '@/components/ui/field';
import { ConfirmButton } from '@/components/ConfirmButton/ConfirmButton';
import { useTranslation } from '@/i18n/context';

function Password() {
  const { t } = useTranslation();
  const { pwd, setPwd, setStatus } = useWalletCreateStore();
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState('');
  const { toast } = useToast();

  const onSubmit = () => {
    if (pwd.length < 8) {
      setError(t('validation.min8'));
      return;
    }
    if (pwd !== confirmPwd) {
      setError(t('validation.no_match'));
      return;
    }
    setStatus('create');
  };

  return (
    <div className="flex flex-col items-center w-full px-[20px]">
      <p className="text-white text-[20px] font-semibold font-headline text-center mb-[32px]">
        {t('wallet.pwd.title')}
      </p>

      <div className="flex flex-col gap-[16px] w-full">
        <Field label={t('wallet.pwd.label')} errorText={error && pwd.length < 8 ? error : undefined}>
          <Input
            type="password"
            placeholder={t('security.new_pwd_ph')}
            value={pwd}
            onChange={(e) => { setPwd(e.target.value); setError(''); }}
            className="bg-[#1c1c1e] border-white/[0.06] text-white placeholder:text-gray-600 focus:border-[#DA9526]/60 focus:ring-0"
          />
        </Field>

        <Field label={t('wallet.pwd.confirm')} errorText={error && pwd.length >= 8 ? error : undefined}>
          <Input
            type="password"
            placeholder={t('wallet.pwd.repeat_ph')}
            value={confirmPwd}
            onChange={(e) => { setConfirmPwd(e.target.value); setError(''); }}
            className="bg-[#1c1c1e] border-white/[0.06] text-white placeholder:text-gray-600 focus:border-[#DA9526]/60 focus:ring-0"
          />
        </Field>
      </div>

      <div className="w-full mt-[32px]">
        <ConfirmButton content={t('common.continue')} onClick={onSubmit} />
      </div>
    </div>
  );
}

export default Password;
