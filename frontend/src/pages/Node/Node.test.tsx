// @vitest-environment jsdom
//
// Verifies the frontend half of the "host loses internet" bug report: when
// the daemon's internal stall-watchdog restarts flnd on its own (a
// StatusDown update with NO error, immediately followed by 'starting' —
// see daemon/client.go's pollSyncStatus and daemon/service.go's
// runHealthRelay, confirmed by daemon/reconnect_test.go and
// daemon/pollsync_test.go in this same change), the UI never shows the
// Retry-capable "Node Error" screen (Node.tsx's `isDown` requires
// state === 'down', which this sequence only holds for a single tick before
// flipping to 'starting'), and the 60s "stuck restart" safety net never
// applies either, because that timer is gated on `isRestarting`
// (Node.tsx effect ~362-371), which is only ever set true by the
// user-initiated Settings restart flow (views/settings/Network.tsx) — never
// by this internal path (confirmed by grep: `setIsRestarting` has exactly
// one call site outside Node.tsx itself, and it's in Network.tsx).
//
// This test drives the real Node.tsx component through that exact SSE event
// sequence and asserts it is left showing the passive "Starting" spinner
// with no error/retry affordance, even 65 real-clock-equivalent seconds
// later.

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/context';
import { useNodeSessionStore } from '@/store/nodeSession';
import { useTransitionStore } from '@/components/TransitionOverlay/TransitionOverlay';
import type { StateEvent, InfoResponse } from '@/lib/types';

// ---- mocks -----------------------------------------------------------------

vi.mock('@/hooks/useEventStream', () => {
  let current: StateEvent | null = null;
  const listeners = new Set<() => void>();
  return {
    useEventStream: () => {
      const [, force] = React.useState(0);
      React.useEffect(() => {
        const l = () => force((n) => n + 1);
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      }, []);
      return { event: current, connected: true, resetEvent: () => {
        current = null;
        listeners.forEach((l) => l());
      } };
    },
    __setMockEvent: (ev: StateEvent | null) => {
      current = ev;
      listeners.forEach((l) => l());
    },
  };
});

const baseInfo: InfoResponse = {
  version: '', latestVersion: '', network: 'main', syncedToChain: false,
  blockHeight: 0, mempoolHeight: 0, bestHeaderTimestamp: 0,
  nodePubkey: '', nodeAlias: '', nodeDir: '', restEndpoint: '',
  macaroonPath: '', tlsCertPath: '', state: 'syncing', nodeRunning: true,
  peerAddress: '', rpcAddress: '', macaroonHex: '', tlsCertHex: '',
  nodePublic: false, externalIP: '', restCors: '',
};

vi.mock('@/hooks/useInfo', () => ({
  useInfo: () => ({ data: baseInfo, mutate: vi.fn() }),
}));
vi.mock('@/hooks/useBalance', () => ({
  useBalance: () => ({ data: undefined, mutate: vi.fn() }),
}));
vi.mock('@/hooks/useNotifyIncoming', () => ({
  useNotifyIncoming: () => {},
}));
vi.mock('../../../wailsjs/go/wails/Bindings', () => ({
  RevealNodeFolder: vi.fn(),
}));

const mockPost = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fetcher')>();
  return { ...actual, post: (...args: unknown[]) => mockPost(...args) };
});

// __setMockEvent is injected by the vi.mock factory above; it isn't part of
// the real module's exported type surface, only the mocked one used here.
// @ts-expect-error -- test-only export, see vi.mock('@/hooks/useEventStream', ...) above
import { __setMockEvent } from '@/hooks/useEventStream';
import Node from './Node';

function renderNode() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/node']}>
        <Node />
      </MemoryRouter>
    </LanguageProvider>
  );
}

beforeEach(() => {
  __setMockEvent(null);
  useNodeSessionStore.setState({
    walletUnlocked: false,
    userStopped: false,
    autoUnlockPending: false,
    isRestarting: false,
    lastAddress: '',
  });
  useTransitionStore.setState({ isActive: false, label: '', sublabel: '' });
  mockPost.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ---- tests ------------------------------------------------------------------

describe('Node: internal stall-restart eventually escalates to the Retry screen', () => {
  it('stays on the passive Starting spinner briefly, then escalates to a working Retry screen after the stalled-boot timeout', () => {
    renderNode();

    // 1) Node is mid-sync (the state the staleness watchdog would have put
    //    it in after ~5 minutes without a new block).
    act(() => {
      __setMockEvent({ state: 'syncing', nodeRunning: true, blockHeight: 100 });
    });
    expect(screen.getByText('Syncing')).toBeInTheDocument();

    // 2) pollSyncStatus gives up after syncStuckTimeout and emits
    //    Update{State: StatusDown} with a nil Err (client.go). Over the
    //    wire this is a StateEvent with state 'down' and NO error field.
    act(() => {
      __setMockEvent({ state: 'down', nodeRunning: true });
    });

    // isDown = state === 'down' && !userStopped && !isRetrying && !isRecovering
    // (Node.tsx) — none of those flags are set here, since nothing the user
    // did caused this. On the code as written today this SHOULD show the
    // Retry-capable "Node Error" screen for at least this tick.
    expect(screen.getByText('Node Error')).toBeInTheDocument();

    // 3) Service.run()'s crashErr==nil branch loops straight back into
    //    runOnce() with no user gate (proven in daemon/reconnect_test.go),
    //    so the very next event is 'starting' — arriving fast enough that a
    //    real user would never see step 2 render at all.
    act(() => {
      __setMockEvent({ state: 'starting', nodeRunning: true });
    });
    expect(screen.queryByText('Node Error')).not.toBeInTheDocument();
    expect(screen.getByText('Starting')).toBeInTheDocument();

    // 4) Nothing else ever arrives (e.g. the restart's own
    //    acquireSignalInterceptor/exec sequence hangs). isRestarting stays
    //    false throughout — its own safety net (Node.tsx ~362-371) covers
    //    only the user-initiated Settings restart flow, not this path — but
    //    a dedicated stalled-boot timer independent of isRestarting must
    //    still promote the screen to the Retry-capable "Node Error" state
    //    once it's been sitting in a boot state too long with no progress.
    act(() => {
      vi.advanceTimersByTime(65_000);
    });

    expect(useNodeSessionStore.getState().isRestarting).toBe(false);
    expect(screen.getByText('Node Error')).toBeInTheDocument();
    expect(screen.queryByText('Starting')).not.toBeInTheDocument();

    // 5) The Retry action must actually be wired to the real restart
    //    endpoint, not just cosmetic — clicking it should call
    //    POST /api/node/restart the same way a real crash's Retry does.
    const retryButton = screen.getAllByRole('button').find((b) => b.textContent === '');
    expect(retryButton).toBeTruthy();
    act(() => {
      retryButton!.click();
    });
    expect(mockPost).toHaveBeenCalledWith('/api/node/restart', {});
  });
});

describe('Node: a genuine crash (control case) does reach the Retry screen', () => {
  it('shows the Node Error / Retry screen and stays there for a real crash with an error', () => {
    renderNode();

    act(() => {
      __setMockEvent({ state: 'syncing', nodeRunning: true, blockHeight: 100 });
    });

    // A real crash: StatusDown WITH an error (daemon/client.go's kill()),
    // and no further event follows because Service.run() now blocks on
    // waitForRetry() (proven in daemon/reconnect_test.go) instead of
    // looping back into 'starting'.
    act(() => {
      __setMockEvent({ state: 'down', nodeRunning: true, error: 'flnd.Main: simulated crash' });
    });

    expect(screen.getByText('Node Error')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(65_000);
    });

    // Unlike the self-triggered case, this MUST still be showing the error
    // screen 65s later — there is no automatic event that would move it
    // off 'down', by design (waitForRetry blocks for real, proven in
    // daemon/reconnect_test.go).
    expect(screen.getByText('Node Error')).toBeInTheDocument();
  });
});

describe('Node: the stalled-boot escalation does not fire for legitimate long operations', () => {
  it('never shows Node Error for a genuinely slow-but-progressing initial sync', () => {
    renderNode();

    // A real initial block download can easily take well over
    // RESTART_STALLED_TIMEOUT_MS (60s). BOOT_STATES only covers
    // 'starting'/'init'/'none'/'' — 'syncing' with rising blockHeight must
    // never be mistaken for a hung restart.
    act(() => {
      __setMockEvent({ state: 'syncing', nodeRunning: true, blockHeight: 100 });
    });
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.queryByText('Node Error')).not.toBeInTheDocument();

    act(() => {
      __setMockEvent({ state: 'syncing', nodeRunning: true, blockHeight: 5000 });
    });
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.queryByText('Node Error')).not.toBeInTheDocument();
    expect(screen.getByText('Syncing')).toBeInTheDocument();
  });

  it('never shows Node Error for a normal boot that settles before the timeout', () => {
    renderNode();

    act(() => {
      __setMockEvent({ state: 'starting', nodeRunning: true });
    });
    act(() => {
      vi.advanceTimersByTime(30_000); // well under RESTART_STALLED_TIMEOUT_MS
    });
    expect(screen.queryByText('Node Error')).not.toBeInTheDocument();

    act(() => {
      __setMockEvent({ state: 'locked', nodeRunning: true });
    });
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.queryByText('Node Error')).not.toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });
});
