import crypto from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { computeMaxVersesPerPlayer, GAME_TZ, KJV_TOTAL_VERSES } from '../config/time.js';
import { pool, withTransaction } from '../db/pool.js';
import { settleRound } from '../modules/settlement/engine.js';

if (env.NODE_ENV === 'production') {
  console.error('ABORT: dev-cli.ts cannot be executed when NODE_ENV=production.');
  process.exit(1);
}

interface RoundRow {
  id: number;
  round_date: Date;
  status: 'REGISTRATION_OPEN' | 'BETTING_OPEN' | 'SETTLING' | 'COMPLETED';
  registered_count: number;
  max_verses_per_player: number | null;
  total_pot: number;
  betting_opens_at: Date;
  betting_closes_at: Date;
}

async function getLatestActiveRound(): Promise<RoundRow | null> {
  const { rows } = await pool.query<RoundRow>(
    `SELECT id, round_date, status, registered_count, max_verses_per_player,
            total_pot, betting_opens_at, betting_closes_at
     FROM rounds
     WHERE status IN ('REGISTRATION_OPEN', 'BETTING_OPEN', 'SETTLING')
     ORDER BY id DESC LIMIT 1`
  );
  return rows[0] ?? null;
}

async function createNextRoundAfter(prevDate?: Date) {
  const baseDay = prevDate
    ? DateTime.fromJSDate(prevDate, { zone: 'utc' }).plus({ days: 1 })
    : DateTime.now().setZone(GAME_TZ).plus({ days: 1 });

  const nextDateStr = baseDay.toISODate()!;
  const now = new Date();
  const opensAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const closesAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { rows } = await pool.query<RoundRow>(
    `INSERT INTO rounds (
       round_date, status, registration_opens_at, betting_opens_at, betting_closes_at
     )
     VALUES ($1, 'REGISTRATION_OPEN', $2, $3, $4)
     ON CONFLICT (round_date) DO UPDATE SET
       status = 'REGISTRATION_OPEN',
       registration_opens_at = EXCLUDED.registration_opens_at,
       betting_opens_at = EXCLUDED.betting_opens_at,
       betting_closes_at = EXCLUDED.betting_closes_at
     RETURNING id, round_date, status, registered_count, max_verses_per_player, total_pot, betting_opens_at, betting_closes_at`,
    [nextDateStr, now, opensAt, closesAt]
  );

  return rows[0];
}

// 1. status: Print current round & bet telemetry
async function cmdStatus() {
  const round = await getLatestActiveRound();
  if (!round) {
    console.log('No active round found. Run `npm run cli -- next-round` to open one.');
    return;
  }

  const { rows: betStats } = await pool.query(
    `SELECT COUNT(*)::int AS bet_count, COUNT(DISTINCT user_id)::int AS active_bettors
     FROM bets WHERE round_id = $1`,
    [round.id]
  );

  console.log('\n=== Active Round Status ===');
  console.log(`Round ID:          #${round.id} (${new Date(round.round_date).toISOString().slice(0, 10)})`);
  console.log(`Phase:             ${round.status}`);
  console.log(`Registered (M):    ${round.registered_count}`);
  console.log(`Max Verses/Player: ${round.max_verses_per_player ?? 'Unset (locks at betting open)'}`);
  console.log(`Active Bettors:    ${betStats[0].active_bettors}`);
  console.log(`Total Segments:    ${betStats[0].bet_count}`);
  console.log(`Total Pot:         ${round.total_pot.toLocaleString()} Shekels\n`);
}

// 2. open-betting: Transition REGISTRATION_OPEN -> BETTING_OPEN
async function cmdOpenBetting() {
  const round = await getLatestActiveRound();
  if (!round) {
    throw new Error('No active round found.');
  }
  if (round.status === 'BETTING_OPEN') {
    console.log(`Round #${round.id} is already in BETTING_OPEN.`);
    return;
  }

  const cap = computeMaxVersesPerPlayer(round.registered_count);
  const now = new Date();
  const closesAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  await pool.query(
    `UPDATE rounds
     SET status = 'BETTING_OPEN',
         max_verses_per_player = $1,
         betting_opens_at = $2,
         betting_closes_at = $3
     WHERE id = $4`,
    [cap, now, closesAt, round.id]
  );

  console.log(
    `Round #${round.id} transitioned to BETTING_OPEN (M=${round.registered_count}, maxVersesPerPlayer=${cap}).`
  );
}

// 3. settle: Run sweep-line collision & payouts on BETTING_OPEN round, then open next day's registration
async function cmdSettle() {
  const round = await getLatestActiveRound();
  if (!round || round.status !== 'BETTING_OPEN') {
    throw new Error('No round currently in BETTING_OPEN to settle.');
  }

  console.log(`Settling Round #${round.id}...`);
  await settleRound(round.id);

  const { rows: summary } = await pool.query(
    `SELECT outcome, COUNT(*)::int AS count, COALESCE(SUM(stake), 0) AS total_stake, COALESCE(SUM(payout), 0) AS total_payout
     FROM bets WHERE round_id = $1 GROUP BY outcome ORDER BY outcome`,
    [round.id]
  );

  console.log(`\n=== Round #${round.id} Settlement Summary ===`);
  if (!summary.length) {
    console.log('No bets were placed in this round.');
  } else {
    console.table(summary);
  }

  const nextRound = await createNextRoundAfter(round.round_date);
  console.log(
    `Opened Round #${nextRound.id} (${new Date(nextRound.round_date).toISOString().slice(0, 10)}) in REGISTRATION_OPEN.\n`
  );
}

// 4. seed-bots [count]: Ensure active bot players exist (and register them if round is REGISTRATION_OPEN)
async function cmdSeedBots(count = 5) {
  const defaultHash = await hash('BotPassword123!');
  const round = await getLatestActiveRound();

  const botIds: string[] = [];

  await withTransaction(async (tx) => {
    for (let i = 1; i <= count; i++) {
      const username = `bot_player_${i}`;
      const email = `bot${i}@kjv-arena.local`;

      const { rows } = await tx.query(
        `INSERT INTO users (username, email, password_hash, role, status, wallet_balance)
         VALUES ($1, $2, $3, 'PLAYER', 'ACTIVE', 20000)
         ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE'
         RETURNING id, wallet_balance`,
        [username, email, defaultHash]
      );

      const bot = rows[0];
      botIds.push(bot.id);

      // Top up bot if balance dropped below 1000 Gerahs (50 shekels) during repeated testing
      if (bot.wallet_balance < 1000) {
        const topUp = 20000 - bot.wallet_balance;
        await tx.query(`UPDATE users SET wallet_balance = 20000 WHERE id = $1`, [bot.id]);
        await tx.query(
          `INSERT INTO wallet_ledger (user_id, entry_type, amount, balance_after)
           VALUES ($1, 'ADMIN_ADJUSTMENT', $2, 20000)`,
          [bot.id, topUp]
        );
      }

      if (round && round.status === 'REGISTRATION_OPEN') {
        const regRes = await tx.query(
          `INSERT INTO round_registrations (round_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [round.id, bot.id]
        );
        if (regRes.rowCount && regRes.rowCount > 0) {
          await tx.query(`UPDATE rounds SET registered_count = registered_count + 1 WHERE id = $1`, [round.id]);
        }
      }
    }
  });

  console.log(
    `Ensured ${count} active bot players (bot_player_1 .. bot_player_${count})` +
      (round?.status === 'REGISTRATION_OPEN' ? ` and registered them for Round #${round.id}.` : '.')
  );
  return botIds;
}

// 5. sim-bets [--collide]: Submit randomized valid bet slips for bot players in BETTING_OPEN round
async function cmdSimBets(forceCollision: boolean) {
  const round = await getLatestActiveRound();
  if (!round || round.status !== 'BETTING_OPEN') {
    throw new Error('Round must be in BETTING_OPEN before simulating bets. Run `open-betting` first.');
  }

  const botIds = await cmdSeedBots(5);

  // Check if there is an existing human bet we can deliberately collide with when --collide is passed
  const { rows: existingBets } = await pool.query<{ start_verse_id: number; end_verse_id: number }>(
    `SELECT start_verse_id, end_verse_id FROM bets WHERE round_id = $1 LIMIT 1`,
    [round.id]
  );

  let collisionInjected = false;

  for (let bIdx = 0; bIdx < botIds.length; bIdx++) {
    const botId = botIds[bIdx];

    await withTransaction(async (tx) => {
      // Ensure bot is registered even if open-betting was run before seed-bots
      const regIns = await tx.query(
        `INSERT INTO round_registrations (round_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [round.id, botId]
      );
      if (regIns.rowCount && regIns.rowCount > 0) {
        await tx.query(`UPDATE rounds SET registered_count = registered_count + 1 WHERE id = $1`, [round.id]);
      }

      const { rows: regRows } = await tx.query(
        `SELECT submission_count FROM round_registrations WHERE round_id = $1 AND user_id = $2 FOR UPDATE`,
        [round.id, botId]
      );
      if (regRows[0].submission_count > 0) return; // Bot already bet this round

      const { rows: uRows } = await tx.query(
        `SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE`,
        [botId]
      );
      let balance = BigInt(uRows[0].wallet_balance);
      const maxVerses = round.max_verses_per_player ?? 500;

      // Build 1–3 non-overlapping segments within maxVerses
      const segCount = crypto.randomInt(1, 4);
      const segments: Array<{ start: number; end: number; stake: number }> = [];
      let versesUsed = 0;

      for (let s = 0; s < segCount; s++) {
        const remainingBudget = maxVerses - versesUsed;
        if (remainingBudget < 3) break;

        const len = crypto.randomInt(3, Math.min(35, remainingBudget) + 1);
        let start: number;
        let end: number;

        // If --collide is requested, make the first bot overlap an existing bet (or Genesis 1:1-5)
        if (forceCollision && !collisionInjected) {
          const targetVerse = existingBets[0]?.start_verse_id ?? 1;
          start = Math.max(1, Math.min(KJV_TOTAL_VERSES - len + 1, targetVerse));
          end = start + len - 1;
          collisionInjected = true;
        } else {
          start = crypto.randomInt(1, KJV_TOTAL_VERSES - len + 1);
          end = start + len - 1;
        }

        // Skip if self-overlapping
        if (segments.some((existing) => start <= existing.end && end >= existing.start)) {
          continue;
        }

        const stake = crypto.randomInt(15, 85);
        if (BigInt(stake) > balance) break;

        segments.push({ start, end, stake });
        versesUsed += len;
        balance -= BigInt(stake);
      }

      if (!segments.length) return;

      let potAdded = 0n;
      for (const seg of segments) {
        potAdded += BigInt(seg.stake);
        const { rows: betRow } = await tx.query(
          `INSERT INTO bets (round_id, user_id, start_verse_id, end_verse_id, stake)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [round.id, botId, seg.start, seg.end, seg.stake]
        );
        await tx.query(
          `INSERT INTO wallet_ledger (user_id, round_id, bet_id, entry_type, amount, balance_after)
           VALUES ($1, $2, $3, 'SLIP_STAKE', $4, $5)`,
          [botId, round.id, betRow[0].id, -seg.stake, Number(balance)]
        );
      }

      await tx.query(`UPDATE users SET wallet_balance = $1 WHERE id = $2`, [Number(balance), botId]);
      await tx.query(`UPDATE rounds SET total_pot = total_pot + $1 WHERE id = $2`, [Number(potAdded), round.id]);
      await tx.query(
        `UPDATE round_registrations SET submission_count = 1, last_submitted_at = NOW()
         WHERE round_id = $1 AND user_id = $2`,
        [round.id, botId]
      );
    });
  }

  console.log(
    `Simulated bot bet slips for Round #${round.id}` +
      (forceCollision ? ' (including an intentional verse collision!).' : '.')
  );
  await cmdStatus();
}

async function main() {
  const [, , command, arg] = process.argv;

  try {
    switch (command) {
      case 'status':
        await cmdStatus();
        break;
      case 'open-betting':
        await cmdOpenBetting();
        break;
      case 'settle':
        await cmdSettle();
        break;
      case 'seed-bots':
        await cmdSeedBots(arg ? parseInt(arg, 10) : 5);
        break;
      case 'sim-bets':
        await cmdSimBets(arg === '--collide');
        break;
      case 'next-round': {
        const r = await createNextRoundAfter();
        console.log(`Created Round #${r.id} in REGISTRATION_OPEN.`);
        break;
      }
      default:
        console.log(`
KJV Verse Arena — Dev CLI

Usage: npm run cli -- <command>

Commands:
  status                 Show current round phase, registered count (M), verse cap, and pot
  seed-bots [N]          Create/top-up N active bot players (default 5) and register them
  open-betting           Force REGISTRATION_OPEN -> BETTING_OPEN (locks M and verse cap)
  sim-bets [--collide]   Place random valid bet slips for bots (--collide overlaps an active bet)
  settle                 Run collision detection + payouts on current round & open next round
  next-round             Ensure an active REGISTRATION_OPEN round exists
        `);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('CLI Error:', err.message);
  process.exit(1);
});