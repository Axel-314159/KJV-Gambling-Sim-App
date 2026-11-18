// src/pages/PlayerDashboard.tsx
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { LedgerEntry, UserProfile } from '../types/api';
import { formatCurrency, formatSignedCurrency } from '../lib/currency';

export function PlayerDashboard({ user }: { user: UserProfile }) {
  const { data: ledger } = useQuery<LedgerEntry[]>({
    queryKey: ['playerLedger'],
    queryFn: () => apiFetch<LedgerEntry[]>('/player/ledger'),
  });

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h1 className="text-xl font-bold">Player Profile: {user.username}</h1>
        <p className="text-sm text-slate-400">{user.email} • Role: {user.role}</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Available Wallet Balance</div>
          <div className="text-2xl font-mono font-bold text-amber-300 mt-1">
            {formatCurrency(user.walletBalance)}
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="font-semibold text-lg mb-3">Shekel Ledger History</h2>
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase text-slate-400 border-b border-slate-800">
            <tr>
              <th className="py-2">Event</th>
              <th className="py-2">Round</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-right">Balance After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {ledger?.map((entry) => (
              <tr key={entry.id}>
                <td className="py-2.5 font-medium">{entry.entryType.replaceAll('_', ' ')}</td>
                <td className="py-2.5 text-slate-400">{entry.roundId ?? '—'}</td>
                <td className={`py-2.5 text-right font-mono ${entry.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatSignedCurrency(entry.amount)}
                </td>
                <td className="py-2.5 text-right font-mono">{formatCurrency(entry.balanceAfter)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}