import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { TransactionsResponse } from '@/lib/types';

export function useTransactions(limit = 50, offset = 0, poll = false) {
  const key = `/api/transactions?limit=${limit}&offset=${offset}`;
  return useSWR<TransactionsResponse>(
    key,
    fetcher,
    poll ? { refreshInterval: 5000 } : undefined,
  );
}
