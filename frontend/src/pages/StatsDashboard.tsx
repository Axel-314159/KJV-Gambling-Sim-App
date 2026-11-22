// src/pages/StatsDashboard.tsx
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { WeeklyStatsResponse } from '../types/api';
import { formatCurrency, formatSignedCurrency } from '../lib/currency';

export function StatsDashboard() {
  const { data: stats } = useQuery<WeeklyStatsResponse>({
    queryKey: ['weeklyStats'],
    queryFn: () => apiFetch<WeeklyStatsResponse>('/stats/weekly'),
  });

  if (!stats) return <div className="text-slate-400">Loading weekly statistics...</div>;

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h1 className="text-xl font-bold text-amber-400">Weekly Arena Report</h1>
        <p className="text-sm text-slate-400">
          Period: {stats.weekStartDate} to {stats.weekEndDate} • Total Wagered: {formatCurrency(stats.totalGerahsWagered)} Shekels
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="font-semibold mb-3">Weekly Top Survivors</h2>
          <ul className="space-y-2 text-sm">
            {stats.topWinners.map((w, i) => (
              <li key={w.username} className="flex justify-between border-b border-slate-800 pb-2">
                <span>#{i + 1} {w.username} ({w.survivingSegments} segments)</span>
                <span className={w.netGerahsWon >= 0 ?"font-mono text-emerald-400": "font-mono text-rose-400"}>{ formatSignedCurrency(w.netGerahsWon) }</span> 
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="font-semibold mb-3">Most Contested Books (High Collisions)</h2>
          <ul className="space-y-2 text-sm">
            {stats.mostContestedBooks.map((b) => (
              <li key={b.bookName} className="flex justify-between border-b border-slate-800 pb-2">
                <span>{b.bookName}</span>
                <span className="font-mono text-rose-400">{b.collisionCount} collisions</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}