import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { apiFetch } from './lib/api';
import type { UserProfile } from './types/api';
import { Layout } from './components/Layout';
import { BettingDashboard } from './pages/BettingDashboard';
import { PlayerDashboard } from './pages/PlayerDashboard';
import { StatsDashboard } from './pages/StatsDashboard';
import { AdminConsole } from './pages/AdminConsole';
import { LoginPage, SignupPage, ActivatePasswordPage } from './pages/AuthPages';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function AppRoutes() {
  const { data: user, isLoading } = useQuery<UserProfile | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await apiFetch<UserProfile>('/auth/me');
      } catch {
        return null;
      }
    },
  });

  if (isLoading) {
    return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center">Loading session...</div>;
  }

  return (
    <Routes>
      {/* Public Auth Routes */}
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/signup" element={user ? <Navigate to="/" /> : <SignupPage />} />
      <Route path="/activate" element={<ActivatePasswordPage />} />

      {/* Protected App Routes */}
      {user ? (
        <Route element={<Layout user={user} />}>
          <Route path="/" element={<BettingDashboard user={user} />} />
          <Route path="/player" element={<PlayerDashboard user={user} />} />
          <Route path="/stats" element={<StatsDashboard />} />
          {(user.role === 'MODERATOR' || user.role === 'ADMIN') && (
            <Route path="/admin" element={<AdminConsole currentUser={user} />} />
          )}
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      ) : (
        <Route path="*" element={<Navigate to="/login" />} />
      )}
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}