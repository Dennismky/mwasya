import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { loadTenant, type Tenant } from './lib/tenant';
import Callback from './pages/Callback';
import Dashboard from './pages/Dashboard';
import Forge from './pages/Forge';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Setup from './pages/Setup';
import TraderHome from './pages/TraderHome';
import Network from './pages/Network';
import Billing from './pages/Billing';

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
        <Route path="/app" element={<TraderHome site={tenant.site} bots={tenant.bots} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/about" element={<Landing />} />
      <Route path="/callback" element={<Callback />} />
      {/* Logged-in area: sidebar + auth guard */}
      <Route element={<AppShell />}>
        <Route path="/app" element={<Dashboard />} />
        <Route path="/forge" element={<Forge />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/network" element={<Network />} />
        <Route path="/billing" element={<Billing />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
