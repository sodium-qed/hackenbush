CREATE TABLE IF NOT EXISTS arena_players (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  green_rating INTEGER NOT NULL DEFAULT 1200,
  redblue_rating INTEGER NOT NULL DEFAULT 1200,
  match_id TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS arena_players_match ON arena_players (match_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS arena_waiting (
  player_id TEXT PRIMARY KEY NOT NULL REFERENCES arena_players (id),
  ticket TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('queue', 'room')),
  variant TEXT NOT NULL CHECK (variant IN ('green', 'redblue')),
  rating INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  code TEXT UNIQUE,
  CHECK ((kind = 'room') = (code IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS arena_waiting_pool ON arena_waiting (kind, variant, rating);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS arena_waiting_expiry ON arena_waiting (expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS arena_matches (
  id TEXT PRIMARY KEY NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('green', 'redblue')),
  rated INTEGER NOT NULL CHECK (rated IN (0, 1)),
  room_code TEXT,
  seed TEXT NOT NULL,
  board_version INTEGER NOT NULL,
  first_side TEXT NOT NULL CHECK (first_side IN ('blue', 'red')),
  blue_id TEXT NOT NULL REFERENCES arena_players (id),
  red_id TEXT NOT NULL REFERENCES arena_players (id),
  blue_name TEXT NOT NULL,
  red_name TEXT NOT NULL,
  blue_rating INTEGER NOT NULL,
  red_rating INTEGER NOT NULL,
  moves TEXT NOT NULL DEFAULT '[]',
  live TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('blue', 'red')),
  version INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  turn_starts_at INTEGER,
  deadline INTEGER,
  winner TEXT CHECK (winner IN ('blue', 'red')),
  reason TEXT CHECK (reason IN ('no-moves', 'timeout', 'resign')),
  blue_delta INTEGER NOT NULL DEFAULT 0,
  CHECK (blue_id <> red_id),
  CHECK ((rated = 0) = (room_code IS NOT NULL)),
  CHECK ((winner IS NULL) = (reason IS NULL)),
  CHECK ((winner IS NULL) = (deadline IS NOT NULL)),
  CHECK ((winner IS NULL) = (turn_starts_at IS NOT NULL))
);
