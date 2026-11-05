import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
// Shared client-site code (read-only reuse — nothing in ../../src is changed for standalone sites).
import '../../src/styles.css';
import { RouteBar, Spotlight, Toaster } from '../../src/components/motion';
import { Loader } from '../../src/components/Loader';
import { loadTenant, type Tenant } from '../../src/lib/tenant';
import Callback from '../../src/pages/Callback';
import SiteLanding from '../../src/trader/SiteLanding';
import TraderApp from '../../src/trader/TraderApp';

/** A single client trading site, without the Mwasya studio or database. Settings come from /site.json. */
function StandaloneApp() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  useEffect(() => { loadTenant().then(setTenant); }, []);
  if (!tenant) return <Loader label="Loading" />;
  if (tenant.kind !== 'site') return <p style={{ padding: 40 }}>This site is not set up yet: its settings file is missing.</p>;
  if (!tenant.site.appId) return <p style={{ padding: 40 }}>Add the DERIV_APP_ID setting for this site, then redeploy.</p>;
  document.title = `${tenant.site.name} · Trading`;
  return (
    <Routes>
      <Route path="/" element={<SiteLanding site={tenant.site} />} />
      <Route path="/callback" element={<Callback />} />
      <Route path="/app/*" element={<TraderApp site={tenant.site} bots={tenant.bots} xmlBots={tenant.xmlBots ?? []} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RouteBar />
      <Spotlight />
      <StandaloneApp />
      <Toaster />
    </BrowserRouter>
  </StrictMode>,
);
