import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { InfoResponse } from '@/lib/types';

export function useInfo(poll = false) {
  return useSWR<InfoResponse>(
    '/api/info',
    fetcher,
    poll ? { refreshInterval: 2000 } : undefined,
  );
}
