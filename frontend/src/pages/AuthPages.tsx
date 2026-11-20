import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../lib/api';
import type { ReactNode } from 'react';
import { Footer } from '../components/Footer';
import type { UserProfile } from '../types/api';

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        {children}
      </div>
      <Footer />
    </div>
  );
}


export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ user?: UserProfile }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    onSuccess: async (data) => {
      setError(null);
      if (data?.user) {
        queryClient.setQueryData(['me'], data.user);
      } else {
        await queryClient.refetchQueries({ queryKey: ['me'] });
      }
      navigate('/', { replace: true });
    },
    onError: (err: ApiError) => setError(err.message),
  });

  return (
    <AuthShell>
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h1 className="text-xl font-bold text-slate-100">Sign In</h1>

        {error && (
          <div className="bg-rose-950/60 border border-rose-800 text-rose-200 px-3 py-2 rounded-lg text-xs">
            {error}
          </div>
        )}

        {/* 1. Triggered when the form is submitted */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loginMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs text-slate-400 mb-1">Username</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-slate-400">Password</label>
              <Link to="/forgot-password" className="text-xs text-amber-400 hover:text-amber-300">
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* 2. Tracks in-flight request state */}
          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-2 rounded-lg text-sm transition"
          >
            {loginMutation.isPending ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="text-center text-xs text-slate-400">
          Need an account?{' '}
          <Link to="/signup" className="text-amber-400 hover:text-amber-300">
            Request access
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

export function SignupPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ username, email }),
      });
      setSubmitted(true);
    } catch (err) {
      setError((err as ApiError).message);
    }
  };

  return (
    <AuthShell>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h1 className="text-xl font-bold text-amber-400">Request Player Account</h1>
          {submitted ? (
            <div className="text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-800 p-4 rounded-lg">
              Registration received. Once a Moderator approves your request, you will receive an email link to set your password and claim your starting grant of Shekels.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="text-sm text-rose-400 bg-rose-950/50 p-2.5 rounded">{error}</div>}
              <input
                type="text"
                placeholder="Desired Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                required
              />
              <input
                type="email"
                placeholder="Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                required
              />
              <button type="submit" className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded-lg">
                Submit Application
              </button>
            </form>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

export function ActivatePasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/auth/activate', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/arena');
    } catch (err) {
      setError((err as ApiError).message);
    }
  };

  return (
    <AuthShell>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <form onSubmit={handleActivate} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h1 className="text-xl font-bold text-amber-400">Set Password & Claim Your Starting Grant</h1>
          {error && <div className="text-sm text-rose-400 bg-rose-950/50 p-2.5 rounded">{error}</div>}
          <input
            type="password"
            minLength={10}
            placeholder="Choose a password (min 10 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            required
          />
          <button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2 rounded-lg">
            Activate Account
          </button>
        </form>
      </div>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const forgotMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    onSuccess: (res) => {
      setError(null);
      setSubmittedMessage(res.message);
    },
    onError: (err: ApiError) => setError(err.message),
  });

  return (
    <AuthShell>
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Reset Password</h1>
          <p className="text-xs text-slate-400 mt-1">
            Enter the email address associated with your account and we&apos;ll send you a reset link.
          </p>
        </div>

        {error && (
          <div className="bg-rose-950/60 border border-rose-800 text-rose-200 px-3 py-2 rounded-lg text-xs">
            {error}
          </div>
        )}

        {submittedMessage ? (
          <div className="space-y-4">
            <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-200 px-3 py-3 rounded-lg text-xs">
              {submittedMessage}
            </div>
            <Link
              to="/login"
              className="block w-full text-center bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold py-2 rounded-lg text-sm transition"
            >
              Return to Sign In
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              forgotMutation.mutate();
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs text-slate-400 mb-1">Email Address</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={forgotMutation.isPending}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-2 rounded-lg text-sm transition"
            >
              {forgotMutation.isPending ? 'Sending Reset Link...' : 'Send Password Reset Link'}
            </button>

            <div className="text-center text-xs text-slate-400">
              Remembered your password?{' '}
              <Link to="/login" className="text-amber-400 hover:text-amber-300">
                Sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);

  const resetMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      }),
    onSuccess: (res) => {
      setError(null);
      setCompletedMessage(res.message);
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('Missing password reset token. Please use the link from your email.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    resetMutation.mutate();
  };

  return (
    <AuthShell>
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Choose a New Password</h1>
          <p className="text-xs text-slate-400 mt-1">
            Enter a new password (minimum 8 characters) for your account.
          </p>
        </div>

        {error && (
          <div className="bg-rose-950/60 border border-rose-800 text-rose-200 px-3 py-2 rounded-lg text-xs">
            {error}
          </div>
        )}

        {completedMessage ? (
          <div className="space-y-4">
            <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-200 px-3 py-3 rounded-lg text-xs">
              {completedMessage}
            </div>
            <Link
              to="/login"
              className="block w-full text-center bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2 rounded-lg text-sm transition"
            >
              Continue to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">New Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={resetMutation.isPending}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-2 rounded-lg text-sm transition"
            >
              {resetMutation.isPending ? 'Updating Password...' : 'Set New Password'}
            </button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}