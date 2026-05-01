import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/context';
import { useToast } from '@/hooks/useToast';
import { fetcher, post } from '@/lib/fetcher';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, Check } from 'lucide-react';
import { Toaster } from '@/components/ui/toaster';
import QRCode from 'qrcode';
import logo from '@/assets/loki.svg';
import type { AddressResponse } from '@/lib/types';

export default function Receive() {
  const { t } = useTranslation();
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();

  async function loadAddress() {
    setLoading(true);
    try {
      const data = await fetcher<AddressResponse>('/api/wallet/address');
      setAddress(data.address);
    } catch (err) {
      toast({ variant: 'destructive', title: t('common.error'), description: String(err) });
    } finally {
      setLoading(false);
    }
  }

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
    loadAddress();
  }, []);

  useEffect(() => {
    if (!address || !canvasRef.current) return;
    const canvas = canvasRef.current;
    QRCode.toCanvas(canvas, address, {
      width: 200,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#FFFFFF', light: '#1c1c1e' },
    }, (err) => {
      if (err) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = new Image();
      img.src = logo;
      img.onload = () => {
        const size = canvas.width;
        const logoSize = Math.round(size * 0.22);
        const x = (size - logoSize) / 2;
        const y = (size - logoSize) / 2;
        const pad = 4;
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

  return (
    <div className="px-[20px] py-[16px] flex flex-col items-center gap-[16px]">
      <p className="text-gray-400 text-[11px] font-label uppercase tracking-[0.08em] self-start">{t('receive.title')}</p>

      <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl p-[20px] flex flex-col items-center gap-[16px] w-full">
        {(loading || generating)
          ? <Skeleton className="w-[200px] h-[200px] rounded-xl" />
          : <canvas 
              key={address} 
              ref={canvasRef} 
              className={`rounded-xl ${generating ? 'animate-in fade-in zoom-in duration-700' : ''}`} 
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
                className={`bg-transparent border-none text-gray-300 text-[11px] font-mono focus:ring-0 outline-none w-full px-0 py-0 cursor-text pointer-events-auto flex-1 mr-[8px] ${generating ? 'animate-in fade-in slide-in-from-bottom-1 duration-500' : ''}`} 
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
        disabled={loading}
        className="w-full py-[12px] rounded-xl border border-white/[0.08] text-gray-400 text-[13px] font-label hover:border-[#DA9526]/40 hover:text-[#DA9526] transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-[8px]"
      >
        {loading && <div className="w-[14px] h-[14px] rounded-full border-2 border-current border-t-transparent animate-spin" />}
        {t('receive.new_addr')}
      </button>

      <Toaster />
    </div>
  );
}
