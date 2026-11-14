-- Phase 7 (beta test): decisions 60-67, docs/10-phase7-plan.md

-- server settings changed from the admin site (draft timer comparison, decision 66)
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT REFERENCES admin_users(id),
  updated_at INTEGER NOT NULL
);
INSERT INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('draft_timer', '{"mode":"compare","variants":[8,12]}', NULL, 1794614400000);

-- optional rating after a league (decision 65): once per Japan day and per room
CREATE TABLE league_ratings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  day_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  pick_seconds INTEGER,
  formation TEXT,
  final_rank INTEGER,
  draft_fun INTEGER NOT NULL CHECK (draft_fun BETWEEN 1 AND 5),
  result_fair INTEGER NOT NULL CHECK (result_fair BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, day_key),
  UNIQUE (user_id, room_id)
);
CREATE INDEX idx_league_ratings_day ON league_ratings(day_key);

-- test data resets (decision 67): one run = the players chosen at once, reset in small steps
CREATE TABLE test_reset_runs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  target_json TEXT NOT NULL,
  note TEXT,
  total INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'completed')),
  environment TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE test_resets (
  run_id TEXT NOT NULL REFERENCES test_reset_runs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  done_at INTEGER,
  summary_json TEXT,
  PRIMARY KEY (run_id, user_id)
);
CREATE INDEX idx_test_resets_user ON test_resets(user_id, done_at);

-- accounts made by the Staging check are Developer accounts (decision 60)
INSERT OR IGNORE INTO user_tags (user_id, tag, created_at)
  SELECT id, 'developer', created_at FROM users WHERE username LIKE 'check\_%' ESCAPE '\';
DELETE FROM user_tags WHERE tag = 'normal' AND user_id IN (SELECT id FROM users WHERE username LIKE 'check\_%' ESCAPE '\');

-- match and draft statistics (admin Matches / Draft Analytics)
CREATE INDEX idx_drafts_started ON drafts(started_at);
CREATE INDEX idx_matches_created ON matches(created_at);
CREATE INDEX idx_draft_picks_player ON draft_picks(player_id);

-- activity no longer counts events the player did not cause (distributions,
-- test grants, refunds, renewals, season rewards, resets): rebuild the summaries
DELETE FROM daily_user_metrics;
DELETE FROM metrics_days;
