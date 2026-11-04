import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { loadTenant, type Tenant } from './lib/tenant';
import Callback from './pages/Callback';
import Dashboard from './pages/Dashboard';
import Forge from './pages/Forge';
import Landing from './pages/Landing';
import Login from './pages/Login';
import MyWebsites from './pages/sites/MyWebsites';
import SiteWizard from './pages/sites/SiteWizard';
import PreviewSite from './pages/sites/PreviewSite';
import TraderApp from './trader/TraderApp';
import Network from './pages/Network';
import Billing from './pages/Billing';
import Commissions from './pages/Commissions';
import XmlBots from './pages/XmlBots';
import Support from './pages/Support';
import Settings from './pages/Settings';

/**
 * One build, two apps:
 * - mwasya.site            → operator studio
 * - <sub>.mwasya.site      → that operator's trader site
 */
export default function App() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  useEffect(() => { loadTenant().then(setTenant); }, []);

  if (!tenant) return <div className="shell-loading"><span className="spinner" /> Loading…</div>;

  if (tenant.kind === 'unknown') {
    return (
      <main className="login-bg">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>No site here yet</h1>
          <p className="muted">There is no live trading site at this address.</p>
          <a className="btn btn-primary" href="https://mwasya.site">Go to Mwasya</a>
        </div>
      </main>
    );
  }

  if (tenant.kind === 'site') {
    document.title = `${tenant.site.name} · Trading bots`;
    return (
      <Routes>
        <Route path="/" element={<Login site={tenant.site} />} />
        <Route path="/callback" element={<Callback />} />
        <Route path="/app/*" element={<TraderApp site={tenant.site} bots={tenant.bots} xmlBots={tenant.xmlBots ?? []} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/about" element={<Landing />} />
      <Route path="/callback" element={<Callback />} />
      <Route path="/preview/:id/*" element={<PreviewSite />} />
      {/* Logged-in area: sidebar + auth guard */}
      <Route element={<AppShell />}>
        <Route path="/app" element={<Dashboard />} />
        <Route path="/forge" element={<Forge />} />
        <Route path="/sites" element={<MyWebsites />} />
        <Route path="/sites/new" element={<SiteWizard />} />
        <Route path="/sites/:id" element={<SiteWizard />} />
        <Route path="/setup" element={<Navigate to="/sites" replace />} />
        <Route path="/network" element={<Network />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/commissions" element={<Commissions />} />
        <Route path="/xml-bots" element={<XmlBots />} />
        <Route path="/support" element={<Support />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
