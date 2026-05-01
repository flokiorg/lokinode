import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '@/i18n/context';
import { getRawToken } from '@/lib/fetcher';

type Level = 'err' | 'wrn' | 'inf' | 'dbg' | 'trc' | 'raw';

interface LogEntry {
  id: number;
  text: string;
  level: Level;
}

let _id = 0;

function detectLevel(line: string): Level {
  if (line.includes('[ERR]') || line.includes('[CRIT]')) return 'err';
  if (line.includes('[WRN]'))                             return 'wrn';
  if (line.includes('[INF]'))                             return 'inf';
  if (line.includes('[DBG]'))                             return 'dbg';
  if (line.includes('[TRC]'))                             return 'trc';
  return 'raw';
}

const LEVEL_COLOR: Record<Level, string> = {
  err: '#f87171',
  wrn: '#fbbf24',
  inf: '#d1d5db',
  dbg: '#9ca3af',
  trc: '#888888',
  raw: '#9ca3af',
};

const BADGE: Partial<Record<Level, { label: string; fg: string; bg: string }>> = {
  err: { label: 'ERR', fg: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  wrn: { label: 'WRN', fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)' },
};

const MAX_LINES = 500;

const LogLine = React.memo(function LogLine({ entry }: { entry: LogEntry }) {
  const badge = BADGE[entry.level];
  return (
    <div className="flex items-start gap-[5px] px-[2px] py-[1px] rounded hover:bg-white/[0.02]">
      {badge ? (
        <span
          className="shrink-0 mt-[2px] text-[8px] font-mono font-bold px-[4px] py-[1.5px] rounded leading-none"
          style={{ color: badge.fg, background: badge.bg }}
        >
          {badge.label}
        </span>
      ) : (
        <span className="shrink-0 w-[26px]" />
      )}
      <span
        className="font-mono text-[10px] leading-[1.65] break-all"
        style={{ color: LEVEL_COLOR[entry.level] }}
      >
        {entry.text}
      </span>
    </div>
  );
});

type ConnStatus = 'connecting' | 'live' | 'error';

export default function Logs() {
  const { t } = useTranslation();
  const [entries, setEntries]       = useState<LogEntry[]>([]);
  const [connStatus, setConnStatus] = useState<ConnStatus>('connecting');
  const [filename, setFilename]     = useState<string | null>(null);
  const [atBottom, setAtBottom]     = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const atBottomRef  = useRef(true);

  useEffect(() => {
    setEntries([]);
    setFilename(null);
    setConnStatus('connecting');

    let es: EventSource;
    let cancelled = false;

    getRawToken().then(token => {
      if (cancelled) return;
      const params = new URLSearchParams({ token });
      es = new EventSource(`/api/logs/stream?${params}`);

      es.onopen = () => setConnStatus('live');

      es.addEventListener('filename', (e) => {
        setFilename((e as MessageEvent).data as string);
      });

      es.onmessage = (e) => {
        const text = (e.data as string).trim();
        if (!text) return;
        const entry: LogEntry = { id: ++_id, text, level: detectLevel(text) };
        setEntries(prev =>
          prev.length >= MAX_LINES
            ? [...prev.slice(prev.length - MAX_LINES + 1), entry]
            : [...prev, entry],
        );
      };

      es.onerror = () => setConnStatus('error');
    });

    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  useEffect(() => {
    if (atBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
  }, []);

  function scrollToBottom() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    atBottomRef.current = true;
    setAtBottom(true);
  }

  const showFab = !atBottom && entries.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between px-[16px] py-[9px] bg-[#121212] border-b border-white/[0.04]">
        <div className="flex items-center gap-[6px]">
          <div
            className={`w-[5px] h-[5px] rounded-full transition-colors duration-300 ${
              connStatus === 'live'
                ? 'bg-emerald-500 shadow-[0_0_5px_rgba(52,211,153,0.55)]'
                : connStatus === 'connecting'
                ? 'bg-amber-400 animate-pulse'
                : 'bg-red-500'
            }`}
          />
          <span className="text-[10px] font-mono text-gray-400 select-none">
            {connStatus === 'live'       ? t('logs.live')
           : connStatus === 'connecting' ? t('logs.connecting')
           :                              t('logs.reconnecting')}
          </span>
        </div>

        {filename && (
          <span className="text-[9px] font-mono text-gray-400 select-none truncate mx-[12px]">
            {filename}
          </span>
        )}

        <span className="text-[10px] font-mono text-gray-400 select-none tabular-nums shrink-0">
          {t('logs.lines', { count: entries.length.toLocaleString() })}
        </span>
      </div>

      <div className="relative flex-1 overflow-hidden bg-[#090909]">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-[12px] py-[10px]"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#252525 transparent' }}
        >
          {entries.length === 0 ? (
            <p className="text-[10px] font-mono text-gray-400 mt-[2px]">
              {connStatus === 'error'
                ? t('logs.offline')
                : t('logs.waiting')}
            </p>
          ) : (
            entries.map(entry => <LogLine key={entry.id} entry={entry} />)
          )}
        </div>

        <button
          onClick={scrollToBottom}
          aria-hidden={!showFab}
          className={`absolute bottom-[14px] right-[14px] flex items-center gap-[4px]
            bg-[#1a1a1a] border border-white/[0.10] rounded-full
            px-[10px] py-[5px] text-[9px] font-mono
            text-gray-400 hover:text-[#DA9526] hover:border-[#DA9526]/30
            shadow-lg backdrop-blur-sm
            transition-all duration-200 ease-out
            ${showFab
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-[6px] pointer-events-none'
            }`}
        >
          <ChevronDown size={10} strokeWidth={2.5} />
          {t('logs.latest')}
        </button>
      </div>
    </div>
  );
}
