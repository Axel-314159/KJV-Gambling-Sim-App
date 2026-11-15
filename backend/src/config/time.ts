import { DateTime } from 'luxon';

export const GAME_TZ = 'America/New_York';
export const KJV_TOTAL_VERSES = 31102;

export function computeMaxVersesPerPlayer(registeredCount: number, minSegmentLength = 3): number {
  const m = Math.max(1, registeredCount);
  const raw = Math.floor((KJV_TOTAL_VERSES * 0.1) / m);
  return Math.max(minSegmentLength, Math.min(500, raw));
}

function parseHm(hm: string): { hour: number; minute: number } {
  const [h, m] = hm.split(':').map(Number);
  return { hour: h || 0, minute: m || 0 };
}

export function getScheduleForInstant(
  nowUtc: Date = new Date(),
  openHm = '08:00',
  closeHm = '20:00'
) {
  const ny = DateTime.fromJSDate(nowUtc, { zone: GAME_TZ });
  const openT = parseHm(openHm);
  const closeT = parseHm(closeHm);

  const todayClose = ny.set({ hour: closeT.hour, minute: closeT.minute, second: 0, millisecond: 0 });
  const roundDay = ny >= todayClose ? ny.plus({ days: 1 }).startOf('day') : ny.startOf('day');

  const registrationOpensAt = roundDay
    .minus({ days: 1 })
    .set({ hour: closeT.hour, minute: closeT.minute, second: 0, millisecond: 0 });
  const bettingOpensAt = roundDay.set({ hour: openT.hour, minute: openT.minute, second: 0, millisecond: 0 });
  const bettingClosesAt = roundDay.set({ hour: closeT.hour, minute: closeT.minute, second: 0, millisecond: 0 });

  const initialPhase = ny < bettingOpensAt ? 'REGISTRATION_OPEN' : 'BETTING_OPEN';

  return {
    roundDate: roundDay.toISODate()!,
    registrationOpensAt: registrationOpensAt.toUTC().toJSDate(),
    bettingOpensAt: bettingOpensAt.toUTC().toJSDate(),
    bettingClosesAt: bettingClosesAt.toUTC().toJSDate(),
    initialPhase: initialPhase as 'REGISTRATION_OPEN' | 'BETTING_OPEN',
  };
}