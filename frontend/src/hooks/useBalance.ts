import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { BalanceResponse } from '@/lib/types';

export function useBalance(poll = false) {
  return useSWR<BalanceResponse>(
    '/api/balance',
    fetcher,
    poll ? { refreshInterval: 3000 } : undefined,
  );
}
