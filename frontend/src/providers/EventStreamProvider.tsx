import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { mutate } from 'swr';
import { getRawToken } from '@/lib/fetcher';
import { GetAPIServerPort } from '../../wailsjs/go/wails/Bindings';
import type { StateEvent } from '@/lib/types';

interface EventStreamCtx {
  event: StateEvent | null;
  connected: boolean;
}

const Ctx = createContext<EventStreamCtx>({ event: null, connected: false });

export function EventStreamProvider({ children }: { children: React.ReactNode }) {
  const [event, setEvent] = useState<StateEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([getRawToken(), GetAPIServerPort()]).then(([token, port]) => {
      if (cancelled || !token) return;

      const base = port > 0 ? `http://127.0.0.1:${port}` : '';
      const url = `${base}/api/events?token=${token}`;
      console.log('[SSE] connecting to', url);
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        console.log('[SSE] connected');
        setConnected(true);
      };

      es.onmessage = (e: MessageEvent) => {
        const ev: StateEvent = JSON.parse(e.data);
        console.log('[SSE] event', ev.state, { nodeRunning: ev.nodeRunning, error: ev.error, portConflict: ev.portConflict, anotherInstance: ev.anotherInstance, blockHeight: ev.blockHeight });
        setEvent(ev);

        if (ev.state === 'block' && !ev.syncedHeight) {
          mutate('/api/balance');
          mutate('/api/info');
        }
        if (ev.state === 'tx') {
          mutate('/api/balance');
          mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/transactions'));
        }
        if (ev.state === 'ready' || ev.state === 'locked' || ev.state === 'noWallet') {
          mutate('/api/info');
          mutate('/api/balance');
        }
      };

      es.onerror = (e) => {
        console.warn('[SSE] error/disconnect', e);
        setConnected(false);
      };
    });

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  return <Ctx.Provider value={{ event, connected }}>{children}</Ctx.Provider>;
}

export function useEventStream(): EventStreamCtx {
  return useContext(Ctx);
}
