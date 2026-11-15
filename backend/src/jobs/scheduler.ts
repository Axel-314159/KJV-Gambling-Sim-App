import { PgBoss } from 'pg-boss';
import { env } from '../config/env.js';
import { pool, withTransaction } from '../db/pool.js';
import { computeMaxVersesPerPlayer, getScheduleForInstant } from '../config/time.js';
import { settleRound } from '../modules/settlement/engine.js';

export async function ensureActiveRoundExists() {
  await withTransaction(async (tx) => {
    const { rows: existing } = await tx.query(
      `SELECT id FROM rounds WHERE status IN ('REGISTRATION_OPEN', 'BETTING_OPEN', 'SETTLING') LIMIT 1`
    );
    if (existing.length) return;

    const { rows: cfgRows } = await tx.query(`SELECT * FROM game_config WHERE id = 1 FOR UPDATE`);
    const cfg = cfgRows[0];

    const sched = getScheduleForInstant(new Date(), cfg.default_open_time, cfg.default_close_time);
    const opensAt = cfg.pending_next_opens_at ? new Date(cfg.pending_next_opens_at) : sched.bettingOpensAt;
    const closesAt = cfg.pending_next_closes_at ? new Date(cfg.pending_next_closes_at) : sched.bettingClosesAt;
    const phase = new Date() < opensAt ? 'REGISTRATION_OPEN' : 'BETTING_OPEN';
    const initialCap =
      phase === 'BETTING_OPEN' ? computeMaxVersesPerPlayer(0, cfg.min_segment_length) : null;

    await tx.query(
      `INSERT INTO rounds (
         round_date, status, registration_opens_at, betting_opens_at, betting_closes_at,
         max_verses_per_player, min_segment_length, max_segment_length,
         min_segments, max_segments, max_registered_players, min_stake_per_verse
       )
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (round_date) DO NOTHING`,
      [
        sched.roundDate,
        phase,
        opensAt,
        closesAt,
        initialCap,
        cfg.min_segment_length,
        cfg.max_segment_length,
        cfg.min_segments,
        cfg.max_segments,
        cfg.max_registered_players,
        cfg.min_stake_per_verse,
      ]
    );

    // Clear one-off next-round timestamp overrides once consumed
    if (cfg.pending_next_opens_at || cfg.pending_next_closes_at) {
      await tx.query(
        `UPDATE game_config SET pending_next_opens_at = NULL, pending_next_closes_at = NULL WHERE id = 1`
      );
    }
  });
}

export async function processRoundLifecycleTick() {
  // 1. Transition REGISTRATION_OPEN -> BETTING_OPEN once betting_opens_at arrives
  const { rows: toOpen } = await pool.query(
    `SELECT id, registered_count, min_segment_length
     FROM rounds
     WHERE status = 'REGISTRATION_OPEN' AND betting_opens_at <= NOW()
     ORDER BY id ASC`
  );
  for (const r of toOpen) {
    const cap = computeMaxVersesPerPlayer(r.registered_count, r.min_segment_length);
    await pool.query(
      `UPDATE rounds SET status = 'BETTING_OPEN', max_verses_per_player = $1 WHERE id = $2`,
      [cap, r.id]
    );
  }

  // 2. Settle BETTING_OPEN -> COMPLETED once betting_closes_at arrives
  const { rows: toClose } = await pool.query(
    `SELECT id FROM rounds WHERE status = 'BETTING_OPEN' AND betting_closes_at <= NOW() ORDER BY id ASC`
  );
  for (const r of toClose) {
    await settleRound(r.id);
  }

  // 3. Ensure an upcoming round exists
  await ensureActiveRoundExists();
}

export async function startScheduler() {
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on('error', (err) => console.error('[pg-boss error]', err));
  await boss.start();

  await boss.createQueue('round-lifecycle-tick');
  await boss.schedule('round-lifecycle-tick', '* * * * *');
  await boss.work('round-lifecycle-tick', async () => {
    await processRoundLifecycleTick();
  });

  await processRoundLifecycleTick();
  return boss;
}