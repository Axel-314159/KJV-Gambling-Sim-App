import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { apiFetch } from './lib/api';
import type { UserProfile } from './types/api';
import { Layout } from './components/Layout';
import { LandingPage } from './pages/LandingPage';
import { BettingDashboard } from './pages/BettingDashboard';
import { PlayerDashboard } from './pages/PlayerDashboard';
import { StatsDashboard } from './pages/StatsDashboard';
import { AdminConsole } from './pages/AdminConsole';
import { 
  LoginPage, 
  SignupPage, 
  ActivatePasswordPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from './pages/AuthPages';

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
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center">
        Loading session...
      </div>
    );
  }

  return (
    <Routes>
      {/* Standalone Auth Routes */}
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/activate" element={<ActivatePasswordPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Shared Layout: Public Homepage (/) + Protected Game Dashboards */}
      <Route element={<Layout user={user ?? null} />}>
        <Route path="/" element={<LandingPage user={user ?? null} />} />

        {user ? (
          <>
            <Route path="/arena" element={<BettingDashboard user={user} />} />
            <Route path="/player" element={<PlayerDashboard user={user} />} />
            <Route path="/stats" element={<StatsDashboard />} />
            {(user.role === 'MODERATOR' || user.role === 'ADMIN') && (
              <Route path="/admin" element={<AdminConsole currentUser={user} />} />
            )}
            <Route path="*" element={<Navigate to="/" />} />
          </>
        ) : (
          <Route path="*" element={<Navigate to="/login" />} />
        )}
      </Route>
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