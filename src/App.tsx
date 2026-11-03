import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Callback from './pages/Callback';
import Dashboard from './pages/Dashboard';
import Forge from './pages/Forge';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/about" element={<Landing />} />
      <Route path="/callback" element={<Callback />} />
      <Route path="/setup" element={<Setup />} />
      {/* Logged-in area: sidebar + auth guard */}
      <Route element={<AppShell />}>
        <Route path="/app" element={<Dashboard />} />
        <Route path="/forge" element={<Forge />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
