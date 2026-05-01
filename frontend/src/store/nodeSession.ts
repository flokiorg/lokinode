import { create } from 'zustand';

interface NodeSessionState {
  walletUnlocked: boolean
  userStopped: boolean
  // One-shot flag: true when the user just powered the node from Main, so
  // /node should pop the unlock sheet automatically as soon as the daemon
  // reports `locked`. Consumed and cleared by Node once it fires.
  autoUnlockPending: boolean
  // Set by Settings restart handler, cleared by Node once the daemon is
  // confirmed running again. Prevents Node from navigating to / while the
  // daemon is intentionally down mid-restart.
  isRestarting: boolean
  lastAddress: string
  setWalletUnlocked: (v: boolean) => void
  setUserStopped: (v: boolean) => void
  setAutoUnlockPending: (v: boolean) => void
  setLastAddress: (v: string) => void
  setIsRestarting: (v: boolean) => void
  clearSession: () => void
}

export const useNodeSessionStore = create<NodeSessionState>()((set) => ({
  walletUnlocked: false,
  userStopped: false,
  autoUnlockPending: false,
  isRestarting: false,
  lastAddress: '',
  setWalletUnlocked: (v) => set({ walletUnlocked: v }),
  setUserStopped: (v) => set({ userStopped: v }),
  setAutoUnlockPending: (v) => set({ autoUnlockPending: v }),
  setLastAddress: (v) => set({ lastAddress: v }),
  setIsRestarting: (v) => set({ isRestarting: v }),
  clearSession: () => set({ walletUnlocked: false, lastAddress: '' }),
}));
