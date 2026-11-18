ALTER TABLE arena_matches ADD COLUMN opening_trials INTEGER;
--> statement-breakpoint
ALTER TABLE arena_matches ADD COLUMN opening_blue_wins INTEGER NOT NULL DEFAULT 0;
