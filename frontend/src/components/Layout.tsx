import { Link, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, Coins, BarChart3, User, ShieldAlert, LogOut, LogIn, UserPlus, ScrollText } from 'lucide-react';
import type { UserProfile } from '../types/api';
import { apiFetch } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { Footer } from './Footer';
import { formatCurrency } from '../lib/currency';

export function Layout({ user }: { user: UserProfile | null }) {
  const location = useLocation();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const navItems = user
    ? [
        { to: '/', label: 'Overview & Rules', icon: ScrollText },
        { to: '/arena', label: 'Betting Arena', icon: BookOpen },
        { to: '/player', label: 'My Ledger & History', icon: User },
        { to: '/stats', label: 'Weekly Stats', icon: BarChart3 },
        ...(user.role === 'MODERATOR' || user.role === 'ADMIN'
          ? [{ to: '/admin', label: user.role === 'ADMIN' ? 'Admin Console' : 'Mod Queue', icon: ShieldAlert }]
          : []),
      ]
    : [{ to: '/', label: 'Overview & Rules', icon: ScrollText }];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/90 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link
              to="/"
              className="font-serif font-bold text-lg text-amber-400 hover:text-amber-300 tracking-wide transition"
            >
              JSTW ARENA
            </Link>
            <nav className="flex items-center gap-1">
              {navItems.map(({ to, label, icon: Icon }) => {
                const active = location.pathname === to;
                return (
                  <Link
                    key={to}
                    to={to}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition ${
                      active
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="hidden sm:inline">{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {user ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-full">
                <Coins className="w-4 h-4 text-amber-400" />
                <span className="font-mono font-semibold text-amber-300">
                  {formatCurrency(user.walletBalance)}
                </span>
              </div>
              <span className="text-sm text-slate-400 hidden md:inline">{user.username}</span>
              <button
                onClick={handleLogout}
                title="Sign Out"
                className="p-2 text-slate-400 hover:text-rose-400 rounded-md hover:bg-slate-800"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-200 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition"
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </Link>
              <Link
                to="/signup"
                className="inline-flex items-center gap-1.5 text-sm font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 px-3.5 py-1.5 rounded-lg transition"
              >
                <UserPlus className="w-4 h-4" />
                Request Account
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}