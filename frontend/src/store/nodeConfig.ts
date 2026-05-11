import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fetcher } from '@/lib/fetcher';

export const DEFAULT_REST_CORS   = 'http://localhost:3000';
export const DEFAULT_RPC_LISTEN  = '127.0.0.1:10005';
export const DEFAULT_REST_LISTEN = '127.0.0.1:5050';

// Only persistent identity fields live here.
// Daemon config (cors, listen addresses, nodePublic, externalIP) belongs in
// the DB and is loaded fresh from /api/node/config wherever needed.
interface NodeConfigState {
  nodeDir:   string
  pubKey:    string
  aliasName: string

  setNodeDir:   (v: string) => void
  setPubKey:    (v: string) => void
  setAliasName: (v: string) => void

  fetchLastNode: () => Promise<void>
}

export const useNodeConfigStore = create<NodeConfigState>()(
  persist(
    (set) => ({
      nodeDir:   '',
      pubKey:    '',
      aliasName: '',

      setNodeDir:   (v) => set({ nodeDir: v }),
      setPubKey:    (v) => set({ pubKey: v }),
      setAliasName: (v) => set({ aliasName: v }),

      fetchLastNode: async () => {
        try {
          const node = await fetcher<{
            pubKey:  string
            dir:     string
            alias:   string
          } | null>('/api/node/last');

          if (node) {
            set({ pubKey: node.pubKey, nodeDir: node.dir, aliasName: node.alias });
          }
        } catch (err) {
          console.error('Failed to fetch last node:', err);
        }
      },
    }),
    {
      name:    'loki_node_config_v3',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ nodeDir: state.nodeDir }),
    },
  ),
);
