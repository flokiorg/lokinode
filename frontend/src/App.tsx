import { useEffect } from 'react';
import { createHashRouter, redirect, Outlet, useLocation } from 'react-router-dom';
import Main from './pages/Main/Main';
import Node from './pages/Node/Node';
import Create from './pages/Create/Create';
import Onboard from './pages/Onboard/Onboard';
import Settings from './pages/Settings/Settings';
import { Header } from '@/components/Header/Header';
import { UpdateAlert } from '@/views/main/UpdateAlert';
import './App.css';

// ── Layout ────────────────────────────────────────────────────────────────────
// Renders on every route. Header + UpdateAlert live here so they stay mounted
// across navigations (avoids a second fetch for version info, etc.).

import { TransitionOverlay } from '@/components/TransitionOverlay/TransitionOverlay';

import { useNodeConfigStore } from '@/store/nodeConfig';
import useSWR from 'swr';

import { useTranslation } from '@/i18n/context';

function Layout() {
  const { t } = useTranslation();
  const location = useLocation();
  const isMain = location.pathname === '/';
  const isOnboard = location.pathname === '/onboard';
  const isNode = location.pathname === '/node';

  const {
    nodeDir, setNodeDir,
    pubKey, setPubKey,
    aliasName, setAliasName,
    nodePublic, setNodePublic,
    nodeIP, setNodeIP,
    saveToDB
  } = useNodeConfigStore();
  const { data: info } = useSWR<any>('/api/info', fetcher, { refreshInterval: 5000 });

  // ── Global Node Sync ────────────────────────────────────────────────────────
  // Sync local state (pubkey, alias, visibility) with daemon when running.
  useEffect(() => {
    if (!info?.nodeRunning || !info.nodePubkey) return;

    let changed = false;
    if (info.nodePubkey !== pubKey) {
      setPubKey(info.nodePubkey);
      changed = true;
    }
    
    // Only sync alias from the node if we don't have one set locally, 
    // or if the local one is the generic default.
    const isDefault = !aliasName || aliasName === t('main.default_alias');
    if (info.nodeAlias && isDefault && info.nodeAlias !== aliasName) {
      setAliasName(info.nodeAlias);
      changed = true;
    }

    // Only persist to DB if something actually changed.
    if (changed) {
      saveToDB();
    }
  }, [info?.nodeRunning, info?.nodePubkey, info?.nodeAlias, pubKey, aliasName, setPubKey, setAliasName, saveToDB, t]);

  // Determine glow intensity/color based on page
  const glowOpacity = isMain || isNode ? '0.18' : '0.12';
  const glowPosition = isMain ? '50% 25%' : isNode ? '50% 30%' : '50% 10%';

  return (
    <div className="h-screen bg-[#121212] overflow-hidden relative">
      <TransitionOverlay />
      {/* Centralized Ambient Glow */}
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-1000"
        style={{
          background: `radial-gradient(ellipse 70% 60% at ${glowPosition}, rgba(218,149,38,${glowOpacity}) 0%, transparent 70%)`,
        }}
      />

      <Header />
      <main className="absolute inset-0 z-10 overflow-hidden">
        <Outlet />
      </main>
      <UpdateAlert />
    </div>
  );
}

// ── Route loaders ─────────────────────────────────────────────────────────────
// Loaders run *before* the component mounts and before any React renders.
// This solves two problems with useEffect-based redirects:
//   1. SWR stale-while-revalidate: an old cached `nodeRunning: false` would
//      fire the redirect immediately, creating a Main ↔ Node bounce loop.
//   2. React 18 StrictMode double-invoke: effects intentionally run twice on
//      mount in dev, meaning navigate() fires twice per render cycle.
// With a loader, the redirect is authoritative, synchronous (from React
// Router's perspective), and never fires from inside the component tree.

import { fetcher } from './lib/fetcher';

import { useNodeSessionStore } from '@/store/nodeSession';

async function nodeLoader() {
  try {
    const isRestarting = useNodeSessionStore.getState().isRestarting;
    if (isRestarting) return null;

    const data = await fetcher<{ nodeRunning: boolean }>('/api/info');
    if (!data.nodeRunning) return redirect('/');
    return null;
  } catch {
    const isRestarting = useNodeSessionStore.getState().isRestarting;
    if (isRestarting) return null;
    return redirect('/');
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/',         element: <Main />     },
      { path: '/node',     element: <Node />,     loader: nodeLoader },
      { path: '/onboard',  element: <Onboard />  },
      { path: '/create',   element: <Create />   },
      { path: '/settings', element: <Settings /> },
    ],
  },
]);
