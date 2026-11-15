import { Link, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, Coins, BarChart3, User, ShieldAlert, LogOut } from 'lucide-react';
import type { UserProfile } from '../types/api';
import { apiFetch } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';

export function Layout({ user }: { user: UserProfile }) {
  const location = useLocation();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const navItems = [
    { to: '/', label: 'Betting Arena', icon: BookOpen },
    { to: '/player', label: 'My Ledger & History', icon: User },
    { to: '/stats', label: 'Weekly Stats', icon: BarChart3 },
    ...(user.role === 'MODERATOR' || user.role === 'ADMIN'
      ? [{ to: '/admin', label: user.role === 'ADMIN' ? 'Admin Console' : 'Mod Queue', icon: ShieldAlert }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/90 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="font-serif font-bold text-lg text-amber-400 tracking-wide">
              KJV VERSE ARENA
            </span>
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
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-full">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="font-mono font-semibold text-amber-300">
                {user.walletBalance.toLocaleString()} Shekels
              </span>
            </div>
            <span className="text-sm text-slate-400">{user.username}</span>
            <button
              onClick={handleLogout}
              title="Sign Out"
              className="p-2 text-slate-400 hover:text-rose-400 rounded-md hover:bg-slate-800"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}