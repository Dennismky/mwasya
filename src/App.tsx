import { Navigate, Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing';
import Setup from './pages/Setup';
import Callback from './pages/Callback';
import Dashboard from './pages/Dashboard';
import Forge from './pages/Forge';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/callback" element={<Callback />} />
      <Route path="/app" element={<Dashboard />} />
      <Route path="/forge" element={<Forge />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
