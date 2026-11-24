#!/usr/bin/env bash
set -euo pipefail

# Configurable via environment variables (defaults shown)
DB_NAME="${DB_NAME:-kjv_game_dev}"
DB_USER="${DB_USER:-kjv_game_dev_user}"
DB_PASS="${DB_PASS:-cascodeTest2026}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

echo "=== KJV Verse Arena: PostgreSQL Database Initialization ==="
echo "Target: postgres://${DB_USER}:****@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# Ensure PostgreSQL service is running
if ! sudo systemctl is-active --quiet postgresql; then
  echo "Starting PostgreSQL service..."
  sudo systemctl start postgresql
fi

# Stage 1: Superuser bootstrap (role, database, extensions, schema ownership)
echo "[1/2] Configuring database role, extensions, and schema ownership..."
sudo -u postgres psql -p "$DB_PORT" -v ON_ERROR_STOP=1 <<EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';
  ELSE
    ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec

ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
EOF

sudo -u postgres psql -p "$DB_PORT" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<EOF
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER SCHEMA public OWNER TO ${DB_USER};
GRANT ALL ON SCHEMA public TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${DB_USER};
EOF

# Stage 2: Application schema executed directly as $DB_USER over TCP
# Note: All monetary values are stored in atomic Gerahs (20 Gerahs = 1 Shekel).
echo "[2/2] Creating tables, constraints, indexes, and default game configuration..."
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'EOF'
-- 1. Static KJV Reference Table (31,102 verses)
CREATE TABLE IF NOT EXISTS kjv_verses (
    verse_id      INT PRIMARY KEY CHECK (verse_id BETWEEN 1 AND 31102),
    testament     VARCHAR(3) NOT NULL CHECK (testament IN ('OLD', 'NEW')),
    book_number   SMALLINT NOT NULL CHECK (book_number BETWEEN 1 AND 66),
    book_name     VARCHAR(32) NOT NULL,
    chapter       SMALLINT NOT NULL,
    verse         SMALLINT NOT NULL,
    text          TEXT NOT NULL,
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);

CREATE INDEX IF NOT EXISTS idx_kjv_book_chap ON kjv_verses (book_number, chapter, verse);
CREATE INDEX IF NOT EXISTS idx_kjv_fts ON kjv_verses USING GIN (search_vector);

-- 2. Users, Roles & Password Activation State (wallet_balance in Gerahs)
CREATE TABLE IF NOT EXISTS users (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username         VARCHAR(40) UNIQUE NOT NULL,
    email            VARCHAR(255) UNIQUE NOT NULL,
    password_hash    TEXT,
    role             VARCHAR(16) NOT NULL DEFAULT 'PLAYER'
                     CHECK (role IN ('PLAYER', 'MODERATOR', 'ADMIN')),
    status           VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
                     CHECK (status IN (
                         'PENDING_APPROVAL',
                         'AWAITING_PASSWORD',
                         'ACTIVE',
                         'SUSPENDED',
                         'DEACTIVATED'
                     )),
    suspended_until  TIMESTAMPTZ,
    max_bet_override BIGINT,
    wallet_balance   BIGINT NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
    approved_by      UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    initial_grant    BIGINT NOT NULL DEFAULT 2000 CHECK (initial_grant >= 0),
    auto_register    BOOLEAN NOT NULL DEFAULT FALSE
);

-- 3. Active HTTP Cookie Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id          VARCHAR(64) PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- 4. Single-Use Tokens for Post-Approval Password Setup & Resets
CREATE TABLE IF NOT EXISTS account_tokens (
    token_hash  VARCHAR(64) PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     VARCHAR(20) NOT NULL CHECK (purpose IN ('SET_PASSWORD', 'RESET_PASSWORD')),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);

-- 5. Persistent Admin Game Rules, Schedule & Running Jackpot Singleton
-- min_stake_per_verse defaults to 20 Gerahs (1 Shekel); jackpot_balance stored in Gerahs
CREATE TABLE IF NOT EXISTS game_config (
    id                       INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    default_open_time        VARCHAR(5) NOT NULL DEFAULT '08:00',
    default_close_time       VARCHAR(5) NOT NULL DEFAULT '20:00',
    min_segment_length       INT NOT NULL DEFAULT 3 CHECK (min_segment_length >= 1),
    max_segment_length       INT NOT NULL DEFAULT 100 CHECK (max_segment_length >= min_segment_length AND max_segment_length <= 31102),
    min_segments             INT NOT NULL DEFAULT 1 CHECK (min_segments >= 1),
    max_segments             INT NOT NULL DEFAULT 5 CHECK (max_segments >= min_segments AND max_segments <= 50),
    max_registered_players   INT CHECK (max_registered_players IS NULL OR max_registered_players >= 1),
    min_stake_per_verse      INT NOT NULL DEFAULT 20 CHECK (min_stake_per_verse >= 1),
    jackpot_balance          BIGINT NOT NULL DEFAULT 0 CHECK (jackpot_balance >= 0),
    jackpot_start_verse_id   INT NOT NULL DEFAULT -1,
    jackpot_end_verse_id     INT NOT NULL DEFAULT -1,
    pending_next_opens_at    TIMESTAMPTZ,
    pending_next_closes_at   TIMESTAMPTZ,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO game_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 6. Daily Rounds (Snapshotted Rules + State Machine; total_pot & min_stake_per_verse in Gerahs)
CREATE TABLE IF NOT EXISTS rounds (
    id                      SERIAL PRIMARY KEY,
    round_date              DATE UNIQUE NOT NULL,
    status                  VARCHAR(20) NOT NULL
                            CHECK (status IN ('REGISTRATION_OPEN', 'BETTING_OPEN', 'SETTLING', 'COMPLETED')),
    registration_opens_at   TIMESTAMPTZ NOT NULL,
    betting_opens_at        TIMESTAMPTZ NOT NULL,
    betting_closes_at       TIMESTAMPTZ NOT NULL,
    registered_count        INT NOT NULL DEFAULT 0,
    max_verses_per_player   INT,
    total_pot               BIGINT NOT NULL DEFAULT 0,
    payout_formula_version  VARCHAR(16) NOT NULL DEFAULT 'v1',
    min_segment_length      INT NOT NULL DEFAULT 3,
    max_segment_length      INT NOT NULL DEFAULT 100,
    min_segments            INT NOT NULL DEFAULT 1,
    max_segments            INT NOT NULL DEFAULT 5,
    max_registered_players  INT,
    min_stake_per_verse     INT NOT NULL DEFAULT 20,
    start_book              INT NOT NULL DEFAULT 1,
    end_book                INT NOT NULL DEFAULT 66
);

-- 7. Round Registrations & 1-Edit Submission Counter
CREATE TABLE IF NOT EXISTS round_registrations (
    round_id          INT NOT NULL REFERENCES rounds(id),
    user_id           UUID NOT NULL REFERENCES users(id),
    submission_count  SMALLINT NOT NULL DEFAULT 0 CHECK (submission_count BETWEEN 0 AND 2),
    registered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_submitted_at TIMESTAMPTZ,
    PRIMARY KEY (round_id, user_id)
);

-- 8. Player Bets (Segments with Self-Overlap Exclusion; stake & payout in Gerahs)
CREATE TABLE IF NOT EXISTS bets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id         INT NOT NULL REFERENCES rounds(id),
    user_id          UUID NOT NULL REFERENCES users(id),
    start_verse_id   INT NOT NULL REFERENCES kjv_verses(verse_id),
    end_verse_id     INT NOT NULL REFERENCES kjv_verses(verse_id),
    verse_range      INT4RANGE GENERATED ALWAYS AS (int4range(start_verse_id, end_verse_id, '[]')) STORED,
    verse_length     INT GENERATED ALWAYS AS (end_verse_id - start_verse_id + 1) STORED,
    stake            BIGINT NOT NULL CHECK (stake > 0),
    outcome          VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                     CHECK (outcome IN ('PENDING', 'WON', 'COLLIDED', 'REFUNDED')),
    payout           BIGINT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_segment_length CHECK (end_verse_id >= start_verse_id),
    CONSTRAINT fk_registered_player FOREIGN KEY (round_id, user_id)
        REFERENCES round_registrations(round_id, user_id),
    CONSTRAINT excl_self_overlap EXCLUDE USING GIST (
        round_id WITH =,
        user_id WITH =,
        verse_range WITH &&
    )
);

CREATE INDEX IF NOT EXISTS idx_bets_round ON bets (round_id);

-- 9. Immutable Double-Entry Player Gerah Ledger
CREATE TABLE IF NOT EXISTS wallet_ledger (
    id             BIGSERIAL PRIMARY KEY,
    user_id        UUID NOT NULL REFERENCES users(id),
    round_id       INT REFERENCES rounds(id),
    bet_id         UUID REFERENCES bets(id) ON DELETE SET NULL,
    entry_type     VARCHAR(28) NOT NULL
                   CHECK (entry_type IN (
                       'INITIAL_GRANT',
                       'SLIP_STAKE',
                       'SLIP_EDIT_REFUND',
                       'ROUND_WINNING',
                       'ROUND_NO_WINNER_REFUND',
                       'JACKPOT_WINNING',
                       'ADMIN_ADJUSTMENT'
                   )),
    amount         BIGINT NOT NULL,
    balance_after  BIGINT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON wallet_ledger (user_id, id DESC);

-- 10. Immutable Running Jackpot Gerah Ledger
CREATE TABLE IF NOT EXISTS jackpot_ledger (
    id             BIGSERIAL PRIMARY KEY,
    round_id       INT REFERENCES rounds(id),
    user_id        UUID REFERENCES users(id),
    entry_type     VARCHAR(24) NOT NULL
                   CHECK (entry_type IN ('ROUND_DUST', 'JACKPOT_PAYOUT', 'ADMIN_ADJUSTMENT')),
    amount         BIGINT NOT NULL,
    balance_after  BIGINT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jackpot_ledger_round ON jackpot_ledger (round_id);
EOF

echo ""
echo "Database initialization complete!"
echo "Add this connection string to backend/.env:"
echo "  DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo ""
echo "Next steps inside backend/:"
echo "  1. npm run seed:kjv"
echo "  2. npm run create:admin <username> <email> <password>"