import { FastifyInstance } from 'fastify';
import { pool } from '../../db/pool.js';
import { requireActivePlayer } from '../../plugins/auth.js';


interface UserVerseData {
  bookName: string,
  chapter: number,
  verseId: number, 
  score: number
}


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
              COALESCE(SUM(total_pot), 0) AS "totalGerahsWagered",
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

  app.get('/api/stats/ledger', { preHandler: requireActivePlayer }, async (req) => {
    const { rows } = await pool.query(
      `SELECT created_at, MAX(balance_after) AS balance
       FROM wallet_ledger
       WHERE user_id = $1 AND entry_type = ANY(ARRAY['ROUND_WINNING', 'INITIAL_GRANT'])
       GROUP BY created_at
       ORDER BY created_at ASC NULLS LAST`,
       [req.currentUser!.id]
    );

    const dateTimeFormat = new Intl.DateTimeFormat("sv-SE", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });

    const retval = rows.map((row) => ({
      date: dateTimeFormat.format(row.created_at),
      walletBalance: row.balance
    }));

    return { ledgerData: retval };
  });


  app.get('/api/stats/scores', { preHandler: requireActivePlayer }, async (req) => {
    
    const { rows: playerBetsWonRows } = await pool.query(
      `SELECT id, round_id, start_verse_id, end_verse_id
       FROM bets
       WHERE user_id = $1 AND outcome = 'WON'
       ORDER BY start_verse_id ASC, end_verse_id DESC`,
      [req.currentUser!.id]
    );

    const verseIds = playerBetsWonRows.flatMap((c) => [c.start_verse_id, c.end_verse_id]);

    const { rows: labelRows } = await pool.query(
      `SELECT verse_id, book_name || ' ' || chapter || ':' || verse AS label
        FROM kjv_verses WHERE verse_id = ANY($1)`,
      [verseIds]
    );
    
    const labelMap = new Map(labelRows.map((r) => [r.verse_id, r.label]));

    let nonzeroScores: {
      label: string,
      verseId: number, 
      score: number 
    }[] = [];

    for (const bet of playerBetsWonRows) {
      for (let i = bet.start_verse_id; i < bet.end_verse_id; i++ ) {
        const matching = nonzeroScores.find((item) => item.verseId === i );
        if (matching) {
          // increment the score for this verse
          nonzeroScores[nonzeroScores.findIndex((datum) => datum.verseId === i)].score += 1;
        } else {
          // start the verse with a score of 1
          nonzeroScores.push({ label: labelMap.get(i), verseId: i, score: 1 });
        }
      }
    }

    let nonzeroScoreSegments: {
      startVerseId: number,
      endVerseId: number,
      startLabel?: string, // e.g., "Genesis 1:1"
      endLabel?: string,   // e.g., "Genesis 1:5"
      score: number
    }[] = [];

    const bigScores = nonzeroScores.filter((score) => score.score > 1);
    bigScores.sort((a, b) => a.verseId - b.verseId);

    let segmentStart = bigScores[0].verseId;
    let segmentEnd = segmentStart;

    for (const verse of bigScores) {
      if (verse.verseId > segmentEnd + 1) {
        const segment = bigScores.filter((v) => v.verseId >= segmentStart && v.verseId < segmentEnd );
        const segmentScore = segment.reduce((acc, v) => acc + v.score, 0) / segment.length;

        nonzeroScoreSegments.push({
          startVerseId: segmentStart, 
          endVerseId: segmentEnd, 
          startLabel: labelMap.get(segmentStart), 
          endLabel: labelMap.get(segmentEnd),
          score: segmentScore
        });

        segmentStart = verse.verseId;
        segmentEnd = verse.verseId + 1;
      } 
      else {
        segmentEnd += 1;
      }
    }

    const segment = bigScores.filter((v) => v.verseId >= segmentStart && v.verseId < segmentEnd );
    const segmentScore = segment.reduce((acc, v) => acc + v.score, 0) / segment.length;

    nonzeroScoreSegments.push({
      startVerseId: segmentStart, 
      endVerseId: segmentEnd, 
      startLabel: labelMap.get(segmentStart), 
      endLabel: labelMap.get(segmentEnd),
      score: segmentScore
    });

    nonzeroScoreSegments.sort((a, b) => b.score - a.score);

    return nonzeroScoreSegments;
  });

}