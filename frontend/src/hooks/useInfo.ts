import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { InfoResponse } from '@/lib/types';

export function useInfo() {
  return useSWR<InfoResponse>('/api/info', fetcher);
}
