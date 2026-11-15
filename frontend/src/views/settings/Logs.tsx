import LogStream from '@/components/LogStream/LogStream';

// Settings → Logs tab. The live-tail view lives in the shared LogStream
// component so the standalone LogOverlay (opened from the sync/error screens)
// can reuse it.
export default function Logs() {
  return <LogStream />;
}
