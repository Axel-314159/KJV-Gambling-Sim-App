// src/pages/PlayerDashboard.tsx
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../lib/api';
import type { LedgerEntry, UserProfile } from '../types/api';
import { formatCurrency, formatSignedCurrency } from '../lib/currency';
// import { CheckCircle2, AlertTriangle } from 'lucide-react';

export function PlayerDashboard({ user }: { user: UserProfile }) {
  const queryClient = useQueryClient();
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const { data: ledger } = useQuery<LedgerEntry[]>({
    queryKey: ['playerLedger'],
    queryFn: () => apiFetch<LedgerEntry[]>('/player/ledger'),
  });

  const { data: settings } = useQuery<UserProfile>({
    queryKey: ['playerSettings'],
    queryFn: () => apiFetch<UserProfile>('/player/settings'),
  });

  // setAutoRegister(settings?.autoRegister === true ? true : false);

  const updateSettingsMutation = useMutation({
    mutationFn: (autoRegister: boolean) =>
      apiFetch<{ autoRegister: boolean }>('/auth/settings', {
        method: 'PATCH',
        body: JSON.stringify({ autoRegister }),
      }),
    onSuccess: (data) => {
      setSettingsError(null);
      setSettingsStatus('saved');
      queryClient.setQueryData<UserProfile | null>(['me'], (prev) =>
        prev ? { ...prev, autoRegister: data.autoRegister } : prev
      );
    },
    onError: (err: ApiError) => {
      setSettingsStatus('error');
      setSettingsError(err.message);
    }
  });


  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      
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

      </div>


      {/* Settings pane */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h1 className="text-xl font-bold">Player Settings</h1>
        <form
        className="space-y-4 text-sm"
        >
          <input type="checkbox" id="auto_reg_chkbox" name="auto_reg_chkbox"
            onChange={(e) => {
              e.preventDefault();
              setSettingsStatus('idle');
              updateSettingsMutation.mutate(e.target.checked);
            }}
            checked={Boolean(user.autoRegister)}></input>
          <label className="text-sm text-slate-400">&nbsp;&nbsp;Auto-Register For Next Round&nbsp;&nbsp;&nbsp;&nbsp;</label>
        </form>
        
        <br />
        {statusMsg && (
        <div
          className={`px-4 py-3 rounded-lg text-sm flex items-center gap-2 border ${
            statusMsg.type === 'ok'
              ? 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/50 border-rose-800 text-rose-200'
          }`}
        >
          {updateSettingsMutation.isPending && (
            <span className="text-xs text-slate-400">Saving...</span>
          )}
          {!updateSettingsMutation.isPending && settingsStatus === 'saved' && (
            <span className="text-xs text-emerald-400">Saved</span>
          )}
        </div>
      )}
      </div>

      {/* Ledger */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="font-semibold text-lg mb-3">Shekel Ledger History</h2>
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
              <th className="py-2.5 px-3 text-left">Date</th>
              <th className="py-2.5 px-3 text-left">Type</th>
              <th className="py-2.5 px-3 text-left">Round</th>
              <th className="py-2.5 px-3 text-left">Verse Range</th>
              <th className="py-2.5 px-3 text-left">Verse Count</th>
              <th className="py-2.5 px-3 text-right">Amount</th>
              <th className="py-2.5 px-3 text-right">Balance After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-sm">
            {ledger?.map((entry) => (
              <tr key={entry.id} className="hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                  {new Date(entry.createdAt).toLocaleString()}
                </td>
                <td className="py-2.5 px-3 font-medium text-slate-200">
                  {entry.entryType.replace(/_/g, ' ')}
                </td>
                <td className="py-2.5 px-3 text-slate-400">
                  {entry.roundId ? `#${entry.roundId}` : '—'}
                </td>
                <td className="py-2.5 px-3 text-slate-200">
                  {entry.verseRange ?? <span className="text-slate-500">—</span>}
                </td>
                <td className="py-2.5 px-3 text-slate-200">
                  {entry.verseCount ?? <span className="text-slate-500">---</span>}
                </td>
                <td
                  className={`py-2.5 px-3 font-mono text-right whitespace-nowrap ${
                    entry.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatSignedCurrency(entry.amount)}
                </td>
                <td className="py-2.5 px-3 font-mono text-right text-slate-300 whitespace-nowrap">
                  {formatCurrency(entry.balanceAfter)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}