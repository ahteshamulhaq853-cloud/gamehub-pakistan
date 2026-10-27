CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 points INTEGER NOT NULL DEFAULT 1000,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rounds (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 period_seconds INTEGER NOT NULL,
 round_no INTEGER NOT NULL,
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 result_number INTEGER,
 result_color TEXT,
 UNIQUE(period_seconds, round_no)
);
CREATE TABLE IF NOT EXISTS bets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 round_id INTEGER NOT NULL REFERENCES rounds(id),
 choice TEXT NOT NULL,
 stake INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 payout INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bets_round_idx ON bets(round_id);
CREATE INDEX IF NOT EXISTS bets_user_idx ON bets(user_id, id);

CREATE TABLE IF NOT EXISTS payment_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 type TEXT NOT NULL CHECK(type IN ('deposit','withdrawal')),
 provider TEXT NOT NULL CHECK(provider IN ('Easypaisa','JazzCash')),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 100000),
 transaction_reference TEXT,
 account_number TEXT,
 account_name TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','approved','rejected')),
 admin_note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS payment_requests_user_idx ON payment_requests(user_id,id);
CREATE INDEX IF NOT EXISTS payment_requests_status_idx ON payment_requests(status,id);
