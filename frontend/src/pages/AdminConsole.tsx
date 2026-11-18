import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Save, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import type { AdminGameConfigResponse, UserProfile } from '../types/api';
import { splitGerahs, toGerahs } from '../lib/currency';

function toLocalDatetimeInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminConsole({ currentUser }: { currentUser: UserProfile }) {
  const queryClient = useQueryClient();

  const { data: pendingUsers } = useQuery<UserProfile[]>({
    queryKey: ['pendingUsers'],
    queryFn: () => apiFetch<UserProfile[]>('/mod/pending-users'),
  });

  const [grantShekelsByUser, setGrantShekelsByUser] = useState<Record<string, number>>({});
  const [approvalFeedback, setApprovalFeedback] = useState<string | null>(null);

  const approveMutation = useMutation({
    mutationFn: ({ userId, initialGrantGerahs }: { userId: string; initialGrantGerahs: number }) =>
      apiFetch<{ message: string }>(`/mod/users/${userId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ initialGrantGerahs }),
      }),
    onSuccess: (res) => {
      setApprovalFeedback(res.message);
      queryClient.invalidateQueries({ queryKey: ['pendingUsers'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h1 className="text-xl font-bold">
          {currentUser.role === 'ADMIN' ? 'Admin & Moderation Console' : 'Moderator Approval Queue'}
        </h1>
      </div>

      {currentUser.role === 'ADMIN' && <RoundConfigEditor />}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h2 className="font-semibold">Pending Account Approvals</h2>

        {approvalFeedback && (
          <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-200 px-3 py-2 rounded-lg text-xs">
            {approvalFeedback}
          </div>
        )}

        {!pendingUsers?.length ? (
          <p className="text-sm text-slate-400">No accounts awaiting approval.</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {pendingUsers.map((u) => {
              const shekels = grantShekelsByUser[u.id] ?? 100;

              return (
                <div key={u.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{u.username}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <label className="flex items-center gap-1.5 text-xs text-slate-400">
                      <span>Initial Grant:</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={shekels}
                        onChange={(e) => {
                          const val = Math.max(0, Math.floor(Number(e.target.value) || 0));
                          setGrantShekelsByUser((prev) => ({ ...prev, [u.id]: val }));
                        }}
                        className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-right font-mono text-sm text-amber-300"
                      />
                      <span>Shekels</span>
                    </label>

                    <button
                      onClick={() =>
                        approveMutation.mutate({
                          userId: u.id,
                          initialGrantGerahs: toGerahs(shekels, 0),
                        })
                      }
                      disabled={approveMutation.isPending}
                      className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-bold px-3 py-1.5 rounded transition"
                    >
                      Approve &amp; Send Password Link
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RoundConfigEditor() {
  const queryClient = useQueryClient();
  const [defaultOpenTime, setDefaultOpenTime] = useState('08:00');
  const [defaultCloseTime, setDefaultCloseTime] = useState('20:00');
  const [nextOpensLocal, setNextOpensLocal] = useState('');
  const [nextClosesLocal, setNextClosesLocal] = useState('');
  const [minSegmentLength, setMinSegmentLength] = useState(3);
  const [maxSegmentLength, setMaxSegmentLength] = useState(100);
  const [minSegments, setMinSegments] = useState(1);
  const [maxSegments, setMaxSegments] = useState(5);
  const [maxRegisteredPlayers, setMaxRegisteredPlayers] = useState<string>('');
  const [minStakeShekels, setMinStakeShekels] = useState(1);
  const [minStakeGerahs, setMinStakeGerahs] = useState(0);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const {
    data: cfgData,
    isLoading,
    isError,
    error,
  } = useQuery<AdminGameConfigResponse>({
    queryKey: ['adminGameConfig'],
    queryFn: () => apiFetch<AdminGameConfigResponse>('/admin/config'),
  });

  useEffect(() => {
    if (!cfgData) return;
    const { defaultConfig, activeRound } = cfgData;
    const source = activeRound && !activeRound.isLocked ? activeRound : defaultConfig;

    const splitMinStake = splitGerahs(source.minStakePerVerse);
    setDefaultOpenTime(defaultConfig.defaultOpenTime);
    setDefaultCloseTime(defaultConfig.defaultCloseTime);
    setMinSegmentLength(source.minSegmentLength);
    setMaxSegmentLength(source.maxSegmentLength);
    setMinSegments(source.minSegments);
    setMaxSegments(source.maxSegments);
    setMaxRegisteredPlayers(source.maxRegisteredPlayers !== null ? String(source.maxRegisteredPlayers) : '');
    setMinStakeShekels(splitMinStake.shekels);
    setMinStakeGerahs(splitMinStake.gerahs);

    if (activeRound && !activeRound.isLocked) {
      setNextOpensLocal(toLocalDatetimeInput(activeRound.bettingOpensAt));
      setNextClosesLocal(toLocalDatetimeInput(activeRound.bettingClosesAt));
    } else {
      setNextOpensLocal(toLocalDatetimeInput(defaultConfig.pendingNextOpensAt));
      setNextClosesLocal(toLocalDatetimeInput(defaultConfig.pendingNextClosesAt));
    }
  }, [cfgData]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ message: string }>('/admin/config', {
        method: 'PUT',
        body: JSON.stringify({
          defaultOpenTime,
          defaultCloseTime,
          minSegmentLength: Number(minSegmentLength),
          maxSegmentLength: Number(maxSegmentLength),
          minSegments: Number(minSegments),
          maxSegments: Number(maxSegments),
          maxRegisteredPlayers: maxRegisteredPlayers.trim() === '' ? null : Number(maxRegisteredPlayers),
          minStakePerVerse: Math.max(1, toGerahs(Number(minStakeShekels), Number(minStakeGerahs))),
          nextBettingOpensAt: nextOpensLocal ? new Date(nextOpensLocal).toISOString() : null,
          nextBettingClosesAt: nextClosesLocal ? new Date(nextClosesLocal).toISOString() : null,
        }),
      }),
    onSuccess: (res) => {
      setStatusMsg({ type: 'ok', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['adminGameConfig'] });
      queryClient.invalidateQueries({ queryKey: ['activeRound'] });
    },
    onError: (err: ApiError) => setStatusMsg({ type: 'err', text: err.message }),
  });

  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-slate-400">
        Loading round configuration...
      </div>
    );
  }

  if (isError || !cfgData) {
    return (
      <div className="bg-rose-950/60 border border-rose-800 rounded-xl p-5 text-rose-200 text-sm">
        Failed to load round configuration: {(error as Error)?.message ?? 'Check backend server logs.'}
      </div>
    );
  }

  const { activeRound } = cfgData;
  const isLocked = activeRound?.isLocked ?? false;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="font-semibold text-lg text-amber-400">Round Rules & Schedule Configuration</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {isLocked
              ? `Round #${activeRound?.id} is currently BETTING OPEN (locked). Changes saved below will apply to the NEXT round.`
              : `Round #${activeRound?.id} is in REGISTRATION OPEN. Saving applies immediately to this upcoming round and future defaults.`}
          </p>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${
            isLocked
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
              : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
          }`}
        >
          {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          {isLocked ? 'Active Round Locked — Configuring Next Round' : 'Upcoming Round Editable'}
        </span>
      </div>

      {statusMsg && (
        <div
          className={`px-4 py-3 rounded-lg text-sm flex items-center gap-2 border ${
            statusMsg.type === 'ok'
              ? 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/50 border-rose-800 text-rose-200'
          }`}
        >
          {statusMsg.type === 'ok' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
          {statusMsg.text}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
        className="space-y-4 text-sm"
      >
        {/* Start & End Times */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {isLocked ? 'Next Round Start (Local)' : 'Upcoming Round Start (Local)'}
            </label>
            <input
              type="datetime-local"
              value={nextOpensLocal}
              onChange={(e) => setNextOpensLocal(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {isLocked ? 'Next Round End (Local)' : 'Upcoming Round End (Local)'}
            </label>
            <input
              type="datetime-local"
              value={nextClosesLocal}
              onChange={(e) => setNextClosesLocal(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Default Daily Open (ET)</label>
            <input
              type="time"
              value={defaultOpenTime}
              onChange={(e) => setDefaultOpenTime(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Default Daily Close (ET)</label>
            <input
              type="time"
              value={defaultCloseTime}
              onChange={(e) => setDefaultCloseTime(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>
        </div>

        {/* Segment Length & Count Limits */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Min Segment Verses</label>
            <input
              type="number"
              min={1}
              max={31102}
              value={minSegmentLength}
              onChange={(e) => setMinSegmentLength(Number(e.target.value))}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Max Segment Verses</label>
            <input
              type="number"
              min={1}
              max={31102}
              value={maxSegmentLength}
              onChange={(e) => setMaxSegmentLength(Number(e.target.value))}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Min Segments / Slip</label>
            <input
              type="number"
              min={1}
              max={50}
              value={minSegments}
              onChange={(e) => setMinSegments(Number(e.target.value))}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Max Segments / Slip</label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxSegments}
              onChange={(e) => setMaxSegments(Number(e.target.value))}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Max Registered Players</label>
            <input
              type="number"
              min={1}
              placeholder="Unlimited"
              value={maxRegisteredPlayers}
              onChange={(e) => setMaxRegisteredPlayers(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-xs text-slate-400 mb-1">Min Stake / Verse (Shekels + Gerahs)</label>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  value={minStakeShekels}
                  onChange={(e) => setMinStakeShekels(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 pr-12 font-mono"
                />
                <span className="text-[11px] text-slate-500 absolute right-2.5 top-2.5">SHK</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={19}
                  value={minStakeGerahs}
                  onChange={(e) =>
                    setMinStakeGerahs(Math.min(19, Math.max(0, Math.floor(Number(e.target.value) || 0))))
                  }
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 pr-12 font-mono"
                />
                <span className="text-[11px] text-slate-500 absolute right-2.5 top-2.5">GRH</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold px-5 py-2.5 rounded-lg transition"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'Saving...' : isLocked ? 'Save Config for Next Round' : 'Update Upcoming Round Config'}
          </button>
        </div>
      </form>
    </div>
  );
}