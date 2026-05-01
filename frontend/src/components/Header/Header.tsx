import { useState, useRef, useEffect } from 'react';
import { HelpCircle, Settings, Globe } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BrowserOpenURL } from '../../../wailsjs/runtime';
import { useTranslation } from '@/i18n/context';
import { useInfo } from '@/hooks/useInfo';
import { LANGUAGES, Lang } from '@/i18n/translations';
import logo from '../../assets/header/loki.png';

function LanguageDropdown() {
  const [open, setOpen] = useState(false);
  const { lang, setLang } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative pointer-events-auto flex items-center justify-center" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center"
      >
        <Globe size={16} strokeWidth={1.8} />
      </button>

      {open && (
        <div className="absolute right-0 top-[24px] w-[140px] bg-[#1c1c1e] border border-white/[0.08] rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] overflow-hidden py-[4px] z-[100] animate-in fade-in slide-in-from-top-2 duration-200">
          {(Object.keys(LANGUAGES) as Lang[]).map(l => (
            <button
              key={l}
              onClick={() => { setLang(l); setOpen(false); }}
              className={`w-full text-left px-[12px] py-[8px] text-[12px] font-label transition-colors hover:bg-white/[0.04] ${
                lang === l ? 'text-[#DA9526]' : 'text-gray-400'
              }`}
            >
              {LANGUAGES[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const Header = () => {
  const { t } = useTranslation();
  const { data: info } = useInfo();
  const navigate = useNavigate();
  const location = useLocation();
  const isOnboarding = location.pathname === '/';
  const isSettingsPage = location.pathname === '/settings';
  const nodeActive = info?.state === 'ready' || info?.state === 'block' || info?.state === 'tx';

  return (
    <div className="absolute top-0 left-0 right-0 z-[60] flex flex-row items-start px-[20px] h-[116px] pointer-events-none">
      <img
        src={logo}
        alt="Lokinode"
        className="absolute left-1/2 -translate-x-1/2 h-[84px] w-[84px] object-contain cursor-pointer my-[16px] pointer-events-auto"
        onClick={() => navigate(info?.nodeRunning ? '/node' : '/')}
      />
      <div className="ml-auto flex items-center gap-[12px] pt-[14px] pointer-events-auto">
        {info?.version && (
          <span className="text-gray-600 text-[10px] font-mono">{info.version}</span>
        )}
        <LanguageDropdown />
        <button
          className="text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center"
          onClick={() => BrowserOpenURL('https://docs.flokicoin.org/wallets/lokinode')}
          title={t('header.help')}
        >
          <HelpCircle size={16} strokeWidth={1.8} />
        </button>
        {(isSettingsPage || nodeActive) && (
          <button
            className="text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center"
            onClick={() => navigate('/settings')}
            title={t('header.settings')}
          >
            <Settings size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  )
}
