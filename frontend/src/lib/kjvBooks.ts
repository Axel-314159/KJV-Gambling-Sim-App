export interface KjvBookMeta {
  bookNumber: number;
  name: string;
  verses: number;
}

export const KJV_BOOKS: readonly KjvBookMeta[] = [
  { bookNumber: 1, name: 'Genesis', verses: 1533 },
  { bookNumber: 2, name: 'Exodus', verses: 1213 },
  { bookNumber: 3, name: 'Leviticus', verses: 859 },
  { bookNumber: 4, name: 'Numbers', verses: 1288 },
  { bookNumber: 5, name: 'Deuteronomy', verses: 959 },
  { bookNumber: 6, name: 'Joshua', verses: 658 },
  { bookNumber: 7, name: 'Judges', verses: 618 },
  { bookNumber: 8, name: 'Ruth', verses: 85 },
  { bookNumber: 9, name: '1 Samuel', verses: 810 },
  { bookNumber: 10, name: '2 Samuel', verses: 695 },
  { bookNumber: 11, name: '1 Kings', verses: 816 },
  { bookNumber: 12, name: '2 Kings', verses: 719 },
  { bookNumber: 13, name: '1 Chronicles', verses: 942 },
  { bookNumber: 14, name: '2 Chronicles', verses: 822 },
  { bookNumber: 15, name: 'Ezra', verses: 280 },
  { bookNumber: 16, name: 'Nehemiah', verses: 406 },
  { bookNumber: 17, name: 'Esther', verses: 167 },
  { bookNumber: 18, name: 'Job', verses: 1070 },
  { bookNumber: 19, name: 'Psalms', verses: 2461 },
  { bookNumber: 20, name: 'Proverbs', verses: 915 },
  { bookNumber: 21, name: 'Ecclesiastes', verses: 222 },
  { bookNumber: 22, name: 'Song of Solomon', verses: 117 },
  { bookNumber: 23, name: 'Isaiah', verses: 1292 },
  { bookNumber: 24, name: 'Jeremiah', verses: 1364 },
  { bookNumber: 25, name: 'Lamentations', verses: 154 },
  { bookNumber: 26, name: 'Ezekiel', verses: 1273 },
  { bookNumber: 27, name: 'Daniel', verses: 357 },
  { bookNumber: 28, name: 'Hosea', verses: 197 },
  { bookNumber: 29, name: 'Joel', verses: 73 },
  { bookNumber: 30, name: 'Amos', verses: 146 },
  { bookNumber: 31, name: 'Obadiah', verses: 21 },
  { bookNumber: 32, name: 'Jonah', verses: 48 },
  { bookNumber: 33, name: 'Micah', verses: 105 },
  { bookNumber: 34, name: 'Nahum', verses: 47 },
  { bookNumber: 35, name: 'Habakkuk', verses: 56 },
  { bookNumber: 36, name: 'Zephaniah', verses: 53 },
  { bookNumber: 37, name: 'Haggai', verses: 38 },
  { bookNumber: 38, name: 'Zechariah', verses: 211 },
  { bookNumber: 39, name: 'Malachi', verses: 55 },
  { bookNumber: 40, name: 'Matthew', verses: 1071 },
  { bookNumber: 41, name: 'Mark', verses: 678 },
  { bookNumber: 42, name: 'Luke', verses: 1151 },
  { bookNumber: 43, name: 'John', verses: 879 },
  { bookNumber: 44, name: 'Acts', verses: 1007 },
  { bookNumber: 45, name: 'Romans', verses: 433 },
  { bookNumber: 46, name: '1 Corinthians', verses: 437 },
  { bookNumber: 47, name: '2 Corinthians', verses: 257 },
  { bookNumber: 48, name: 'Galatians', verses: 149 },
  { bookNumber: 49, name: 'Ephesians', verses: 155 },
  { bookNumber: 50, name: 'Philippians', verses: 104 },
  { bookNumber: 51, name: 'Colossians', verses: 95 },
  { bookNumber: 52, name: '1 Thessalonians', verses: 89 },
  { bookNumber: 53, name: '2 Thessalonians', verses: 47 },
  { bookNumber: 54, name: '1 Timothy', verses: 113 },
  { bookNumber: 55, name: '2 Timothy', verses: 83 },
  { bookNumber: 56, name: 'Titus', verses: 46 },
  { bookNumber: 57, name: 'Philemon', verses: 25 },
  { bookNumber: 58, name: 'Hebrews', verses: 303 },
  { bookNumber: 59, name: 'James', verses: 108 },
  { bookNumber: 60, name: '1 Peter', verses: 105 },
  { bookNumber: 61, name: '2 Peter', verses: 61 },
  { bookNumber: 62, name: '1 John', verses: 105 },
  { bookNumber: 63, name: '2 John', verses: 13 },
  { bookNumber: 64, name: '3 John', verses: 14 },
  { bookNumber: 65, name: 'Jude', verses: 25 },
  { bookNumber: 66, name: 'Revelation', verses: 404 },
];

function resolveBookNumber(book: number | string | null | undefined, fallback: number): number {
  if (typeof book === 'number' && Number.isFinite(book)) {
    return Math.min(66, Math.max(1, Math.trunc(book)));
  }
  if (typeof book === 'string') {
    const trimmed = book.trim();
    if (/^\d+$/.test(trimmed)) {
      return Math.min(66, Math.max(1, Number(trimmed)));
    }
    const lower = trimmed.toLowerCase();
    if (lower === 'psalm') return 19;
    if (lower === 'song of songs') return 22;

    const match = KJV_BOOKS.find((b) => b.name.toLowerCase() === lower);
    if (match) return match.bookNumber;
  }
  return fallback;
}

export function getBookRangeSummary(
  startBook?: number | string | null,
  endBook?: number | string | null
): {
  startBookNumber: number;
  endBookNumber: number;
  startBookName: string;
  endBookName: string;
  rangeLabel: string;
  availableVerses: number;
} {
  const rawStart = resolveBookNumber(startBook, 1);
  const rawEnd = resolveBookNumber(endBook, 66);
  const startBookNumber = Math.min(rawStart, rawEnd);
  const endBookNumber = Math.max(rawStart, rawEnd);

  const booksInRange = KJV_BOOKS.filter(
    (b) => b.bookNumber >= startBookNumber && b.bookNumber <= endBookNumber
  );

  const startBookName = booksInRange[0]?.name ?? 'Genesis';
  const endBookName = booksInRange[booksInRange.length - 1]?.name ?? 'Revelation';
  const availableVerses = booksInRange.reduce((sum, b) => sum + b.verses, 0);
  const rangeLabel =
    startBookNumber === endBookNumber ? startBookName : `${startBookName} – ${endBookName}`;

  return {
    startBookNumber,
    endBookNumber,
    startBookName,
    endBookName,
    rangeLabel,
    availableVerses,
  };
}