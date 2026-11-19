import { FastifyInstance } from 'fastify';
import { pool } from '../../db/pool.js';
import { requireActivePlayer } from '../../plugins/auth.js';

function formatVerseRange(row: {
  start_book: string | null;
  start_chapter: number | null;
  start_verse: number | null;
  end_book: string | null;
  end_chapter: number | null;
  end_verse: number | null;
  verse_length: number | null;
}): string | null {
  if (!row.start_book || !row.end_book) return null;

  const start = `${row.start_book} ${row.start_chapter}:${row.start_verse}`;

  // Single-verse segment (e.g., "John 3:16")
  if (
    row.start_book === row.end_book &&
    row.start_chapter === row.end_chapter &&
    row.start_verse === row.end_verse
  ) {
    return start;
  }

  // Same-book segment (e.g., "Genesis 1:1 – 1:5")
  if (row.start_book === row.end_book) {
    return `${start} – ${row.end_chapter}:${row.end_verse}`;
  }

  // Cross-book segment (e.g., "Genesis 50:25 – Exodus 1:2")
  return `${start} – ${row.end_book} ${row.end_chapter}:${row.end_verse}`;
}


export async function statsRoutes(app: FastifyInstance) {
  app.get('/api/player/ledger', { preHandler: requireActivePlayer }, async (req) => {
    const { rows } = await pool.query(
      `SELECT
        wl.id,
        wl.round_id,
        wl.bet_id,
        wl.entry_type,
        wl.amount,
        wl.balance_after,
        wl.created_at,
        b.verse_length,
        sv.book_name AS start_book,
        sv.chapter   AS start_chapter,
        sv.verse     AS start_verse,
        ev.book_name AS end_book,
        ev.chapter   AS end_chapter,
        ev.verse     AS end_verse
        FROM wallet_ledger wl
        LEFT JOIN bets b ON wl.bet_id = b.id
        LEFT JOIN kjv_verses sv ON b.start_verse_id = sv.verse_id
        LEFT JOIN kjv_verses ev ON b.end_verse_id = ev.verse_id
        WHERE wl.user_id = $1
        ORDER BY wl.id DESC
        LIMIT 500`,
      [req.currentUser!.id]
    );

    const ledger = rows.map((r) => ({
      id: Number(r.id),
      roundId: r.round_id,
      betId: r.bet_id,
      entryType: r.entry_type,
      amount: Number(r.amount),
      balanceAfter: Number(r.balance_after),
      createdAt: r.created_at,
      verseRange: formatVerseRange(r),
      verseCount: r.verse_length
    }));
    return ledger;
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
              COALESCE(SUM(b.payout - b.stake), 0) AS "netGerahsWon",
              COUNT(*)::int AS "survivingSegments"
       FROM bets b
       JOIN rounds r ON r.id = b.round_id
       JOIN users u ON u.id = b.user_id
       WHERE r.status = 'COMPLETED' AND r.round_date >= CURRENT_DATE - INTERVAL '7 days' AND b.outcome = 'WON'
       GROUP BY u.id, u.username
       ORDER BY "netGerahsWon" DESC LIMIT 10`
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