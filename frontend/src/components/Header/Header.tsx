import { useState, useRef, useEffect } from 'react';
import { HelpCircle, Settings, Globe, Minus, X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BrowserOpenURL, Environment, WindowMinimise, WindowHide } from '../../../wailsjs/runtime';
import { useTranslation } from '@/i18n/context';
import { useInfo } from '@/hooks/useInfo';
import { isNewerVersion } from '@/lib/version';
import { LANGUAGES, Lang } from '@/i18n/translations';
import logo from '../../assets/header/loki.png';

// Wails' drag-region CSS custom property (default name/value, see
// pkg/options.Options.CSSDragProperty/CSSDragValue in the Wails v2 source).
// A no-op everywhere except inside an actual Wails desktop window.
const DRAG_STYLE = { ['--wails-draggable' as string]: 'drag' } as React.CSSProperties;

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
          className="text-gray-400 hover:text-gray-200 transition-colors flex items-center justify-center"
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
                lang === l ? 'text-[#DA9526]' : 'text-gray-300'
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
  const nodeActive = !!info?.nodeRunning;
  const needsUpdate = isNewerVersion(info?.latestVersion, info?.version);

  // Windows runs frameless (see lokinode.go) with no native window controls
  // at all, unlike macOS's hidden-inset titlebar which keeps the native
  // traffic lights. Only Windows needs a hand-built minimize/close pair.
  // Outside an actual Wails window (e.g. plain browser dev mode) there is no
  // window.runtime bridge, and Environment() throws synchronously rather
  // than rejecting — deferring the call into a promise chain lets .catch
  // handle that case too, correctly hiding these buttons there.
  const [platform, setPlatform] = useState('');
  useEffect(() => {
    Promise.resolve()
      .then(() => Environment())
      .then(env => setPlatform(env.platform))
      .catch(() => {});
  }, []);
  const isWindows = platform === 'windows';

  return (
    <div className="absolute top-0 left-0 right-0 z-[60] flex flex-row items-start px-[20px] h-[116px] pointer-events-none">
      {/* Drag handle: lets the frameless Windows window (and macOS's
          transparent hidden-inset titlebar, which loses its native drag
          region once content extends full-size behind it) be moved by
          grabbing empty header space. A plain sibling behind the logo/button
          cluster in paint order, so their own pointer-events still win on
          overlap — no per-element "no-drag" opt-outs needed. */}
      <div className="absolute inset-0 pointer-events-auto" style={DRAG_STYLE} />
      <img
        src={logo}
        alt="Lokinode"
        className="absolute left-1/2 -translate-x-1/2 h-[84px] w-[84px] object-contain cursor-pointer my-[16px] pointer-events-auto"
        onClick={() => navigate(info?.nodeRunning ? '/node' : '/')}
      />
      <div className="ml-auto flex items-center gap-[12px] pt-[14px] pointer-events-auto">
        <LanguageDropdown />
        <button
          className="relative flex items-center justify-center transition-colors"
          onClick={() => needsUpdate
            ? BrowserOpenURL('https://docs.flokicoin.org/wallets/lokinode/')
            : BrowserOpenURL('https://docs.flokicoin.org/wallets/lokinode')
          }
          title={needsUpdate ? t('header.update_available', { version: info?.latestVersion }) : t('header.help')}
        >
          <HelpCircle
            size={16}
            strokeWidth={1.8}
            className={needsUpdate ? 'text-[#DA9526]' : 'text-gray-400 hover:text-gray-200'}
          />
          {needsUpdate && (
            <span className="absolute -top-[3px] -right-[3px] w-[6px] h-[6px] rounded-full bg-[#DA9526]" />
          )}
        </button>
        {(isSettingsPage || nodeActive) && (
          <button
            className="text-gray-400 hover:text-gray-200 transition-colors flex items-center justify-center"
            onClick={() => navigate('/settings')}
            title={t('header.settings')}
          >
            <Settings size={16} strokeWidth={1.8} />
          </button>
        )}
        {isWindows && (
          <div className="flex items-center gap-[4px] ml-[4px]">
            <button
              className="text-gray-400 hover:text-gray-200 transition-colors flex items-center justify-center w-[28px] h-[28px] rounded-md hover:bg-white/[0.06]"
              onClick={() => WindowMinimise()}
              title={t('header.minimize')}
            >
              <Minus size={14} strokeWidth={2} />
            </button>
            <button
              className="text-gray-400 hover:text-red-400 transition-colors flex items-center justify-center w-[28px] h-[28px] rounded-md hover:bg-white/[0.06]"
              onClick={() => WindowHide()}
              title={t('header.close')}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
