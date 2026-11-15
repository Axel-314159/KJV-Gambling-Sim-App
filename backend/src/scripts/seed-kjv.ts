import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from '../db/pool.js';

const PG10_URL = 'https://www.gutenberg.org/cache/epub/10/pg10.txt';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, '../../data/pg10.txt');

interface BookMeta {
  bookNumber: number;
  bookName: string;
  testament: 'OLD' | 'NEW';
}

const CANONICAL_BOOKS: BookMeta[] = [
  // Old Testament (1–39)
  { bookNumber: 1, bookName: 'Genesis', testament: 'OLD' },
  { bookNumber: 2, bookName: 'Exodus', testament: 'OLD' },
  { bookNumber: 3, bookName: 'Leviticus', testament: 'OLD' },
  { bookNumber: 4, bookName: 'Numbers', testament: 'OLD' },
  { bookNumber: 5, bookName: 'Deuteronomy', testament: 'OLD' },
  { bookNumber: 6, bookName: 'Joshua', testament: 'OLD' },
  { bookNumber: 7, bookName: 'Judges', testament: 'OLD' },
  { bookNumber: 8, bookName: 'Ruth', testament: 'OLD' },
  { bookNumber: 9, bookName: '1 Samuel', testament: 'OLD' },
  { bookNumber: 10, bookName: '2 Samuel', testament: 'OLD' },
  { bookNumber: 11, bookName: '1 Kings', testament: 'OLD' },
  { bookNumber: 12, bookName: '2 Kings', testament: 'OLD' },
  { bookNumber: 13, bookName: '1 Chronicles', testament: 'OLD' },
  { bookNumber: 14, bookName: '2 Chronicles', testament: 'OLD' },
  { bookNumber: 15, bookName: 'Ezra', testament: 'OLD' },
  { bookNumber: 16, bookName: 'Nehemiah', testament: 'OLD' },
  { bookNumber: 17, bookName: 'Esther', testament: 'OLD' },
  { bookNumber: 18, bookName: 'Job', testament: 'OLD' },
  { bookNumber: 19, bookName: 'Psalms', testament: 'OLD' },
  { bookNumber: 20, bookName: 'Proverbs', testament: 'OLD' },
  { bookNumber: 21, bookName: 'Ecclesiastes', testament: 'OLD' },
  { bookNumber: 22, bookName: 'Song of Solomon', testament: 'OLD' },
  { bookNumber: 23, bookName: 'Isaiah', testament: 'OLD' },
  { bookNumber: 24, bookName: 'Jeremiah', testament: 'OLD' },
  { bookNumber: 25, bookName: 'Lamentations', testament: 'OLD' },
  { bookNumber: 26, bookName: 'Ezekiel', testament: 'OLD' },
  { bookNumber: 27, bookName: 'Daniel', testament: 'OLD' },
  { bookNumber: 28, bookName: 'Hosea', testament: 'OLD' },
  { bookNumber: 29, bookName: 'Joel', testament: 'OLD' },
  { bookNumber: 30, bookName: 'Amos', testament: 'OLD' },
  { bookNumber: 31, bookName: 'Obadiah', testament: 'OLD' },
  { bookNumber: 32, bookName: 'Jonah', testament: 'OLD' },
  { bookNumber: 33, bookName: 'Micah', testament: 'OLD' },
  { bookNumber: 34, bookName: 'Nahum', testament: 'OLD' },
  { bookNumber: 35, bookName: 'Habakkuk', testament: 'OLD' },
  { bookNumber: 36, bookName: 'Zephaniah', testament: 'OLD' },
  { bookNumber: 37, bookName: 'Haggai', testament: 'OLD' },
  { bookNumber: 38, bookName: 'Zechariah', testament: 'OLD' },
  { bookNumber: 39, bookName: 'Malachi', testament: 'OLD' },
  // New Testament (40–66)
  { bookNumber: 40, bookName: 'Matthew', testament: 'NEW' },
  { bookNumber: 41, bookName: 'Mark', testament: 'NEW' },
  { bookNumber: 42, bookName: 'Luke', testament: 'NEW' },
  { bookNumber: 43, bookName: 'John', testament: 'NEW' },
  { bookNumber: 44, bookName: 'Acts', testament: 'NEW' },
  { bookNumber: 45, bookName: 'Romans', testament: 'NEW' },
  { bookNumber: 46, bookName: '1 Corinthians', testament: 'NEW' },
  { bookNumber: 47, bookName: '2 Corinthians', testament: 'NEW' },
  { bookNumber: 48, bookName: 'Galatians', testament: 'NEW' },
  { bookNumber: 49, bookName: 'Ephesians', testament: 'NEW' },
  { bookNumber: 50, bookName: 'Philippians', testament: 'NEW' },
  { bookNumber: 51, bookName: 'Colossians', testament: 'NEW' },
  { bookNumber: 52, bookName: '1 Thessalonians', testament: 'NEW' },
  { bookNumber: 53, bookName: '2 Thessalonians', testament: 'NEW' },
  { bookNumber: 54, bookName: '1 Timothy', testament: 'NEW' },
  { bookNumber: 55, bookName: '2 Timothy', testament: 'NEW' },
  { bookNumber: 56, bookName: 'Titus', testament: 'NEW' },
  { bookNumber: 57, bookName: 'Philemon', testament: 'NEW' },
  { bookNumber: 58, bookName: 'Hebrews', testament: 'NEW' },
  { bookNumber: 59, bookName: 'James', testament: 'NEW' },
  { bookNumber: 60, bookName: '1 Peter', testament: 'NEW' },
  { bookNumber: 61, bookName: '2 Peter', testament: 'NEW' },
  { bookNumber: 62, bookName: '1 John', testament: 'NEW' },
  { bookNumber: 63, bookName: '2 John', testament: 'NEW' },
  { bookNumber: 64, bookName: '3 John', testament: 'NEW' },
  { bookNumber: 65, bookName: 'Jude', testament: 'NEW' },
  { bookNumber: 66, bookName: 'Revelation', testament: 'NEW' },
];

interface ParsedVerse {
  verseId: number;
  testament: 'OLD' | 'NEW';
  bookNumber: number;
  bookName: string;
  chapter: number;
  verse: number;
  text: string;
}

async function getPg10Text(): Promise<string> {
  try {
    const cached = await fs.readFile(CACHE_PATH, 'utf8');
    console.log(`Loaded cached pg10.txt from ${CACHE_PATH}`);
    return cached;
  } catch {
    console.log(`Downloading KJV text from ${PG10_URL}...`);
    const res = await fetch(PG10_URL, {
      headers: { 'User-Agent': 'KJV-Verse-Arena-Seeder/1.0' },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch pg10.txt: ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fs.writeFile(CACHE_PATH, text, 'utf8');
    console.log(`Saved local copy to ${CACHE_PATH}`);
    return text;
  }
}

function parsePg10(rawText: string): ParsedVerse[] {
  const clean = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  const genesisStart = clean.indexOf('1:1 In the beginning God created the heaven and the earth.');
  if (genesisStart === -1) {
    throw new Error('Could not locate Genesis 1:1 in pg10.txt');
  }

  const footerStart = clean.indexOf('*** END OF THE PROJECT GUTENBERG EBOOK', genesisStart);
  const body = footerStart !== -1 ? clean.slice(genesisStart, footerStart) : clean.slice(genesisStart);

  // Match chapter:verse markers both at the start of lines AND inline mid-paragraph
  const markerRe = /(?:^|\s)(\d+):(\d+)\s+/g;
  const markers: Array<{ chapter: number; verse: number; textStart: number; matchStart: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(body)) !== null) {
    const leadingSpaceLen = m[0].startsWith(m[1]) ? 0 : 1;
    markers.push({
      chapter: parseInt(m[1], 10),
      verse: parseInt(m[2], 10),
      matchStart: m.index + leadingSpaceLen,
      textStart: m.index + m[0].length,
    });
  }

  const verses: ParsedVerse[] = [];
  let bookIdx = -1;
  let prevChapter = 0;
  let prevVerse = 0;

  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    const nextStart = i + 1 < markers.length ? markers[i + 1].matchStart : body.length;
    let rawVerseText = body.slice(cur.textStart, nextStart);

    // Every book starts at 1:1
    if (cur.chapter === 1 && cur.verse === 1) {
      bookIdx++;
      if (bookIdx >= CANONICAL_BOOKS.length) {
        throw new Error(`Unexpected extra 1:1 marker beyond Revelation at offset ${cur.matchStart}`);
      }
      prevChapter = 1;
      prevVerse = 0;
    }

    // Verify strict monotonic progression within the current book
    const isNextVerseInChapter = cur.chapter === prevChapter && cur.verse === prevVerse + 1;
    const isFirstVerseOfNextChapter = cur.chapter === prevChapter + 1 && cur.verse === 1;
    if (!isNextVerseInChapter && !isFirstVerseOfNextChapter) {
      throw new Error(
        `Non-sequential verse in ${CANONICAL_BOOKS[bookIdx]?.bookName}: ` +
          `got ${cur.chapter}:${cur.verse} after ${prevChapter}:${prevVerse}`
      );
    }

    // Before the next book's 1:1, strip multi-blank-line book headings and KJV epistle colophons
    const nextIsNewBook = i + 1 < markers.length && markers[i + 1].chapter === 1 && markers[i + 1].verse === 1;
    if (nextIsNewBook || i === markers.length - 1) {
      rawVerseText = rawVerseText.split(/\n{3,}/)[0];
      const paragraphs = rawVerseText.split(/\n{2,}/);
      if (
        paragraphs.length > 1 &&
        /^(?:Written to |The (?:first|second) epistle )/i.test(paragraphs[paragraphs.length - 1].trim())
      ) {
        paragraphs.pop();
      }
      rawVerseText = paragraphs.join(' ');
    }

    const cleanedText = rawVerseText.replace(/\s+/g, ' ').trim();
    if (!cleanedText) {
      throw new Error(`Empty text for ${CANONICAL_BOOKS[bookIdx].bookName} ${cur.chapter}:${cur.verse}`);
    }

    const book = CANONICAL_BOOKS[bookIdx];
    verses.push({
      verseId: verses.length + 1,
      testament: book.testament,
      bookNumber: book.bookNumber,
      bookName: book.bookName,
      chapter: cur.chapter,
      verse: cur.verse,
      text: cleanedText,
    });

    prevChapter = cur.chapter;
    prevVerse = cur.verse;
  }

  if (bookIdx !== 65) {
    throw new Error(`Expected 66 books (index 65), parsed up to index ${bookIdx}`);
  }
  if (verses.length !== 31102) {
    throw new Error(`Expected exactly 31,102 verses, but parsed ${verses.length}`);
  }

  const otCount = verses.filter((v) => v.testament === 'OLD').length;
  const ntCount = verses.filter((v) => v.testament === 'NEW').length;
  if (otCount !== 23145 || ntCount !== 7957) {
    throw new Error(`Unexpected testament split: OT=${otCount}, NT=${ntCount}`);
  }

  return verses;
}

async function seedDatabase(verses: ParsedVerse[]) {
  const BATCH_SIZE = 1000;

  await withTransaction(async (tx) => {
    for (let i = 0; i < verses.length; i += BATCH_SIZE) {
      const chunk = verses.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      chunk.forEach((v, idx) => {
        const base = idx * 7;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
        );
        values.push(v.verseId, v.testament, v.bookNumber, v.bookName, v.chapter, v.verse, v.text);
      });

      await tx.query(
        `INSERT INTO kjv_verses (verse_id, testament, book_number, book_name, chapter, verse, text)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (verse_id) DO UPDATE SET
           testament = EXCLUDED.testament,
           book_number = EXCLUDED.book_number,
           book_name = EXCLUDED.book_name,
           chapter = EXCLUDED.chapter,
           verse = EXCLUDED.verse,
           text = EXCLUDED.text`,
        values
      );
    }
  });
}

async function main() {
  try {
    const rawText = await getPg10Text();
    const verses = parsePg10(rawText);

    console.log(
      `Verified ${verses.length.toLocaleString()} verses across 66 books ` +
        `(${verses[0].bookName} 1:1 -> ${verses.at(-1)!.bookName} 22:21).`
    );

    console.log('Inserting into PostgreSQL...');
    await seedDatabase(verses);
    console.log('Successfully seeded kjv_verses (including GIN full-text search vectors).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('KJV Seeding failed:', err);
  process.exit(1);
});