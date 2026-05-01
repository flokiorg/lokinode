import { create } from 'zustand';
import { formatWords } from '@/utils/format';
import { post } from '@/lib/fetcher';
import type { MnemonicResponse } from '@/lib/types';

interface WalletCreateState {
  pwd:               string
  status:            'pwd' | 'create'
  createPassphrase:  string
  createMnemonic:    string
  showCreateMnemonic: string[]
  showMnemonicDialog: boolean
  confirmLoading:    boolean

  setPwd:               (v: string)           => void
  setStatus:            (v: 'pwd' | 'create') => void
  setCreatePassphrase:  (v: string)           => void
  setShowMnemonicDialog:(v: boolean)          => void
  setConfirmLoading:    (v: boolean)          => void

  genSeed:    (aezeedPass: string) => Promise<{ status: string; data?: string[]; error?: unknown }>
  initWallet: (walletPassword: string, existMnemonic: string, aezeedPass: string, existXprv: string) => Promise<{ status: string; error?: unknown }>

  reset: () => void
}

const INITIAL: Pick<WalletCreateState,
  'pwd' | 'status' | 'createPassphrase' | 'createMnemonic' | 'showCreateMnemonic' | 'showMnemonicDialog' | 'confirmLoading'
> = {
  pwd:               '',
  status:            'pwd',
  createPassphrase:  '',
  createMnemonic:    '',
  showCreateMnemonic: [],
  showMnemonicDialog: false,
  confirmLoading:    false,
};

export const useWalletCreateStore = create<WalletCreateState>((set) => ({
  ...INITIAL,

  setPwd:               (v) => set({ pwd: v }),
  setStatus:            (v) => set({ status: v }),
  setCreatePassphrase:  (v) => set({ createPassphrase: v }),
  setShowMnemonicDialog:(v) => set({ showMnemonicDialog: v }),
  setConfirmLoading:    (v) => set({ confirmLoading: v }),

  genSeed: async (aezeedPass) => {
    try {
      const data = await post<MnemonicResponse>('/api/wallet/seed', { aezeedPass });
      set({ createMnemonic: formatWords(data.mnemonic), showCreateMnemonic: data.mnemonic });
      return { status: 'success', data: data.mnemonic };
    } catch (error) {
      return { status: 'fail', error };
    }
  },

  initWallet: async (walletPassword, existMnemonic, aezeedPass, existXprv) => {
    try {
      await post('/api/wallet/init', { password: walletPassword, mnemonic: existMnemonic, aezeedPass, xprv: existXprv });
      return { status: 'success' };
    } catch (error) {
      return { status: 'fail', error };
    }
  },

  reset: () => set(INITIAL),
}));
