import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../lib/api';
import type { ReactNode } from 'react';
import { Footer } from '../components/Footer';

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError((err as ApiError).message);
    }
  };

  return (
    <AuthShell>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <form onSubmit={handleSubmit} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h1 className="text-xl font-bold text-amber-400">Sign In to JSTW</h1>
          {error && <div className="text-sm text-rose-400 bg-rose-950/50 p-2.5 rounded">{error}</div>}
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            required
          />
          <button type="submit" className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded-lg">
            Sign In
          </button>
          <p className="text-xs text-slate-400 text-center">
            Need an account? <Link to="/signup" className="text-amber-400 underline">Request Moderator Approval</Link>
          </p>
        </form>
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
              Registration received. Once a Moderator approves your request, you will receive an email link to set your password and claim your <strong>1,000 starting Shekels</strong>.
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
          <h1 className="text-xl font-bold text-amber-400">Set Password & Claim 1,000 Shekels</h1>
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