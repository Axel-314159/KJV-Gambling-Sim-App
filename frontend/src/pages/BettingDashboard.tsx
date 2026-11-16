import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, CheckCircle2, Lock, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import type { ActiveRoundState, BetSegment, KjvVerse, UserProfile, AutoSelectRequest } from '../types/api';
import { useServerCountdown } from '../hooks/useServerClock';
import { KjvExplorer } from '../components/KjvExplorer';

export function BettingDashboard({ user: _user }: { user: UserProfile }) {
  const queryClient = useQueryClient();
  const [draftSegments, setDraftSegments] = useState<BetSegment[]>([]);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const { data: state, isLoading } = useQuery<ActiveRoundState>({
    queryKey: ['activeRound'],
    queryFn: () => apiFetch<ActiveRoundState>('/rounds/current'),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (state?.playerState.activeBets.length) {
      setDraftSegments(state.playerState.activeBets);
    }
  }, [state?.playerState.activeBets]);

  const targetDeadline =
    state?.round.status === 'REGISTRATION_OPEN'
      ? state.round.bettingOpensAt
      : state?.round.bettingClosesAt;

  const countdown = useServerCountdown(state?.serverTimeUtc, targetDeadline);

  const registerMutation = useMutation({
    mutationFn: () => apiFetch('/rounds/current/register', { method: 'POST' }),
    onSuccess: () => {
      setFeedbackError(null);
      queryClient.invalidateQueries({ queryKey: ['activeRound'] });
    },
    onError: (err: ApiError) => setFeedbackError(err.message),
  });

  const submitSlipMutation = useMutation({
    mutationFn: (segments: BetSegment[]) =>
      apiFetch('/rounds/current/slip', {
        method: 'PUT',
        body: JSON.stringify({
          segments: segments.map((s) => ({
            startVerseId: s.startVerseId,
            endVerseId: s.endVerseId,
            stake: s.stake,
          })),
        }),
      }),
    onSuccess: () => {
      setFeedbackError(null);
      queryClient.invalidateQueries({ queryKey: ['activeRound'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err: ApiError) => setFeedbackError(err.message),
  });

  const autoSelectMutation = useMutation({
    mutationFn: (payload: AutoSelectRequest) =>
      apiFetch<BetSegment[]>('/kjv/auto-select', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (generated) => {
      setDraftSegments(generated);
      setFeedbackError(null);
    },
    onError: (err: ApiError) => setFeedbackError(err.message),
  });

  if (isLoading || !state) {
    return <div className="text-slate-400">Loading round schedule...</div>;
  }

  const { round, playerState } = state;
  const isBettingOpen = round.status === 'BETTING_OPEN';
  const isSlipLocked = playerState.submissionCount >= 2 || !isBettingOpen || !playerState.isRegistered;
  const isRegistrationFull =
    round.maxRegisteredPlayers !== null && round.registeredCount >= round.maxRegisteredPlayers;

  const totalDraftVerses = draftSegments.reduce((sum, s) => sum + s.verseLength, 0);
  const totalDraftStake = draftSegments.reduce((sum, s) => sum + (Number(s.stake) || 0), 0);
  const maxVerses = round.maxVersesPerPlayer ?? 500;

  const hasInvalidStake = draftSegments.some(
    (s) => (Number(s.stake) || 0) < s.verseLength * round.minStakePerVerse
  );
  const isSegmentCountValid =
    draftSegments.length >= round.minSegments && draftSegments.length <= round.maxSegments;

  const handleAddSegment = (first: KjvVerse, second: KjvVerse) => {
    const startVerse = first.verseId <= second.verseId ? first : second;
    const endVerse = first.verseId <= second.verseId ? second : first;
    const length = endVerse.verseId - startVerse.verseId + 1;

    if (length < round.minSegmentLength || length > round.maxSegmentLength) {
      setFeedbackError(
        `Each segment must be between ${round.minSegmentLength} and ${round.maxSegmentLength} verses inclusive.`
      );
      return;
    }
    if (draftSegments.length >= round.maxSegments) {
      setFeedbackError(`Maximum of ${round.maxSegments} discrete segments allowed per round.`);
      return;
    }
    const overlapsSelf = draftSegments.some(
      (s) => startVerse.verseId <= s.endVerseId && endVerse.verseId >= s.startVerseId
    );
    if (overlapsSelf) {
      setFeedbackError('This range overlaps with one of your existing segments.');
      return;
    }

    setFeedbackError(null);
    setDraftSegments([
      ...draftSegments,
      {
        startVerseId: startVerse.verseId,
        endVerseId: endVerse.verseId,
        startLabel: `${startVerse.bookName} ${startVerse.chapter}:${startVerse.verse}`,
        endLabel: `${endVerse.bookName} ${endVerse.chapter}:${endVerse.verse}`,
        verseLength: length,
        stake: length * round.minStakePerVerse,
      },
    ]);
  };

  return (
    <div className="space-y-6">
      {/* 1. Round Schedule & Status Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-amber-500/20 text-amber-300">
              {round.status.replace('_', ' ')}
            </span>
            <span className="text-sm text-slate-400">Round Date: {round.roundDate}</span>
          </div>
          <h1 className="text-xl font-semibold mt-2">
            {round.status === 'REGISTRATION_OPEN'
              ? 'Registration Open for Upcoming Round'
              : round.status === 'BETTING_OPEN'
              ? 'Blind Betting Window Active'
              : 'Round Settling'}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Registered Players (M):{' '}
            <strong className="text-slate-200">
              {round.registeredCount}
              {round.maxRegisteredPlayers !== null ? ` / ${round.maxRegisteredPlayers}` : ''}
            </strong>
            {round.maxVersesPerPlayer && (
              <>
                {' '}• Verse Budget: <strong className="text-amber-300">{round.maxVersesPerPlayer} verses</strong>
              </>
            )}
            {' '}• Min Stake: <strong className="text-slate-200">{round.minStakePerVerse} SHK/verse</strong>
          </p>
        </div>

        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-slate-400">
            {round.status === 'REGISTRATION_OPEN' ? 'Betting Opens In' : 'Betting Closes In'}
          </div>
          <div className="text-3xl font-mono font-bold text-amber-400">{countdown.formatted}</div>

          {round.status === 'REGISTRATION_OPEN' && (
            <div className="mt-3">
              {playerState.isRegistered ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400 font-medium">
                  <CheckCircle2 className="w-4 h-4" /> Registered for Tomorrow
                </span>
              ) : isRegistrationFull ? (
                <span className="text-xs text-rose-400 font-medium">
                  Round Full ({round.maxRegisteredPlayers} players max)
                </span>
              ) : (
                <button
                  onClick={() => registerMutation.mutate()}
                  disabled={registerMutation.isPending}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm transition"
                >
                  {registerMutation.isPending ? 'Registering...' : 'Register for Next Round'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {feedbackError && (
        <div className="bg-rose-950/60 border border-rose-800 text-rose-200 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          {feedbackError}
        </div>
      )}

      {/* 2. Main Split Workspace: KJV Navigator (Left) + Bet Slip (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          <KjvExplorer
            isSlipLocked={isSlipLocked}
            maxVerses={maxVerses}
            minSegmentLength={round.minSegmentLength}
            maxSegmentLength={round.maxSegmentLength}
            minSegments={round.minSegments}
            maxSegments={round.maxSegments}
            onAddSegment={handleAddSegment}
            onAutoSelect={(req) => autoSelectMutation.mutate(req)}
            isAutoSelecting={autoSelectMutation.isPending}
          />
        </div>

        {/* Right: Bet Slip & 1-Edit Enforcement */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="font-semibold text-lg">Your Round Slip</h2>
              <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300">
                {playerState.submissionCount === 0 && 'Initial Submission'}
                {playerState.submissionCount === 1 && '1 Edit Remaining'}
                {playerState.submissionCount === 2 && 'Locked (Final Slip)'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div>
                <span className="text-slate-400">
                  Segments ({round.minSegments}–{round.maxSegments} req)
                </span>
                <div
                  className={`text-base font-mono font-semibold ${
                    draftSegments.length > 0 && !isSegmentCountValid ? 'text-rose-400' : 'text-slate-100'
                  }`}
                >
                  {draftSegments.length} / {round.maxSegments}
                </div>
              </div>
              <div>
                <span className="text-slate-400">Total Verses</span>
                <div
                  className={`text-base font-mono font-semibold ${
                    totalDraftVerses > maxVerses ? 'text-rose-400' : 'text-slate-100'
                  }`}
                >
                  {totalDraftVerses} / {maxVerses}
                </div>
              </div>
            </div>

            {draftSegments.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-800 rounded-lg">
                No segments staged yet. Pick {round.minSegments}–{round.maxSegments} ranges ({round.minSegmentLength}–{round.maxSegmentLength} verses each) from the KJV navigator or use Auto-Select.
              </div>
            ) : (
              <div className="space-y-2.5">
                {draftSegments.map((seg, idx) => {
                  const minSegStake = seg.verseLength * round.minStakePerVerse;
                  const isSegStakeTooLow = (Number(seg.stake) || 0) < minSegStake;

                  return (
                    <div
                      key={`${seg.startVerseId}-${seg.endVerseId}`}
                      className={`bg-slate-950 border rounded-lg p-3 flex items-center justify-between gap-3 ${
                        isSegStakeTooLow ? 'border-rose-700' : 'border-slate-800'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-medium text-amber-300">
                          {seg.startLabel ?? `#${seg.startVerseId}`} → {seg.endLabel ?? `#${seg.endVerseId}`}
                        </div>
                        <div className="text-xs text-slate-400">
                          {seg.verseLength} verses • min {minSegStake} SHK
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={minSegStake}
                          disabled={isSlipLocked}
                          value={seg.stake}
                          onChange={(e) => {
                            const val = Math.max(1, parseInt(e.target.value, 10) || 0);
                            setDraftSegments(draftSegments.map((s, i) => (i === idx ? { ...s, stake: val } : s)));
                          }}
                          className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-right font-mono text-sm"
                        />
                        <span className="text-xs text-slate-400">SHK</span>
                        {!isSlipLocked && (
                          <button
                            onClick={() => setDraftSegments(draftSegments.filter((_, i) => i !== idx))}
                            className="text-slate-500 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-slate-800 pt-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Total Slip Wager</span>
              <span className="font-mono font-bold text-amber-300">{totalDraftStake.toLocaleString()} Shekels</span>
            </div>

            {!playerState.isRegistered && isBettingOpen ? (
              <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/60 p-3 rounded-lg">
                You did not register before betting opened for today&apos;s round. Registration for the next round opens after settlement.
              </div>
            ) : playerState.submissionCount >= 2 ? (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-400 bg-slate-950 py-3 rounded-lg border border-slate-800">
                <Lock className="w-4 h-4" /> Final slip submitted. Awaiting settlement.
              </div>
            ) : (
              <button
                onClick={() => submitSlipMutation.mutate(draftSegments)}
                disabled={
                  isSlipLocked ||
                  !isSegmentCountValid ||
                  hasInvalidStake ||
                  totalDraftVerses > maxVerses ||
                  submitSlipMutation.isPending
                }
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold py-2.5 rounded-lg transition"
              >
                {submitSlipMutation.isPending
                  ? 'Submitting...'
                  : playerState.submissionCount === 0
                  ? 'Submit Initial Bet Slip'
                  : 'Submit Revised Slip (Uses Final Edit)'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}