-- MATCH (official spec "MATCH / DRAFT MATCH v2.0", decisions 68-74, docs/11-match-plan.md)

-- owned cards: strengthening level (decision 70), favourite mark (decision 73) and the
-- starter cards (decision 72) as a source; rebuilt to change the CHECK constraint
-- (same pattern as 0004 / 0007; the Collection Draft roster rows referencing it are kept)
PRAGMA defer_foreign_keys = true;
CREATE TABLE user_collections_backup AS SELECT * FROM user_collections;
DROP TABLE user_collections;
CREATE TABLE user_collections (
  user_id TEXT NOT NULL REFERENCES users(id),
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  source TEXT NOT NULL CHECK (source IN ('gacha', 'exchange', 'test_grant', 'season_pass', 'starter')),
  source_ref TEXT,
  obtained_at INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  PRIMARY KEY (user_id, player_id)
);
INSERT INTO user_collections (user_id, player_id, source, source_ref, obtained_at)
  SELECT user_id, player_id, source, source_ref, obtained_at FROM user_collections_backup;
DROP TABLE user_collections_backup;
CREATE INDEX idx_user_collections_user ON user_collections(user_id, obtained_at);

-- the level a gacha duplicate brought a card to (null = new card or exchange points)
ALTER TABLE gacha_history ADD COLUMN enhanced_to INTEGER;

-- rooms: MATCH (and DRAFT MATCH, next step) as modes
CREATE TABLE rooms_backup AS SELECT * FROM rooms;
DROP TABLE rooms;
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('quick', 'private', 'ranked', 'solo', 'event', 'collection', 'match', 'draft_match')),
  status TEXT NOT NULL CHECK (status IN ('lobby', 'drafting', 'lineup', 'playing', 'finished', 'closed')),
  host_user_id TEXT REFERENCES users(id),
  settings_json TEXT NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 0,
  environment TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  event_id TEXT REFERENCES events(id),
  challenge_id TEXT
);
INSERT INTO rooms (id, code, mode, status, host_user_id, settings_json, member_count, environment, created_at, started_at, finished_at, event_id, challenge_id)
  SELECT id, code, mode, status, host_user_id, settings_json, member_count, environment, created_at, started_at, finished_at, event_id, challenge_id FROM rooms_backup;
DROP TABLE rooms_backup;
CREATE INDEX idx_rooms_open ON rooms(mode, status, created_at);
CREATE INDEX idx_rooms_event ON rooms(event_id, status);

-- the teams of a player (decision 73: 3 saved teams, one of them used in MATCH)
CREATE TABLE user_squads (
  user_id TEXT NOT NULL REFERENCES users(id),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  name TEXT NOT NULL,
  lineup_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot)
);
CREATE TABLE user_squad_active (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  updated_at INTEGER NOT NULL
);

-- missions that need the draft modes are replaced by MATCH missions (decision 68)
UPDATE missions SET active = 0 WHERE id IN ('d-picks', 'w-competitive', 'b-ranked', 'b-solo', 'b-collection');
INSERT INTO missions (id, period, metric, target, reward_currency, reward_amount, title_ja, sort_order) VALUES
  ('d-goals', 'daily', 'goal_scored', 5, 'COINS', 100, '試合で5得点する', 3),
  ('w-wins', 'weekly', 'match_won', 10, 'COINS', 500, '試合で10勝する', 13),
  ('b-team', 'beginner', 'squad_saved', 1, 'GEMS_FREE', 50, 'チームを編成して保存する', 23),
  ('b-enhance', 'beginner', 'card_enhanced', 1, 'GEMS_FREE', 50, '選手を強化する（重複カード）', 24),
  ('b-match3', 'beginner', 'league_completed', 3, 'GEMS_FREE', 50, 'MATCH を3回完走する', 26);
