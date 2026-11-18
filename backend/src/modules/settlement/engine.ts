import { withTransaction } from '../../db/pool.js';

interface RawBet {
  id: string;
  user_id: string;
  start_verse_id: number;
  end_verse_id: number;
  verse_length: number;
  stake: number;
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