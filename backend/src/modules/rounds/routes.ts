import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, withTransaction } from '../../db/pool.js';
import { requireActivePlayer } from '../../plugins/auth.js';

const slipSchema = z.object({
  segments: z
    .array(
      z.object({
        startVerseId: z.number().int().min(1).max(31102),
        endVerseId: z.number().int().min(1).max(31102),
        stake: z.number().int().min(1),
      })
    )
    .min(1)
    .max(50),
});

export async function roundRoutes(app: FastifyInstance) {
  // 1. Get Current Active Round, Config Rules & Blind Player State
  app.get('/api/rounds/current', { preHandler: requireActivePlayer }, async (req, reply) => {
    const { rows: roundRows } = await pool.query(
      `SELECT id, round_date, status, registration_opens_at, betting_opens_at,
              betting_closes_at, registered_count, max_verses_per_player, total_pot,
              min_segment_length, max_segment_length, min_segments, max_segments,
              max_registered_players, min_stake_per_verse, start_book, end_book
       FROM rounds
       WHERE status IN ('REGISTRATION_OPEN', 'BETTING_OPEN', 'SETTLING')
       ORDER BY id DESC LIMIT 1`
    );

    if (!roundRows.length) {
      return reply.status(503).send({ code: 'NO_ACTIVE_ROUND', message: 'Round schedule initializing.' });
    }

    const r = roundRows[0];
    const userId = req.currentUser!.id;

    const { rows: regRows } = await pool.query(
      `SELECT submission_count FROM round_registrations WHERE round_id = $1 AND user_id = $2`,
      [r.id, userId]
    );

    const { rows: betRows } = await pool.query(
      `SELECT b.id, b.start_verse_id AS "startVerseId", b.end_verse_id AS "endVerseId",
              b.verse_length AS "verseLength", b.stake, b.outcome, b.payout,
              vs.book_name || ' ' || vs.chapter || ':' || vs.verse AS "startLabel",
              ve.book_name || ' ' || ve.chapter || ':' || ve.verse AS "endLabel"
       FROM bets b
       JOIN kjv_verses vs ON vs.verse_id = b.start_verse_id
       JOIN kjv_verses ve ON ve.verse_id = b.end_verse_id
       WHERE b.round_id = $1 AND b.user_id = $2
       ORDER BY b.start_verse_id ASC`,
      [r.id, userId]
    );

    const { rows: cfgRows } = await pool.query(`SELECT jackpot_balance FROM game_config WHERE id = 1`);

    return {
      serverTimeUtc: new Date().toISOString(),
      jackpotBalance: Number(cfgRows[0]?.jackpot_balance ?? 0),
      round: {
        id: r.id,
        roundDate: new Date(r.round_date).toISOString().slice(0, 10),
        status: r.status,
        registrationOpensAt: new Date(r.registration_opens_at).toISOString(),
        bettingOpensAt: new Date(r.betting_opens_at).toISOString(),
        bettingClosesAt: new Date(r.betting_closes_at).toISOString(),
        registeredCount: r.registered_count,
        maxVersesPerPlayer: r.max_verses_per_player,
        totalPot: r.total_pot,
        minSegmentLength: r.min_segment_length,
        maxSegmentLength: r.max_segment_length,
        minSegments: r.min_segments,
        maxSegments: r.max_segments,
        maxRegisteredPlayers: r.max_registered_players,
        minStakePerVerse: r.min_stake_per_verse,
        startBook: r.start_book,
        endBook: r.end_book
      },
      playerState: {
        isRegistered: regRows.length > 0,
        submissionCount: regRows.length > 0 ? regRows[0].submission_count : 0,
        activeBets: betRows,
      },
    };
  });

  // 2. Register for Upcoming Round (Enforces max_registered_players)
  app.post('/api/rounds/current/register', { preHandler: requireActivePlayer }, async (req, reply) => {
    const userId = req.currentUser!.id;

    const result = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, status, betting_opens_at, registered_count, max_registered_players
         FROM rounds WHERE status = 'REGISTRATION_OPEN' ORDER BY id DESC LIMIT 1 FOR UPDATE`
      );
      if (!rows.length || new Date() >= new Date(rows[0].betting_opens_at)) {
        return { ok: false, code: 'REGISTRATION_CLOSED', message: 'Registration window is closed.' };
      }

      const round = rows[0];
      if (round.max_registered_players !== null && round.registered_count >= round.max_registered_players) {
        return {
          ok: false,
          code: 'REGISTRATION_FULL',
          message: `Maximum player limit (${round.max_registered_players}) reached for this round.`,
        };
      }

      const insertRes = await tx.query(
        `INSERT INTO round_registrations (round_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [round.id, userId]
      );

      if (insertRes.rowCount && insertRes.rowCount > 0) {
        await tx.query(`UPDATE rounds SET registered_count = registered_count + 1 WHERE id = $1`, [round.id]);
      }
      return { ok: true };
    });

    if (!result.ok) {
      return reply.status(400).send({ code: result.code, message: result.message });
    }
    return { message: 'Registered for upcoming round.' };
  });

  // 3. Submit Initial Bet Slip (0 -> 1) or One-Time Revision (1 -> 2)
  app.put('/api/rounds/current/slip', { preHandler: requireActivePlayer }, async (req, reply) => {
    const { segments } = slipSchema.parse(req.body);
    const userId = req.currentUser!.id;

    const sorted = [...segments].sort((a, b) => a.startVerseId - b.startVerseId);
    // segment validation loop
    for (let i = 0; i < sorted.length; i++) {

      if (sorted[i].stake % 20 !== 0) {
        throw Object.assign(
          new Error('Wagers must be placed in whole Shekels.'),
          { statusCode: 400, code: 'WHOLE_SHEKELS_ONLY' }
        );
      }

      if (sorted[i].endVerseId < sorted[i].startVerseId) {
        return reply.status(400).send({ code: 'INVALID_RANGE', message: 'End verse must be >= start verse.' });
      }
      if (i > 0 && sorted[i].startVerseId <= sorted[i - 1].endVerseId) {
        return reply.status(400).send({ code: 'SELF_OVERLAP', message: 'Your own segments cannot overlap.' });
      }
    }

    try {
      await withTransaction(async (tx) => {
        const { rows: userRows } = await tx.query(
          `SELECT wallet_balance, max_bet_override FROM users WHERE id = $1 FOR UPDATE`,
          [userId]
        );
        const user = userRows[0];

        const { rows: roundRows } = await tx.query(
          `SELECT id, status, betting_closes_at, max_verses_per_player,
                  min_segment_length, max_segment_length, min_segments, max_segments, min_stake_per_verse
           FROM rounds WHERE status = 'BETTING_OPEN' ORDER BY id DESC LIMIT 1 FOR UPDATE`
        );
        if (!roundRows.length || new Date() >= new Date(roundRows[0].betting_closes_at)) {
          throw Object.assign(new Error('Betting is currently closed.'), { statusCode: 400, code: 'BETTING_CLOSED' });
        }
        const round = roundRows[0];

        // Enforce dynamic segment count bounds
        if (sorted.length < round.min_segments || sorted.length > round.max_segments) {
          throw Object.assign(
            new Error(`You must submit between ${round.min_segments} and ${round.max_segments} segments.`),
            { statusCode: 400, code: 'INVALID_SEGMENT_COUNT' }
          );
        }

        // Enforce dynamic segment lengths, minimum stake per verse, and total verse budget
        let totalVerses = 0;
        for (const seg of sorted) {
          const len = seg.endVerseId - seg.startVerseId + 1;
          if (len < round.min_segment_length || len > round.max_segment_length) {
            throw Object.assign(
              new Error(`Each segment must be ${round.min_segment_length} to ${round.max_segment_length} verses.`),
              { statusCode: 400, code: 'INVALID_LENGTH' }
            );
          }
          const minRequiredStake = len * round.min_stake_per_verse;
          if (seg.stake < minRequiredStake) {
            throw Object.assign(
              new Error(
                `A ${len}-verse segment requires a minimum stake of ${minRequiredStake} Shekels (${round.min_stake_per_verse}/verse).`
              ),
              { statusCode: 400, code: 'STAKE_BELOW_MINIMUM' }
            );
          }
          totalVerses += len;
        }

        if (totalVerses > round.max_verses_per_player) {
          throw Object.assign(
            new Error(`Total verses (${totalVerses}) exceeds round limit (${round.max_verses_per_player}).`),
            { statusCode: 400, code: 'VERSE_CAP_EXCEEDED' }
          );
        }

        const { rows: regRows } = await tx.query(
          `SELECT submission_count FROM round_registrations
           WHERE round_id = $1 AND user_id = $2 FOR UPDATE`,
          [round.id, userId]
        );
        if (!regRows.length) {
          throw Object.assign(new Error('You are not registered for this round.'), { statusCode: 403, code: 'NOT_REGISTERED' });
        }
        const submissionCount = regRows[0].submission_count;
        if (submissionCount >= 2) {
          throw Object.assign(new Error('You have already used your 1 allowed edit.'), { statusCode: 403, code: 'MAX_EDITS_REACHED' });
        }

        let workingBalance = BigInt(user.wallet_balance);
        let potDelta = 0n;

        if (submissionCount === 1) {
          const { rows: prevRows } = await tx.query(
            `SELECT COALESCE(SUM(stake), 0) AS prev_total FROM bets WHERE round_id = $1 AND user_id = $2`,
            [round.id, userId]
          );
          const refund = BigInt(prevRows[0].prev_total);
          if (refund > 0n) {
            workingBalance += refund;
            potDelta -= refund;
            await tx.query(`DELETE FROM bets WHERE round_id = $1 AND user_id = $2`, [round.id, userId]);
            await tx.query(
              `INSERT INTO wallet_ledger (user_id, round_id, entry_type, amount, balance_after)
               VALUES ($1, $2, 'SLIP_EDIT_REFUND', $3, $4)`,
              [userId, round.id, Number(refund), Number(workingBalance)]
            );
          }
        }

        const newTotalStake = segments.reduce((acc, s) => acc + BigInt(s.stake), 0n);
        if (user.max_bet_override && newTotalStake > BigInt(user.max_bet_override)) {
          throw Object.assign(new Error('Exceeds admin bet limit.'), { statusCode: 403, code: 'ADMIN_BET_LIMIT' });
        }
        if (newTotalStake > workingBalance) {
          throw Object.assign(new Error('Insufficient Shekels.'), { statusCode: 400, code: 'INSUFFICIENT_FUNDS' });
        }

        for (const seg of sorted) {
          const stakeBig = BigInt(seg.stake);
          workingBalance -= stakeBig;
          potDelta += stakeBig;

          const { rows: insertedBet } = await tx.query(
            `INSERT INTO bets (round_id, user_id, start_verse_id, end_verse_id, stake)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [round.id, userId, seg.startVerseId, seg.endVerseId, seg.stake]
          );

          await tx.query(
            `INSERT INTO wallet_ledger (user_id, round_id, bet_id, entry_type, amount, balance_after)
             VALUES ($1, $2, $3, 'SLIP_STAKE', $4, $5)`,
            [userId, round.id, insertedBet[0].id, -seg.stake, Number(workingBalance)]
          );
        }

        await tx.query(`UPDATE users SET wallet_balance = $1 WHERE id = $2`, [Number(workingBalance), userId]);
        await tx.query(`UPDATE rounds SET total_pot = total_pot + $1 WHERE id = $2`, [Number(potDelta), round.id]);
        await tx.query(
          `UPDATE round_registrations
           SET submission_count = submission_count + 1, last_submitted_at = NOW()
           WHERE round_id = $1 AND user_id = $2`,
          [round.id, userId]
        );
      });

      return { message: 'Bet slip submitted.' };
    } catch (err: any) {
      if (err.statusCode) {
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }
      throw err;
    }
  });
}