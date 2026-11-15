export type UserRole = 'PLAYER' | 'MODERATOR' | 'ADMIN';
export type UserStatus = 'PENDING_APPROVAL' | 'AWAITING_PASSWORD' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type RoundStatus = 'REGISTRATION_OPEN' | 'BETTING_OPEN' | 'SETTLING' | 'COMPLETED';

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  suspendedUntil: string | null;
  walletBalance: number; // In Shekels
  createdAt: string;
}
export interface ActiveRoundState {
  serverTimeUtc: string;
  round: {
    id: number;
    roundDate: string;
    status: RoundStatus;
    registrationOpensAt: string;
    bettingOpensAt: string;
    bettingClosesAt: string;
    registeredCount: number;
    maxVersesPerPlayer: number | null;
    totalPot: number;
    minSegmentLength: number;
    maxSegmentLength: number;
    minSegments: number;
    maxSegments: number;
    maxRegisteredPlayers: number | null;
    minStakePerVerse: number;
  };
  playerState: {
    isRegistered: boolean;
    submissionCount: 0 | 1 | 2;
    activeBets: BetSegment[];
  };
}

export interface AdminGameConfigResponse {
  defaultConfig: {
    defaultOpenTime: string;
    defaultCloseTime: string;
    minSegmentLength: number;
    maxSegmentLength: number;
    minSegments: number;
    maxSegments: number;
    maxRegisteredPlayers: number | null;
    minStakePerVerse: number;
    pendingNextOpensAt: string | null;
    pendingNextClosesAt: string | null;
  };
  activeRound: {
    id: number;
    roundDate: string;
    status: RoundStatus;
    isLocked: boolean;
    registeredCount: number;
    bettingOpensAt: string;
    bettingClosesAt: string;
    minSegmentLength: number;
    maxSegmentLength: number;
    minSegments: number;
    maxSegments: number;
    maxRegisteredPlayers: number | null;
    minStakePerVerse: number;
  } | null;
}

export interface KjvVerse {
  verseId: number; // 1..31102
  testament: 'OLD' | 'NEW';
  bookNumber: number;
  bookName: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface BetSegment {
  id?: string;
  startVerseId: number;
  endVerseId: number;
  startLabel?: string; // e.g., "Genesis 1:1"
  endLabel?: string;   // e.g., "Genesis 1:5"
  verseLength: number;
  stake: number;
  outcome?: 'PENDING' | 'WON' | 'COLLIDED' | 'REFUNDED';
  payout?: number;
}

export interface AutoSelectRequest {
  testament?: 'OLD' | 'NEW';
  bookNumbers?: number[];
  customRange?: [number, number];
  segmentCount: number; // 1..5
  totalLength: number;
}

export interface LedgerEntry {
  id: number;
  roundId: number | null;
  entryType: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
}

export interface WeeklyStatsResponse {
  weekStartDate: string;
  weekEndDate: string;
  totalRoundsSettled: number;
  totalShekelsWagered: number;
  mostContestedBooks: { bookName: string; collisionCount: number }[];
  topWinners: { username: string; netShekelsWon: number; survivingSegments: number }[];
}

export interface KjvBookMeta {
  bookNumber: number;
  bookName: string;
  testament: 'OLD' | 'NEW';
  chapterCount: number;
  startVerseId: number;
  endVerseId: number;
}