import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fetcher, post } from '@/lib/fetcher';

export const DEFAULT_REST_CORS   = 'http://localhost:3000';
export const DEFAULT_RPC_LISTEN  = '127.0.0.1:10005';
export const DEFAULT_REST_LISTEN = '127.0.0.1:5050';

interface NodeConfigState {
  nodeDir:    string
  pubKey:     string
  aliasName:  string
  restCors:   string
  rpcListen:  string
  restListen: string
  nodePublic: boolean
  nodeIP:     string

  setNodeDir:    (v: string)  => void
  setPubKey:     (v: string)  => void
  setAliasName:  (v: string)  => void
  setRestCors:   (v: string)  => void
  setRpcListen:  (v: string)  => void
  setRestListen: (v: string)  => void
  setNodePublic: (v: boolean) => void
  setNodeIP:     (v: string)  => void
  
  fetchConfig:   (dir: string) => Promise<void>
  fetchLastNode: () => Promise<void>
  saveToDB:      () => Promise<void>
}

export const useNodeConfigStore = create<NodeConfigState>()(
  persist(
    (set, get) => ({
      nodeDir:    '',
      pubKey:     '',
      aliasName:  '',
      restCors:   DEFAULT_REST_CORS,
      rpcListen:  DEFAULT_RPC_LISTEN,
      restListen: DEFAULT_REST_LISTEN,
      nodePublic: true,
      nodeIP:     '',

      setNodeDir:    (v) => set({ nodeDir: v }),
      setPubKey:     (v) => set({ pubKey: v }),
      setAliasName:  (v) => set({ aliasName: v }),
      setRestCors:   (v) => set({ restCors: v }),
      setRpcListen:  (v) => set({ rpcListen: v }),
      setRestListen: (v) => set({ restListen: v }),
      setNodePublic: (v) => set({ nodePublic: v }),
      setNodeIP:     (v) => set({ nodeIP: v }),

      fetchConfig: async (dir) => {
        if (!dir) return;
        try {
          const cfg = await fetcher<{
            pubKey?: string,
            alias: string,
            restCors: string,
            rpcListen: string,
            restListen: string,
            nodePublic: boolean,
            nodeIP: string
          }>(`/api/node/config?dir=${encodeURIComponent(dir)}`);
          
          set({
            pubKey: cfg.pubKey || '',
            aliasName: cfg.alias || '',
            restCors: cfg.restCors || DEFAULT_REST_CORS,
            rpcListen: cfg.rpcListen || DEFAULT_RPC_LISTEN,
            restListen: cfg.restListen || DEFAULT_REST_LISTEN,
            nodePublic: cfg.nodePublic ?? true,
            nodeIP: cfg.nodeIP || '',
          });
        } catch (err) {
          console.error('Failed to fetch node config:', err);
        }
      },

      fetchLastNode: async () => {
        try {
          const node = await fetcher<{
            pubKey:     string,
            dir:        string,
            alias:      string,
            nodePublic: boolean,
            externalIP: string,
            restCors:   string,
            rpcListen:  string,
            restListen: string,
          } | null>(`/api/node/last`);

          if (node) {
            set({
              pubKey:     node.pubKey,
              nodeDir:    node.dir,
              aliasName:  node.alias,
              nodePublic: node.nodePublic ?? true,
              nodeIP:     node.externalIP ?? '',
              restCors:   node.restCors   || DEFAULT_REST_CORS,
              rpcListen:  node.rpcListen  || DEFAULT_RPC_LISTEN,
              restListen: node.restListen || DEFAULT_REST_LISTEN,
            });
          }
        } catch (err) {
          console.error('Failed to fetch last node:', err);
        }
      },

      saveToDB: async () => {
        const state = get();
        if (!state.nodeDir) return;
        try {
          await post('/api/node/config', {
            pubKey:     state.pubKey,
            dir:        state.nodeDir,
            alias:      state.aliasName,
            nodePublic: state.nodePublic,
            externalIP: state.nodeIP,
            restCors:   state.restCors,
            rpcListen:  state.rpcListen,
            restListen: state.restListen,
          });
        } catch (err) {
          console.error('Failed to save node config to DB:', err);
        }
      }
    }),
    {
      name:    'loki_node_config_v3',
      storage: createJSONStorage(() => localStorage),
      // We still persist nodeDir as a fallback, but primary logic will use DB
      partialize: (state) => ({ nodeDir: state.nodeDir }),
    },
  ),
);
