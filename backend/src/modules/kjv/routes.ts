import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireActivePlayer } from '../../plugins/auth.js';

interface Interval {
  start: number;
  end: number;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    if (sorted[i].start <= prev.end + 1) {
      prev.end = Math.max(prev.end, sorted[i].end);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

export async function kjvRoutes(app: FastifyInstance) {
  // 1. Full-Text Search
  app.get('/api/kjv/search', { preHandler: requireActivePlayer }, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(3).max(100) }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT verse_id AS "verseId", testament, book_number AS "bookNumber",
              book_name AS "bookName", chapter, verse, text
       FROM kjv_verses
       WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY verse_id ASC
       LIMIT 75`,
      [q]
    );
    return rows;
  });

  // 2. Book & Chapter Metadata + Verse Reader
  app.get('/api/kjv/books', { preHandler: requireActivePlayer }, async () => {
    const { rows } = await pool.query(
      `SELECT book_number AS "bookNumber", book_name AS "bookName", testament,
              MAX(chapter) AS "chapterCount", MIN(verse_id) AS "startVerseId", MAX(verse_id) AS "endVerseId"
       FROM kjv_verses
       GROUP BY book_number, book_name, testament
       ORDER BY book_number ASC`
    );
    return rows;
  });

  app.get('/api/kjv/books/:bookNumber/chapters/:chapter', { preHandler: requireActivePlayer }, async (req) => {
    const params = z
      .object({
        bookNumber: z.coerce.number().int().min(1).max(66),
        chapter: z.coerce.number().int().min(1).max(150),
      })
      .parse(req.params);

    const { rows } = await pool.query(
      `SELECT verse_id AS "verseId", testament, book_number AS "bookNumber",
              book_name AS "bookName", chapter, verse, text
       FROM kjv_verses
       WHERE book_number = $1 AND chapter = $2
       ORDER BY verse ASC`,
      [params.bookNumber, params.chapter]
    );
    return rows;
  });

  // 3. Auto-Select Random Non-Overlapping Segments
  // app.post('/api/kjv/auto-select', { preHandler: requireActivePlayer }, async (req, reply) => {
  //   const body = z
  //     .object({
  //       testament: z.enum(['OLD', 'NEW']).optional(),
  //       bookNumbers: z.array(z.number().int().min(1).max(66)).optional(),
  //       customRange: z.tuple([z.number().int().min(1).max(31102), z.number().int().min(1).max(31102)]).optional(),
  //       segmentCount: z.number().int().min(1).max(5),
  //       totalLength: z.number().int().min(3).max(500),
  //     })
  //     .parse(req.body);

  //   const { segmentCount: k, totalLength: total } = body;
  //   if (total < k * 3 || total > k * 100) {
  //     return reply.status(400).send({
  //       code: 'INVALID_DIMENSIONS',
  //       message: `Total length (${total}) cannot be split into ${k} segments of 3–100 verses.`,
  //     });
  //   }
// Replace the top of app.post('/api/kjv/auto-select', ...) with:
  app.post('/api/kjv/auto-select', { preHandler: requireActivePlayer }, async (req, reply) => {
    const body = z
      .object({
        testament: z.enum(['OLD', 'NEW']).optional(),
        bookNumbers: z.array(z.number().int().min(1).max(66)).optional(),
        customRange: z.tuple([z.number().int().min(1).max(31102), z.number().int().min(1).max(31102)]).optional(),
        segmentCount: z.number().int().min(1).max(50),
        totalLength: z.number().int().min(1).max(500),
      })
      .parse(req.body);

    const { rows: roundRows } = await pool.query(
      `SELECT min_segment_length, max_segment_length, min_segments, max_segments, min_stake_per_verse
       FROM rounds WHERE status IN ('REGISTRATION_OPEN', 'BETTING_OPEN') ORDER BY id DESC LIMIT 1`
    );
    const rules = roundRows[0] ?? {
      min_segment_length: 3,
      max_segment_length: 100,
      min_segments: 1,
      max_segments: 5,
      min_stake_per_verse: 1,
    };

    const { segmentCount: k, totalLength: total } = body;
    if (k < rules.min_segments || k > rules.max_segments) {
      return reply.status(400).send({
        code: 'INVALID_SEGMENT_COUNT',
        message: `Segment count must be between ${rules.min_segments} and ${rules.max_segments}.`,
      });
    }
    if (total < k * rules.min_segment_length || total > k * rules.max_segment_length) {
      return reply.status(400).send({
        code: 'INVALID_DIMENSIONS',
        message: `Total length (${total}) cannot be split into ${k} segments of ${rules.min_segment_length}–${rules.max_segment_length} verses.`,
      });
    }

    // Build initial allowed intervals from filter criteria
    let poolIntervals: Interval[] = [];
    if (body.customRange) {
      const [a, b] = body.customRange;
      poolIntervals = [{ start: Math.min(a, b), end: Math.max(a, b) }];
    } else if (body.bookNumbers?.length) {
      const { rows } = await pool.query(
        `SELECT MIN(verse_id) AS start, MAX(verse_id) AS "end"
         FROM kjv_verses WHERE book_number = ANY($1) GROUP BY book_number`,
        [body.bookNumbers]
      );
      poolIntervals = rows.map((r) => ({ start: r.start, end: r.end }));
    } else if (body.testament) {
      const { rows } = await pool.query(
        `SELECT MIN(verse_id) AS start, MAX(verse_id) AS "end" FROM kjv_verses WHERE testament = $1`,
        [body.testament]
      );
      poolIntervals = [{ start: rows[0].start, end: rows[0].end }];
    } else {
      poolIntervals = [{ start: 1, end: 31102 }];
    }

    const baseIntervals = mergeIntervals(poolIntervals);
    const availableCount = baseIntervals.reduce((acc, iv) => acc + (iv.end - iv.start + 1), 0);
    if (availableCount < total) {
      return reply.status(400).send({
        code: 'POOL_TOO_SMALL',
        message: `Selected verse pool only contains ${availableCount} verses (requested ${total}).`,
      });
    }

    // Attempt up to 30 randomized placements with interval carving
    for (let attempt = 0; attempt < 30; attempt++) {
      // Partition total into k integers in [3, 100]
      const lengths = Array(k).fill(rules.min_segment_length);
      let rem = total - k * rules.min_segment_length;
      while (rem > 0) {
        const candidates = lengths.map((len, idx) => (len < rules.max_segment_length ? idx : -1)).filter((idx) => idx !== -1);
        const pick = candidates[crypto.randomInt(candidates.length)];
        lengths[pick]++;
        rem--;
      }
      lengths.sort((a, b) => b - a); // Place largest segments first

      let free = baseIntervals.map((iv) => ({ ...iv }));
      const chosen: Interval[] = [];
      let failed = false;

      for (const len of lengths) {
        const viable = free
          .map((iv, idx) => ({ iv, idx, ways: iv.end - iv.start + 1 - len + 1 }))
          .filter((x) => x.ways > 0);

        if (!viable.length) {
          failed = true;
          break;
        }

        const totalWays = viable.reduce((sum, x) => sum + x.ways, 0);
        let roll = crypto.randomInt(totalWays);
        let selected = viable[0];
        for (const v of viable) {
          if (roll < v.ways) {
            selected = v;
            break;
          }
          roll -= v.ways;
        }

        const startVerse = selected.iv.start + roll;
        const endVerse = startVerse + len - 1;
        chosen.push({ start: startVerse, end: endVerse });

        // Carve chosen range out of free interval list
        const nextFree: Interval[] = [];
        for (let i = 0; i < free.length; i++) {
          if (i !== selected.idx) {
            nextFree.push(free[i]);
            continue;
          }
          if (selected.iv.start <= startVerse - 1) {
            nextFree.push({ start: selected.iv.start, end: startVerse - 1 });
          }
          if (endVerse + 1 <= selected.iv.end) {
            nextFree.push({ start: endVerse + 1, end: selected.iv.end });
          }
        }
        free = nextFree;
      }

      if (!failed) {
        chosen.sort((a, b) => a.start - b.start);
        // Hydrate human-readable verse labels
        const verseIds = chosen.flatMap((c) => [c.start, c.end]);
        const { rows: labelRows } = await pool.query(
          `SELECT verse_id, book_name || ' ' || chapter || ':' || verse AS label
           FROM kjv_verses WHERE verse_id = ANY($1)`,
          [verseIds]
        );
        const labelMap = new Map(labelRows.map((r) => [r.verse_id, r.label]));

        return chosen.map((c) => ({
          startVerseId: c.start,
          endVerseId: c.end,
          startLabel: labelMap.get(c.start),
          endLabel: labelMap.get(c.end),
          verseLength: c.end - c.start + 1,
          stake: (c.end - c.start + 1) * rules.min_stake_per_verse,
        }));
      }
    }

    return reply.status(400).send({
      code: 'FRAGMENTED_POOL',
      message: 'Could not fit non-overlapping segments in that narrow range. Try broadening your filter.',
    });
  });
}