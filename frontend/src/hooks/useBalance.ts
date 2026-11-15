import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { BalanceResponse } from '@/lib/types';

export function useBalance() {
  return useSWR<BalanceResponse>('/api/balance', fetcher);
}
