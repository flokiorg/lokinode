import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';

import { useNavigate, useLocation } from 'react-router-dom';
import { BrowserOpenURL } from '../../../wailsjs/runtime';
import { useTranslation } from '@/i18n/context';
import { useInfo } from '@/hooks/useInfo';
import { Toaster } from '@/components/ui/toaster';
import Security from '@/views/settings/Security';
import Network from '@/views/settings/Network';
import Logs from '@/views/settings/Logs';

type SettingsTab = 'network' | 'security' | 'logs' | 'about';

export default function Settings() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: info } = useInfo();
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>(
    (location.state as { tab?: SettingsTab } | null)?.tab ?? 'network'
  );

  const TABS: { key: SettingsTab; label: string }[] = [
    { key: 'network',  label: t('tab.network') },
    { key: 'security', label: t('tab.security') },
    { key: 'logs',     label: t('tab.logs') },
    { key: 'about',    label: t('tab.about') },
  ];

  const needsUpdate = info?.latestVersion && info?.version && info.latestVersion !== info.version;
  const isLatest = !!info?.latestVersion && !!info?.version && info.latestVersion === info.version;

  return (
    <div className="flex flex-col h-full pt-[116px] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-[20px] py-[16px] border-b border-white/[0.04]">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-400 hover:text-gray-200 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <p className="text-white text-[15px] font-semibold font-headline">{t('settings.title')}</p>
        <div className="w-[18px]" />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.04] px-[4px]">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-[10px] text-[11px] font-label tracking-wide transition-colors ${
              tab === t.key
                ? 'text-[#DA9526] border-b-2 border-[#DA9526]'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content — overflow-y:hidden here so the inner motion.div's
          overflow-y-auto is correctly constrained on all engines.
          Without this, WKWebView (macOS) can let content escape the container. */}
      <div className="flex-1 overflow-x-hidden overflow-y-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={`h-full overflow-hidden ${tab === 'logs' ? '' : 'overflow-y-auto px-[20px] py-[16px]'}`}
          >
            {tab === 'security' && <Security />}
            {tab === 'network'  && <Network />}
            {tab === 'logs'     && <Logs />}
            {tab === 'about'    && (
              <div className="flex flex-col gap-[12px]">
                <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden">
                  <AboutRow
                    label={t('about.version')}
                    value={info?.version ?? '—'}
                    badge={isLatest ? t('about.latest_badge') : undefined}
                  />
                  <AboutRow label={t('about.latest')} value={info?.latestVersion ?? '—'} last />
                </div>

                {needsUpdate && (
                  <button
                    onClick={() => BrowserOpenURL('https://github.com/flokiorg/lokinode/releases/latest')}
                    className="w-full py-[12px] rounded-xl bg-[#DA9526] text-black font-semibold font-label text-[13px] hover:bg-[#c8871f] transition-colors"
                  >
                    {t('about.download')}
                  </button>
                )}

                <div className="bg-[#1c1c1e] border border-white/[0.06] rounded-2xl overflow-hidden mt-[12px]">
                  <LinkRow label="Flokicoin.org" subtitle="The community-driven chain" url="https://flokicoin.org" />
                  <LinkRow label="Lokiwiki" subtitle="Docs, guides and references" url="https://docs.flokicoin.org" />
                  <LinkRow label="Lokihub" subtitle="Self-hosted Lightning hub" url="https://docs.flokicoin.org/lokihub" />
                  <LinkRow label="Wallets" subtitle="Find a wallet for FLC" url="https://docs.flokicoin.org/wallets" />
                  <LinkRow label="GitHub" subtitle="Contribute to the protocol" url="https://github.com/flokiorg" />
                  <LinkRow label="Nostr" subtitle="Stay connected on Nostr" url="https://njump.me/nprofile1qqsvj806upqwfsqaza7lar7c2dmj2ey3f8r8p93kags5zvvl3cet3ygnn7h5f" />
                  <LinkRow label="Discord" subtitle="Join the conversation" url="https://flokicoin.org/discord" last />
                </div>
              </div>

            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <Toaster />
    </div>
  );
}

function AboutRow({ label, value, last, badge }: { label: string; value: string; last?: boolean; badge?: string }) {
  return (
    <div className={`flex items-center justify-between px-[16px] py-[12px] ${last ? '' : 'border-b border-white/[0.04]'}`}>
      <span className="text-gray-400 text-[11px] font-label uppercase tracking-[0.08em]">{label}</span>
      <div className="flex items-center gap-[8px]">
        <span className="text-gray-300 text-[12px] font-mono">{value}</span>
        {badge && (
          <span className="flex items-center gap-[4px] px-[7px] py-[2px] rounded-full bg-[#DA9526]/15 border border-[#DA9526]/30">
            <span className="w-[5px] h-[5px] rounded-full bg-[#DA9526]" />
            <span className="text-[9px] font-mono uppercase tracking-[0.06em] text-[#DA9526]">{badge}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function LinkRow({ label, subtitle, url, last }: { label: string; subtitle?: string; url: string; last?: boolean }) {
  return (
    <button
      onClick={() => BrowserOpenURL(url)}
      className={`w-full flex items-center justify-between px-[16px] py-[14px] hover:bg-white/[0.04] transition-colors group ${last ? '' : 'border-b border-white/[0.04]'}`}
    >
      <div className="flex flex-col items-start gap-[2px]">
        <span className="text-gray-200 text-[13px] font-semibold font-label group-hover:text-white transition-colors">{label}</span>
        {subtitle && <span className="text-gray-500 text-[11px] font-label">{subtitle}</span>}
      </div>
      <ArrowUpRight size={15} className="text-gray-500 group-hover:text-[#DA9526] transition-colors flex-shrink-0" />
    </button>
  );
}
