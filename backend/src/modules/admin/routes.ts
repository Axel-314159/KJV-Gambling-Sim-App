import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, withTransaction } from '../../db/pool.js';
import { requireRole } from '../../plugins/auth.js';
import { processRoundLifecycleTick } from '../../jobs/scheduler.js';

const configUpdateSchema = z
  .object({
    defaultOpenTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    defaultCloseTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    minSegmentLength: z.number().int().min(1).max(31102),
    maxSegmentLength: z.number().int().min(1).max(31102),
    minSegments: z.number().int().min(1).max(50),
    maxSegments: z.number().int().min(1).max(50),
    maxRegisteredPlayers: z.number().int().min(1).nullable(),
    minStakePerVerse: z.number().int().min(1),
    nextBettingOpensAt: z.string().datetime().nullable().optional(),
    nextBettingClosesAt: z.string().datetime().nullable().optional(),
  })
  .refine((d) => d.minSegmentLength <= d.maxSegmentLength, {
    message: 'Min segment length cannot exceed max segment length.',
  })
  .refine((d) => d.minSegments <= d.maxSegments, {
    message: 'Min segments cannot exceed max segments.',
  });


const jackpotUpdateSchema = z
  .object({
    jackpotStartVerseId: z.number().int(),
    jackpotEndVerseId: z.number().int()
  });


export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', { preHandler: requireRole(['ADMIN']) }, async () => {
    const { rows } = await pool.query(
      `SELECT id, username, email, role, status, suspended_until AS "suspendedUntil",
              max_bet_override AS "maxBetOverride", wallet_balance AS "walletBalance", created_at AS "createdAt"
       FROM users ORDER BY created_at DESC LIMIT 200`
    );
    return rows;
  });

  app.patch('/api/admin/users/:id', { preHandler: requireRole(['ADMIN']) }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
        suspendedUntil: z.string().datetime().nullable().optional(),
        maxBetOverride: z.number().int().positive().nullable().optional(),
        role: z.enum(['PLAYER', 'MODERATOR', 'ADMIN']).optional(),
      })
      .parse(req.body);

    const { rows } = await pool.query(
      `UPDATE users
       SET status = COALESCE($1, status),
           suspended_until = CASE WHEN $1 = 'SUSPENDED' THEN $2::timestamptz ELSE NULL END,
           max_bet_override = COALESCE($3, max_bet_override),
           role = COALESCE($4, role)
       WHERE id = $5 RETURNING id`,
      [body.status ?? null, body.suspendedUntil ?? null, body.maxBetOverride ?? null, body.role ?? null, id]
    );

    if (!rows.length) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'User not found.' });
    }

    if (body.status === 'SUSPENDED' || body.status === 'DEACTIVATED') {
      await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
    }

    return { message: 'User updated.' };
  });

  // Get Default Config + Current Active Round Lock State
  app.get('/api/admin/config', { preHandler: requireRole(['ADMIN']) }, async () => {
    const { rows: cfgRows } = await pool.query(`SELECT * FROM game_config WHERE id = 1`);
    const cfg = cfgRows[0];

    const { rows: roundRows } = await pool.query(
      `SELECT id, round_date, status, betting_opens_at, betting_closes_at,
              registered_count, min_segment_length, max_segment_length,
              min_segments, max_segments, max_registered_players, min_stake_per_verse
       FROM rounds
       WHERE status IN ('REGISTRATION_OPEN', 'BETTING_OPEN', 'SETTLING')
       ORDER BY id DESC LIMIT 1`
    );
    const r = roundRows[0] ?? null;

    return {
      defaultConfig: {
        defaultOpenTime: cfg.default_open_time,
        defaultCloseTime: cfg.default_close_time,
        minSegmentLength: cfg.min_segment_length,
        maxSegmentLength: cfg.max_segment_length,
        minSegments: cfg.min_segments,
        maxSegments: cfg.max_segments,
        maxRegisteredPlayers: cfg.max_registered_players,
        minStakePerVerse: cfg.min_stake_per_verse,
        pendingNextOpensAt: cfg.pending_next_opens_at ? new Date(cfg.pending_next_opens_at).toISOString() : null,
        pendingNextClosesAt: cfg.pending_next_closes_at ? new Date(cfg.pending_next_closes_at).toISOString() : null,
      },
      activeRound: r
        ? {
            id: r.id,
            roundDate: new Date(r.round_date).toISOString().slice(0, 10),
            status: r.status,
            isLocked: r.status !== 'REGISTRATION_OPEN',
            registeredCount: r.registered_count,
            bettingOpensAt: new Date(r.betting_opens_at).toISOString(),
            bettingClosesAt: new Date(r.betting_closes_at).toISOString(),
            minSegmentLength: r.min_segment_length,
            maxSegmentLength: r.max_segment_length,
            minSegments: r.min_segments,
            maxSegments: r.max_segments,
            maxRegisteredPlayers: r.max_registered_players,
            minStakePerVerse: r.min_stake_per_verse,
          }
        : null,
    };
  });

  // Update Round Config (Applies immediately if REGISTRATION_OPEN; otherwise queues for next round)
  app.put('/api/admin/config', { preHandler: requireRole(['ADMIN']) }, async (req, reply) => {
    const body = configUpdateSchema.parse(req.body);

    if (body.nextBettingOpensAt && body.nextBettingClosesAt) {
      if (new Date(body.nextBettingClosesAt) <= new Date(body.nextBettingOpensAt)) {
        return reply.status(400).send({
          code: 'INVALID_WINDOW',
          message: 'Round end time must be after round start time.',
        });
      }
    }

    try {
      const appliedToCurrentRound = await withTransaction(async (tx) => {
        const { rows: roundRows } = await tx.query(
          `SELECT id, status, registered_count, betting_opens_at, betting_closes_at
           FROM rounds
           WHERE status IN ('REGISTRATION_OPEN', 'BETTING_OPEN', 'SETTLING')
           ORDER BY id DESC LIMIT 1 FOR UPDATE`
        );
        const activeRound = roundRows[0];

        if (activeRound && activeRound.status === 'REGISTRATION_OPEN') {
          if (
            body.maxRegisteredPlayers !== null &&
            body.maxRegisteredPlayers < activeRound.registered_count
          ) {
            throw Object.assign(
              new Error(
                `Cannot set max players (${body.maxRegisteredPlayers}) below already registered count (${activeRound.registered_count}).`
              ),
              { statusCode: 400, code: 'BELOW_CURRENT_REGISTRATIONS' }
            );
          }

          const opensAt = body.nextBettingOpensAt
            ? new Date(body.nextBettingOpensAt)
            : new Date(activeRound.betting_opens_at);
          const closesAt = body.nextBettingClosesAt
            ? new Date(body.nextBettingClosesAt)
            : new Date(activeRound.betting_closes_at);

          if (closesAt <= opensAt) {
            throw Object.assign(new Error('Round end time must be after round start time.'), {
              statusCode: 400,
              code: 'INVALID_WINDOW',
            });
          }

          // Update both default template and the currently REGISTRATION_OPEN round
          await tx.query(
            `UPDATE game_config
             SET default_open_time = $1, default_close_time = $2,
                 min_segment_length = $3, max_segment_length = $4,
                 min_segments = $5, max_segments = $6,
                 max_registered_players = $7, min_stake_per_verse = $8,
                 pending_next_opens_at = NULL, pending_next_closes_at = NULL,
                 updated_at = NOW()
             WHERE id = 1`,
            [
              body.defaultOpenTime,
              body.defaultCloseTime,
              body.minSegmentLength,
              body.maxSegmentLength,
              body.minSegments,
              body.maxSegments,
              body.maxRegisteredPlayers,
              body.minStakePerVerse,
            ]
          );

          await tx.query(
            `UPDATE rounds
             SET betting_opens_at = $1, betting_closes_at = $2,
                 min_segment_length = $3, max_segment_length = $4,
                 min_segments = $5, max_segments = $6,
                 max_registered_players = $7, min_stake_per_verse = $8
             WHERE id = $9`,
            [
              opensAt,
              closesAt,
              body.minSegmentLength,
              body.maxSegmentLength,
              body.minSegments,
              body.maxSegments,
              body.maxRegisteredPlayers,
              body.minStakePerVerse,
              activeRound.id,
            ]
          );

          return true;
        }

        // Current round is BETTING_OPEN (locked): save to game_config for the NEXT round
        if (
          activeRound &&
          body.nextBettingOpensAt &&
          new Date(body.nextBettingOpensAt) < new Date(activeRound.betting_closes_at)
        ) {
          throw Object.assign(
            new Error('Next round start time cannot be earlier than the active round end time.'),
            { statusCode: 400, code: 'OVERLAPS_ACTIVE_ROUND' }
          );
        }

        await tx.query(
          `UPDATE game_config
           SET default_open_time = $1, default_close_time = $2,
               min_segment_length = $3, max_segment_length = $4,
               min_segments = $5, max_segments = $6,
               max_registered_players = $7, min_stake_per_verse = $8,
               pending_next_opens_at = $9, pending_next_closes_at = $10,
               updated_at = NOW()
           WHERE id = 1`,
          [
            body.defaultOpenTime,
            body.defaultCloseTime,
            body.minSegmentLength,
            body.maxSegmentLength,
            body.minSegments,
            body.maxSegments,
            body.maxRegisteredPlayers,
            body.minStakePerVerse,
            body.nextBettingOpensAt ? new Date(body.nextBettingOpensAt) : null,
            body.nextBettingClosesAt ? new Date(body.nextBettingClosesAt) : null,
          ]
        );

        return false;
      });

      // Immediately process lifecycle in case admin set bettingOpensAt to now/past
      await processRoundLifecycleTick();

      return {
        appliedToCurrentRound,
        message: appliedToCurrentRound
          ? 'Updated active REGISTRATION_OPEN round and future round defaults.'
          : 'Active round is locked; configuration saved for the next round.',
      };
    } catch (err: any) {
      if (err.statusCode) {
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }
      throw err;
    }
  });

  /* Jackpotc verse setting GET */
  app.get('/api/admin/jackpot', { preHandler: requireRole(['ADMIN']) }, async () => {
    const { rows: cfgRows } = await pool.query(`SELECT * FROM game_config WHERE id = 1`);
    const cfg = cfgRows[0];

    return {
      jackpotStartVerseId: cfg.jackpot_start_verse_id,
      jackpotEndVerseId: cfg.jackpot_end_verse_id
    };
  });

  /* Jackpot verse setting PUT */
  app.put('/api/admin/jackpot', { preHandler: requireRole(['ADMIN']) }, async (req, reply) => {
    const body = jackpotUpdateSchema.parse(req.body);

    if (body.jackpotStartVerseId && body.jackpotEndVerseId) {
      if (body.jackpotStartVerseId > body.jackpotEndVerseId) {
        return reply.status(400).send({
          code: 'INVALID_WINDOW',
          message: 'Jackpot end verse must be after start verse.',
        });
      }
    }

    try {
      const _appliedToGameConfig = await withTransaction(async (tx) => {
        const { rows: _roundRows } = await tx.query(
          `UPDATE game_config
           SET jackpot_start_verse_id = $1, jackpot_end_verse_id = $2 
           WHERE id = 1`,
          [body.jackpotStartVerseId, body.jackpotEndVerseId]
        );
      });

    } catch (err: any) {
      if (err.statusCode) {
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }
      throw err;
    }
  });
}