import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, CheckCircle2, Lock, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import type { ActiveRoundState, BetSegment, KjvVerse, KjvBookMeta, UserProfile, AutoSelectRequest } from '../types/api';
import { useServerCountdown } from '../hooks/useServerClock';
import { KjvExplorer } from '../components/KjvExplorer';
import { GERAHS_PER_SHEKEL, formatCurrency, toGerahs } from '../lib/currency';
import { getBookRangeSummary } from '../lib/kjvBooks';

export function BettingDashboard({ user }: { user: UserProfile }) {
  const queryClient = useQueryClient();
  const [draftSegments, setDraftSegments] = useState<BetSegment[]>([]);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [bulkWagerShekels, setBulkWagerShekels] = useState<string>('');

  /* get round state */
  const { data: state, isLoading } = useQuery<ActiveRoundState>({
    queryKey: ['activeRound'],
    queryFn: () => apiFetch<ActiveRoundState>('/rounds/current'),
    refetchInterval: 15_000,
  });

  /* Get books meta */
  const {
    data: books,
    isLoading: isLoadingBooks,
    isError: _isBooksError,
    error: _booksError,
  } = useQuery<KjvBookMeta[]>({
    queryKey: ['kjvBooks'],
    queryFn: () => apiFetch<KjvBookMeta[]>('/kjv/books'),
    staleTime: Infinity,
  });

  // const verseCount = 
  const round = state?.round;
  const playerState = state?.playerState;
  const bookPool = getBookRangeSummary(round?.startBook, round?.endBook);
  const submissionCount = playerState?.submissionCount ?? 0;
  const draftStorageKey = round && user ? `kjv_draft_slip_${round.id}_${user.id}` : null;

  const hasHydratedActiveBets = useRef(false);

  // 1. Hydrate from server if the player already submitted an initial slip (for their 1 edit)
  useEffect(() => {
    if (
      !hasHydratedActiveBets.current &&
      playerState?.activeBets &&
      playerState.activeBets.length > 0
    ) {
      setDraftSegments(playerState.activeBets);
      hasHydratedActiveBets.current = true;
    }
  }, [playerState?.activeBets]);

  // 2. Restore saved pre-submission draft when the round loads
  useEffect(() => {
    if (!draftStorageKey || submissionCount > 0) return;
    const saved = localStorage.getItem(draftStorageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setDraftSegments(parsed);
        }
      } catch {
        localStorage.removeItem(draftStorageKey);
      }
    }
  }, [draftStorageKey, submissionCount]);

  // 3. Save draft changes locally whenever the player edits segments before submitting
  useEffect(() => {
    if (!draftStorageKey || submissionCount > 0) return;
    if (draftSegments.length > 0) {
      localStorage.setItem(draftStorageKey, JSON.stringify(draftSegments));
    } else {
      localStorage.removeItem(draftStorageKey);
    }
  }, [draftSegments, draftStorageKey, submissionCount]);

  const targetDeadline =
    round?.status === 'REGISTRATION_OPEN'
      ? round.bettingOpensAt
      : round?.bettingClosesAt;

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
      if (draftStorageKey) {
        localStorage.removeItem(draftStorageKey);
      }
      setFeedbackError(null);
      queryClient.invalidateQueries({ queryKey: ['activeRound'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      hasHydratedActiveBets.current = false;
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

  // Early return sits AFTER all hooks
  if (isLoading || !state || !round || !playerState) {
    return <div className="text-slate-400">Loading round schedule...</div>;
  }

  const isPreBetting = round.status === 'REGISTRATION_OPEN';
  const isBettingOpen = round.status === 'BETTING_OPEN';
  const hasEditsRemaining = submissionCount < 2;
  const canEditDraft = (isPreBetting || isBettingOpen) && hasEditsRemaining;

  const totalDraftVerses = draftSegments.reduce((sum, s) => sum + s.verseLength, 0);
  const totalDraftStake = draftSegments.reduce((sum, s) => sum + (Number(s.stake) || 0), 0);
  const maxVerses = round.maxVersesPerPlayer ?? 500;
  const committedStake = (playerState.activeBets ?? []).reduce(
    (sum, b) => sum + (Number(b.stake) || 0),
    0
  );
  const availableGerahs = user.walletBalance + committedStake;

  const hasInvalidStake = draftSegments.some((s) => {
    const minSegShekels = Math.max(
      1,
      Math.ceil((s.verseLength * round.minStakePerVerse) / GERAHS_PER_SHEKEL)
    );
    return (Number(s.stake) || 0) < toGerahs(minSegShekels, 0);
  });

  const isSegmentCountValid = draftSegments.length >= round.minSegments && draftSegments.length <= round.maxSegments;
  const isVerseBudgetValid = round.maxVersesPerPlayer === null || totalDraftVerses <= round.maxVersesPerPlayer;
  const isBalanceValid = totalDraftStake <= availableGerahs;

  const canSubmitSlip =
    isBettingOpen &&
    Boolean(playerState.isRegistered) &&
    hasEditsRemaining &&
    isSegmentCountValid &&
    !hasInvalidStake &&
    isVerseBudgetValid &&
    isBalanceValid;
    const isRegistrationFull =
    round.maxRegisteredPlayers !== null && round.registeredCount >= round.maxRegisteredPlayers;

  const submitDisabledReason = isPreBetting
    ? `Betting Opens at ${new Date(round.bettingOpensAt).toLocaleTimeString()}`
    : !playerState.isRegistered
    ? 'Register for Round to Submit'
    : !hasEditsRemaining
    ? 'Maximum Slip Submissions Reached'
    : draftSegments.length < round.minSegments
    ? `Select at Least ${round.minSegments} Segment${round.minSegments === 1 ? '' : 's'}`
    : draftSegments.length > round.maxSegments
    ? `Maximum ${round.maxSegments} Segments Allowed`
    : !isVerseBudgetValid
    ? `Exceeds ${round.maxVersesPerPlayer}-Verse Budget`
    : hasInvalidStake
    ? 'Segment Stake Below Minimum'
    : !isBalanceValid
    ? `Insufficient Balance (Max ${formatCurrency(availableGerahs)})`
    : null;

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
    if (round.maxVersesPerPlayer !== null && totalDraftVerses + length > round.maxVersesPerPlayer) {
      setFeedbackError(`Adding this segment exceeds your ${round.maxVersesPerPlayer}-verse budget.`);
      return;
    }

    const minSegGerahs = length * round.minStakePerVerse;
    const defaultShekels = Math.max(1, Math.ceil(minSegGerahs / GERAHS_PER_SHEKEL));

    setFeedbackError(null);
    setDraftSegments([
      ...draftSegments,
      {
        startVerseId: startVerse.verseId,
        endVerseId: endVerse.verseId,
        startLabel: `${startVerse.bookName} ${startVerse.chapter}:${startVerse.verse}`,
        endLabel: `${endVerse.bookName} ${endVerse.chapter}:${endVerse.verse}`,
        verseLength: length,
        stake: toGerahs(defaultShekels, 0),
      },
    ]);
  };

  const totalMinSlipShekels = draftSegments.reduce( (sum, seg) =>
    sum + Math.max(1, Math.ceil((seg.verseLength * round.minStakePerVerse) / GERAHS_PER_SHEKEL)), 0 );

  const handleDistributeShekels = () => {
    if (!canEditDraft || draftSegments.length === 0) return;

    const targetTotal = Math.floor(Number(bulkWagerShekels) || 0);
    if (targetTotal < totalMinSlipShekels) {
      setFeedbackError(
        `Total wager must be at least ${totalMinSlipShekels} Shekels to cover minimum stakes across all selected segments.`
      );
      return;
    }

    // 1. Guarantee each segment's minimum whole-Shekel stake first
    const minPerSegment = draftSegments.map((seg) =>
      Math.max(1, Math.ceil((seg.verseLength * round.minStakePerVerse) / GERAHS_PER_SHEKEL))
    );
    const surplus = targetTotal - totalMinSlipShekels;
    const totalVerses = draftSegments.reduce((sum, s) => sum + s.verseLength, 0);

    // 2. Distribute remaining Shekels proportionally by verseLength (largest-remainder method)
    const allocations = draftSegments.map((seg, idx) => {
      const exactBonus =
        totalVerses > 0
          ? (surplus * seg.verseLength) / totalVerses
          : surplus / draftSegments.length;
      const flooredBonus = Math.floor(exactBonus);
      return {
        idx,
        shekels: minPerSegment[idx] + flooredBonus,
        remainder: exactBonus - flooredBonus,
      };
    });

    const allocatedSum = allocations.reduce((sum, a) => sum + a.shekels, 0);
    const leftover = targetTotal - allocatedSum;

    const byRemainder = [...allocations].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < leftover; i++) {
      byRemainder[i % byRemainder.length].shekels += 1;
    }

    const finalByIdx = new Map(allocations.map((a) => [a.idx, a.shekels]));

    setFeedbackError(null);
    setDraftSegments(
      draftSegments.map((seg, idx) => ({
        ...seg,
        stake: toGerahs(finalByIdx.get(idx) ?? minPerSegment[idx], 0),
      }))
    );
  };

  const startBookName = books?.find((b) => b.bookNumber === state?.round.startBook)?.bookName;
  const endBookName = books?.find((b) => b.bookNumber === state?.round.endBook)?.bookName;

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
            {' '}• Min Stake: <strong className="text-slate-200">{formatCurrency(round.minStakePerVerse)}</strong>
            {' '}• Running Jackpot: <strong className="text-emerald-300">{formatCurrency(state.jackpotBalance)}</strong>
          </p>
          <p className="text-sm text-slate-400 mt-1">
            <strong className="text-slate-400">Book Range:</strong> [&nbsp;
              {isLoadingBooks ? 'Loading books...' : <strong className="text-amber-300">{startBookName}</strong>}
              &nbsp;&ndash;&nbsp;
              {isLoadingBooks ? 'Loading books...' : <strong className="text-amber-300">{endBookName}</strong>}
            &nbsp;]
            {' '}• <span className="text-slate-200">({bookPool.availableVerses} verses)</span>
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
                  <CheckCircle2 className="w-4 h-4" /> Registered for Upcoming Round
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
            isSlipLocked={!canEditDraft}
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
                {submissionCount === 0 && 'Initial Submission'}
                {submissionCount === 1 && '1 Edit Remaining'}
                {submissionCount === 2 && 'Locked (Final Slip)'}
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
            
            {/* Bulk wager distribution section */}
            {draftSegments.length > 0 && canEditDraft && (
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="bulk-wager-input" className="text-slate-400 font-medium">
                    Distribute Total Wager
                  </label>
                  <span className="text-slate-500">Min {totalMinSlipShekels} SHK</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="bulk-wager-input"
                    type="number"
                    min={totalMinSlipShekels}
                    step={1}
                    placeholder={`${totalMinSlipShekels}`}
                    value={bulkWagerShekels}
                    onChange={(e) => setBulkWagerShekels(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleDistributeShekels();
                      }
                    }}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-right font-mono text-sm text-slate-100"
                  />
                  <span className="text-xs text-slate-400">Shekels</span>
                  <button
                    type="button"
                    onClick={handleDistributeShekels}
                    disabled={!bulkWagerShekels || Math.floor(Number(bulkWagerShekels)) < totalMinSlipShekels}
                    className="bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-xs px-3 py-2 rounded transition"
                  >
                    Distribute
                  </button>
                </div>
              </div>
            )}

            {/* Segments list */}
            {draftSegments.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-800 rounded-lg">
                No segments staged yet. Pick {round.minSegments}–{round.maxSegments} ranges ({round.minSegmentLength}–{round.maxSegmentLength} verses each) from the KJV navigator or use Auto-Select.
              </div>
            ) : (
              <div className="space-y-2.5">
                {draftSegments.map((seg, idx) => {
                  const minSegGerahs = seg.verseLength * round.minStakePerVerse;
                  const minSegShekels = Math.max(1, Math.ceil(minSegGerahs / GERAHS_PER_SHEKEL));
                  const currentShekels = Math.floor((Number(seg.stake) || 0) / GERAHS_PER_SHEKEL);
                  const isSegStakeTooLow = (Number(seg.stake) || 0) < toGerahs(minSegShekels, 0);

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
                          {seg.verseLength} verses • min {minSegShekels} SHK
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={minSegShekels}
                          step={1}
                          disabled={!canEditDraft}
                          placeholder={String(minSegShekels)}
                          value={currentShekels === 0 ? '' : currentShekels}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === '') {
                              setDraftSegments(
                                draftSegments.map((s, i) => (i === idx ? { ...s, stake: 0 } : s))
                              );
                              return;
                            }
                            const wholeShekels = Math.max(0, Math.floor(Number(raw) || 0));
                            setDraftSegments(
                              draftSegments.map((s, i) =>
                                i === idx ? { ...s, stake: toGerahs(wholeShekels, 0) } : s
                              )
                            );
                          }}
                          className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-right font-mono text-sm"
                        />
                        <span className="text-xs text-slate-400">Shekels</span>
                        {canEditDraft && (
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
              <span className="font-mono font-bold text-amber-300">{formatCurrency(totalDraftStake)}</span>
            </div>

            {isPreBetting && (
              <div className="bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs rounded-lg px-3 py-2">
                Betting has not opened yet. You can build your slip now; your final verse budget will be
                calculated once registration closes at{' '}
                <strong>{new Date(round.bettingOpensAt).toLocaleTimeString()}</strong>.
              </div>
            )}

            {!playerState.isRegistered && isBettingOpen ? (
              <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/60 p-3 rounded-lg">
                You did not register before betting opened for today&apos;s round. Registration for the next round opens after settlement.
              </div>
            ) : submissionCount >= 2 ? (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-400 bg-slate-950 py-3 rounded-lg border border-slate-800">
                <Lock className="w-4 h-4" /> Final slip submitted. Awaiting settlement.
              </div>
            ) : (
              <button
                type="button"
                onClick={() => submitSlipMutation.mutate(draftSegments)}
                disabled={!canSubmitSlip || submitSlipMutation.isPending}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold py-2.5 rounded-lg transition"
              >
                {submitSlipMutation.isPending
                  ? 'Submitting Slip...'
                  : submitDisabledReason ?? (submissionCount === 1 ? 'Submit Edited Slip' : 'Submit Bet Slip')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}