import { useEffect, useRef } from 'react';
import { useTransactions } from './useTransactions';
import { useToast } from '@/hooks/useToast';
import { useTranslation } from '@/i18n/context';

/** Watches transactions and toasts when a new incoming payment is detected. */
export function useNotifyIncoming(active = false) {
  const { data } = useTransactions(10, 0, active);
  const { toast } = useToast();
  const { t } = useTranslation();
  const prevHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data?.transactions?.length) return;
    const latest = data.transactions[0];
    if (!latest) return;

    // Only notify for confirmed incoming transactions (amount > 0)
    if (latest.amount <= 0) return;
    if (latest.confirmations === 0) return;

    if (prevHashRef.current !== null && prevHashRef.current !== latest.txHash) {
      const flc = (latest.amount / 1e8).toFixed(8).replace(/\.?0+$/, '');
      toast({
        variant: 'default',
        title: t('receive.payment_received'),
        description: `+${flc} FLC`,
      });
    }
    prevHashRef.current = latest.txHash;
  }, [data, toast]);
}
