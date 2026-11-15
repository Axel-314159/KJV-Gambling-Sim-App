import { FastifyInstance } from 'fastify';
import { pool } from '../../db/pool.js';
import { requireActivePlayer } from '../../plugins/auth.js';

export async function statsRoutes(app: FastifyInstance) {
  app.get('/api/player/ledger', { preHandler: requireActivePlayer }, async (req) => {
    const { rows } = await pool.query(
      `SELECT id, round_id AS "roundId", entry_type AS "entryType",
              amount, balance_after AS "balanceAfter", created_at AS "createdAt"
       FROM wallet_ledger
       WHERE user_id = $1
       ORDER BY id DESC LIMIT 100`,
      [req.currentUser!.id]
    );
    return rows;
  });

  app.get('/api/stats/weekly', { preHandler: requireActivePlayer }, async () => {
    const { rows: summary } = await pool.query(
      `SELECT COUNT(*)::int AS "totalRoundsSettled",
              COALESCE(SUM(total_pot), 0) AS "totalShekelsWagered",
              COALESCE(MIN(round_date)::text, CURRENT_DATE::text) AS "weekStartDate",
              COALESCE(MAX(round_date)::text, CURRENT_DATE::text) AS "weekEndDate"
       FROM rounds
       WHERE status = 'COMPLETED' AND round_date >= CURRENT_DATE - INTERVAL '7 days'`
    );

    const { rows: topWinners } = await pool.query(
      `SELECT u.username,
              COALESCE(SUM(b.payout - b.stake), 0) AS "netShekelsWon",
              COUNT(*)::int AS "survivingSegments"
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
       JOIN users u ON u.id = b.user_id
       WHERE r.status = 'COMPLETED' AND r.round_date >= CURRENT_DATE - INTERVAL '7 days' AND b.outcome = 'WON'
       GROUP BY u.id, u.username
       ORDER BY "netShekelsWon" DESC LIMIT 10`
    );

    const { rows: mostContestedBooks } = await pool.query(
      `SELECT v.book_name AS "bookName", COUNT(*)::int AS "collisionCount"
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
       JOIN kjv_verses v ON v.verse_id = b.start_verse_id
       WHERE r.status = 'COMPLETED' AND r.round_date >= CURRENT_DATE - INTERVAL '7 days' AND b.outcome = 'COLLIDED'
       GROUP BY v.book_name
       ORDER BY "collisionCount" DESC LIMIT 10`
    );

    return {
      ...summary[0],
      topWinners,
      mostContestedBooks,
    };
  });
}