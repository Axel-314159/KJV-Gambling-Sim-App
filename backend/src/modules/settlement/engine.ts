import { withTransaction } from '../../db/pool.js';
import type { PoolClient } from 'pg';

export interface JackpotAwardResult {
  awardedGerahs: bigint;
  remainingJackpotGerahs: bigint;
  winnerNewBalanceGerahs: bigint;
}

interface RawBet {
  id: string;
  user_id: string;
  start_verse_id: number;
  end_verse_id: number;
  verse_length: number;
  stake: number;
}

/**
 * Deducts the running jackpot (or a specific Gerah amount) from game_config,
 * records the negative debit in jackpot_ledger, and credits the winning user.
 */
export async function awardJackpot(
  tx: PoolClient,
  params: {
    userId: string;
    roundId?: number | null;
    betId?: string | null;
    /** Optional partial payout in Gerahs; defaults to 100% of current jackpot_balance */
    amountGerahs?: bigint;
  }
): Promise<JackpotAwardResult | null> {
  const { userId, roundId = null, betId = null, amountGerahs } = params;

  // 1. Lock the singleton config row to prevent concurrent jackpot race conditions
  const { rows: cfgRows } = await tx.query<{ jackpot_balance: string }>(
    `SELECT jackpot_balance FROM game_config WHERE id = 1 FOR UPDATE`
  );
  const currentJackpot = BigInt(cfgRows[0]?.jackpot_balance ?? 0);

  if (currentJackpot <= 0n) {
    return null;
  }

  const payout = amountGerahs !== undefined ? amountGerahs : currentJackpot;
  if (payout <= 0n || payout > currentJackpot) {
    throw new Error(`Invalid jackpot payout (${payout}) against balance (${currentJackpot}).`);
  }

  // 2. Subtract the payout from game_config.jackpot_balance
  const { rows: updatedCfg } = await tx.query<{ jackpot_balance: string }>(
    `UPDATE game_config
     SET jackpot_balance = jackpot_balance - $1, updated_at = NOW()
     WHERE id = 1 RETURNING jackpot_balance`,
    [payout.toString()]
  );
  const remainingJackpot = BigInt(updatedCfg[0].jackpot_balance);

  // 3. Record the negative deduction in jackpot_ledger
  await tx.query(
    `INSERT INTO jackpot_ledger (round_id, user_id, entry_type, amount, balance_after)
     VALUES ($1, $2, 'JACKPOT_PAYOUT', $3, $4)`,
    [roundId, userId, (-payout).toString(), remainingJackpot.toString()]
  );

  // 4. Credit the winner's wallet and record the matching entry in wallet_ledger
  const { rows: updatedUser } = await tx.query<{ wallet_balance: string }>(
    `UPDATE users
     SET wallet_balance = wallet_balance + $1
     WHERE id = $2
     RETURNING wallet_balance`,
    [payout.toString(), userId]
  );
  if (!updatedUser.length) {
    throw new Error(`Jackpot winner user ${userId} not found.`);
  }
  const winnerNewBalance = BigInt(updatedUser[0].wallet_balance);

  await tx.query(
    `INSERT INTO wallet_ledger (user_id, round_id, bet_id, entry_type, amount, balance_after)
     VALUES ($1, $2, $3, 'JACKPOT_WINNING', $4, $5)`,
    [userId, roundId, betId, payout.toString(), winnerNewBalance.toString()]
  );

  return {
    awardedGerahs: payout,
    remainingJackpotGerahs: remainingJackpot,
    winnerNewBalanceGerahs: winnerNewBalance,
  };
}


export async function settleRound(roundId: number) {
  await withTransaction(async (tx) => {
    const { rows: roundRows } = await tx.query(
      `SELECT id, status FROM rounds WHERE id = $1 FOR UPDATE`,
      [roundId]
    );
    if (!roundRows.length || roundRows[0].status === 'COMPLETED') return;

    await tx.query(`UPDATE rounds SET status = 'SETTLING' WHERE id = $1`, [roundId]);

    const { rows: bets } = await tx.query<RawBet>(
      `SELECT id, user_id, start_verse_id, end_verse_id, verse_length, stake
       FROM bets WHERE round_id = $1
       ORDER BY start_verse_id ASC, end_verse_id DESC`,
      [roundId]
    );

    if (bets.length === 0) {
      await tx.query(`UPDATE rounds SET status = 'COMPLETED' WHERE id = $1`, [roundId]);
      return;
    }

    // Phase A: O(N log N) Sweep-Line Collision Detection
    const collidedIds = new Set<string>();
    let maxEnd = -1;
    let maxEndBetId = '';

    for (const bet of bets) {
      if (bet.start_verse_id <= maxEnd) {
        collidedIds.add(bet.id);
        collidedIds.add(maxEndBetId);
      }
      if (bet.end_verse_id > maxEnd) {
        maxEnd = bet.end_verse_id;
        maxEndBetId = bet.id;
      }
    }

    const winners = bets.filter((b) => !collidedIds.has(b.id));

    /* Jackpot checking and Payout */
    const { rows: jackpotVerseIds } = await tx.query(`SELECT jackpot_start_verse_id, jackpot_end_verse_id FROM game_config WHERE id = 1`);
    const jackpotStartId = jackpotVerseIds[0];
    const jackpotEndId = jackpotVerseIds[1];
    
    for (const winner of winners) {
      if (
        winner.start_verse_id <= jackpotEndId && 
        winner.start_verse_id >= jackpotStartId &&
        winner.end_verse_id >= jackpotStartId &&
        winner.end_verse_id <= jackpotEndId
      ) {
        // Jackpot won by this player
        const jpWin = await awardJackpot(tx, {
          userId: winner.user_id,
          roundId,
          betId: winner.id
        });
      }
    }

    // Zero-Winner Branch: Refund all stakes
    if (winners.length === 0) {
      for (const bet of bets) {
        await tx.query(`UPDATE bets SET outcome = 'REFUNDED', payout = $1 WHERE id = $2`, [bet.stake, bet.id]);
        const { rows: uRows } = await tx.query(
          `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2 RETURNING wallet_balance`,
          [bet.stake, bet.user_id]
        );
        await tx.query(
          `INSERT INTO wallet_ledger (user_id, round_id, bet_id, entry_type, amount, balance_after)
           VALUES ($1, $2, $3, 'ROUND_NO_WINNER_REFUND', $4, $5)`,
          [bet.user_id, roundId, bet.id, bet.stake, uRows[0].wallet_balance]
        );
      }
      await tx.query(`UPDATE rounds SET status = 'COMPLETED' WHERE id = $1`, [roundId]);
      return;
    }

    // Mark collided bets
    if (collidedIds.size > 0) {
      await tx.query(
        `UPDATE bets SET outcome = 'COLLIDED', payout = 0 WHERE id = ANY($1::uuid[])`,
        [[...collidedIds]]
      );
    }

    // Phase B: Pluggable Formula v1 with Largest Remainder Integer Distribution
    // W_i = (B_i * L_i) / sum(B_j * L_j) * totalPot
    const totalPot = bets.reduce((acc, b) => acc + BigInt(b.stake), 0n);
    const weighted = winners.map((w) => ({
      bet: w,
      weight: BigInt(w.stake) * BigInt(w.verse_length),
    }));
    const totalWeight = weighted.reduce((acc, item) => acc + item.weight, 0n);

    const allocations = weighted.map((item) => {
      const numerator = totalPot * item.weight;
      const floorPayout = numerator / totalWeight;
      const remainder = numerator % totalWeight;
      return { bet: item.bet, payout: floorPayout, remainder };
    });

    // Compute proportional Gerah payouts (floored)
    const totalPaidOut = allocations.reduce((acc, alloc) => acc + alloc.payout, 0n);

    // Route fractional Gerah remainder into the running Jackpot
    const remainderGerahs = totalPot - totalPaidOut;
    if (remainderGerahs > 0n) {
      const { rows: jpRows } = await tx.query(
        `UPDATE game_config
          SET jackpot_balance = jackpot_balance + $1, updated_at = NOW()
          WHERE id = 1
          RETURNING jackpot_balance`,
        [Number(remainderGerahs)]
      );

      await tx.query(
        `INSERT INTO jackpot_ledger (round_id, entry_type, amount, balance_after)
          VALUES ($1, 'ROUND_DUST', $2, $3)`,
        [roundId, Number(remainderGerahs), Number(jpRows[0].jackpot_balance)]
      );
    }
    
    // distribute payouts to winners 
    for (const alloc of allocations) {
      const payoutNum = Number(alloc.payout);
      await tx.query(`UPDATE bets SET outcome = 'WON', payout = $1 WHERE id = $2`, [payoutNum, alloc.bet.id]);
      const { rows: uRows } = await tx.query(
        `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2 RETURNING wallet_balance`,
        [payoutNum, alloc.bet.user_id]
      );
      await tx.query(
        `INSERT INTO wallet_ledger (user_id, round_id, bet_id, entry_type, amount, balance_after)
         VALUES ($1, $2, $3, 'ROUND_WINNING', $4, $5)`,
        [alloc.bet.user_id, roundId, alloc.bet.id, payoutNum, uRows[0].wallet_balance]
      );
    }

    await tx.query(`UPDATE rounds SET status = 'COMPLETED' WHERE id = $1`, [roundId]);
  });
}