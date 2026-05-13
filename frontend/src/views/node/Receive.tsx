import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/context';
import { useToast } from '@/hooks/useToast';
import { fetcher, patch, post } from '@/lib/fetcher';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, Check } from 'lucide-react';
import { Toaster } from '@/components/ui/toaster';
import QRCode from 'qrcode';
import logo from '@/assets/loki.svg';
import type { AddressResponse } from '@/lib/types';

type AddrType = 'segwit' | 'taproot';

export default function Receive() {
  const { t } = useTranslation();
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addrType, setAddrType] = useState<AddrType>('segwit');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();

  // On mount: load preference + last unused address for that type in parallel.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetcher<{ addressType: AddrType; address?: string }>('/api/wallet/address/preference')
        .catch(() => ({ addressType: 'segwit' as AddrType, address: undefined })),
      fetcher<AddressResponse>('/api/wallet/address'),
    ]).then(([pref, addrData]) => {
      if (cancelled) return;
      setAddrType(pref.addressType);
      setAddress(addrData.address);
    }).catch((err) => {
      if (cancelled) return;
      toast({ variant: 'destructive', title: t('common.error'), description: String(err) });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Switch type: save preference + get last unused address for the new type —
  // single PATCH call, FLND returns the correct address with no extra round-trip.
  async function handleTypeChange(type: AddrType) {
    if (type === addrType || generating) return;
    setGenerating(true);
    const start = Date.now();
    try {
      const data = await patch<{ addressType: AddrType; address: string }>(
        '/api/wallet/address/preference',
        { addressType: type },
      );
      const elapsed = Date.now() - start;
      if (elapsed < 400) await new Promise(r => setTimeout(r, 400 - elapsed));
      setAddrType(data.addressType);
      setAddress(data.address);
    } catch (err) {
      toast({ variant: 'destructive', title: t('common.error'), description: String(err) });
    } finally {
      setGenerating(false);
    }
  }

  // Explicit rotation: advances the derivation index for the current type.
  async function newAddress() {
    setGenerating(true);
    const start = Date.now();
    try {
      const data = await post<AddressResponse>('/api/wallet/address/new', {});
      const elapsed = Date.now() - start;
      if (elapsed < 600) await new Promise(r => setTimeout(r, 600 - elapsed));
      setAddress(data.address);
    } catch (err) {
      toast({ variant: 'destructive', title: t('common.error'), description: String(err) });
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (!address || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const cssSize = 200;
    const dpr = Math.round(window.devicePixelRatio || 1);
    QRCode.toCanvas(canvas, address, {
      width: cssSize * dpr,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#FFFFFF', light: '#1c1c1e' },
    }, (err) => {
      if (err) return;
      canvas.style.width = `${cssSize}px`;
      canvas.style.height = `${cssSize}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = new Image();
      img.src = logo;
      img.onload = () => {
        const size = canvas.width;
        const logoSize = Math.round(size * 0.22);
        const x = (size - logoSize) / 2;
        const y = (size - logoSize) / 2;
        const pad = Math.round(4 * dpr);
        ctx.fillStyle = '#1c1c1e';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, logoSize / 2 + pad, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(img, x, y, logoSize, logoSize);
      };
    });
  }, [address]);

  function copy() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const TYPES: { key: AddrType; label: string }[] = [
    { key: 'segwit',  label: t('receive.segwit') },
    { key: 'taproot', label: t('receive.taproot') },
  ];

  return (
    <div className="px-[20px] py-[16px] flex flex-col items-center gap-[16px]">

      {/* Address type toggle */}
      <div className="w-full flex items-center justify-between">
        <span className="text-gray-500 text-[11px] font-label uppercase tracking-[0.08em]">{t('receive.addr_type')}</span>
        <div className="flex bg-[#1c1c1e] border border-white/[0.06] rounded-lg p-[3px] gap-[2px]">
          {TYPES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleTypeChange(key)}
              disabled={loading || generating}
              className={`px-[14px] py-[5px] rounded-md text-[11px] font-label transition-all duration-150 disabled:opacity-40 ${
                addrType === key
                  ? 'bg-[#DA9526]/15 text-[#DA9526] border border-[#DA9526]/30'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl p-[20px] flex flex-col items-center gap-[16px] w-full">
        {(loading || generating)
          ? <Skeleton className="w-[200px] h-[200px] rounded-xl" />
          : <canvas
              key={address}
              ref={canvasRef}
              className="rounded-xl animate-in fade-in zoom-in duration-300"
            />
        }

        <div
          className={`w-full bg-[#121212] border rounded-xl px-[12px] py-[10px] flex items-center justify-between cursor-pointer transition-colors ${
            copied ? 'border-[#DA9526]/60' : 'border-white/[0.06] hover:border-[#DA9526]/30'
          }`}
          onClick={copy}
        >
          {(loading || generating)
            ? <Skeleton className="h-[10px] flex-1 mr-[8px]" />
            : <input
                key={address}
                type="text"
                readOnly
                value={address}
                className="bg-transparent border-none text-gray-300 text-[11px] font-mono focus:ring-0 outline-none w-full px-0 py-0 cursor-text pointer-events-auto flex-1 mr-[8px]"
                onClick={(e) => { e.stopPropagation(); }}
              />
          }
          <div className="shrink-0 ml-[8px] w-[14px] h-[14px] relative">
            <Copy
              size={14}
              strokeWidth={2}
              className={`absolute inset-0 text-gray-400 transition-all duration-200 ${
                copied ? 'opacity-0 scale-75' : 'opacity-100 scale-100'
              }`}
            />
            <Check
              size={14}
              strokeWidth={2.5}
              className={`absolute inset-0 text-[#DA9526] transition-all duration-200 ${
                copied ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
              }`}
            />
          </div>
        </div>
      </div>

      <button
        onClick={newAddress}
        disabled={loading || generating}
        className="w-full py-[12px] rounded-xl border border-white/[0.08] text-gray-400 text-[13px] font-label hover:border-[#DA9526]/40 hover:text-[#DA9526] transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-[8px]"
      >
        {(loading || generating) && <div className="w-[14px] h-[14px] rounded-full border-2 border-current border-t-transparent animate-spin" />}
        {t('receive.new_addr')}
      </button>

      <Toaster />
    </div>
  );
}
