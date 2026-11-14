-- Phase 3: Ranked (rating, seasons, leaderboard), Solo Challenge, Special Events.
-- Decisions: docs/02-decisions.md 24-30. Rewards are not granted yet (Phase 4).

-- events (Special Events, created in the admin site)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  -- {"pool": PoolFilter}
  rules_json TEXT NOT NULL,
  created_by TEXT REFERENCES admin_users(id),
  updated_by TEXT REFERENCES admin_users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  archived_at INTEGER
);
CREATE INDEX idx_events_status ON events(status, ends_at);

-- rooms: new modes + links to event / challenge.
-- SQLite cannot change a CHECK constraint, so the table is rebuilt under the
-- same name: dropping it counts the referencing rows (room_members, drafts,
-- matches, ...) as deferred FK violations, and inserting the rows back into the
-- new "rooms" resolves them before the transaction commits.
PRAGMA defer_foreign_keys = true;
CREATE TABLE rooms_backup AS SELECT * FROM rooms;
DROP TABLE rooms;
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('quick', 'private', 'ranked', 'solo', 'event')),
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
INSERT INTO rooms (id, code, mode, status, host_user_id, settings_json, member_count, environment, created_at, started_at, finished_at)
  SELECT id, code, mode, status, host_user_id, settings_json, member_count, environment, created_at, started_at, finished_at FROM rooms_backup;
DROP TABLE rooms_backup;
CREATE INDEX idx_rooms_open ON rooms(mode, status, created_at);
CREATE INDEX idx_rooms_event ON rooms(event_id, status);

-- seasons: monthly, Japan time (id "YYYY-MM")
CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'finished')),
  finalized_at INTEGER,
  created_at INTEGER NOT NULL
);

-- current rating per season (a row exists once the player played a rated league)
CREATE TABLE ranked_ratings (
  season_id TEXT NOT NULL REFERENCES seasons(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL,
  initial_rating INTEGER NOT NULL,
  peak_rating INTEGER NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (season_id, user_id)
);
CREATE INDEX idx_ranked_ratings_board ON ranked_ratings(season_id, rating DESC);
CREATE INDEX idx_ranked_ratings_user ON ranked_ratings(user_id, season_id);

-- one row per human per ranked league; UNIQUE prevents applying a league twice
CREATE TABLE rating_changes (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  final_rank INTEGER NOT NULL,
  humans INTEGER NOT NULL,
  rated INTEGER NOT NULL,
  rating_before INTEGER NOT NULL,
  rating_after INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (room_id, user_id)
);
CREATE INDEX idx_rating_changes_user ON rating_changes(user_id, created_at);

-- final standings of a season (season rewards: recorded only until currencies exist)
CREATE TABLE season_results (
  season_id TEXT NOT NULL REFERENCES seasons(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  final_rating INTEGER NOT NULL,
  final_position INTEGER NOT NULL,
  games INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (season_id, user_id)
);

-- Solo Challenge: daily challenge definitions (generated from the date) and attempts
CREATE TABLE solo_challenges (
  id TEXT PRIMARY KEY,
  date_key TEXT NOT NULL UNIQUE,
  definition_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE solo_attempts (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES solo_challenges(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id),
  status TEXT NOT NULL CHECK (status IN ('playing', 'cleared', 'failed')),
  result_json TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX idx_solo_attempts_user ON solo_attempts(user_id, created_at);
CREATE INDEX idx_solo_attempts_challenge ON solo_attempts(challenge_id, user_id);

-- initial events (drafts: an admin sets the period and publishes them)
INSERT INTO events (id, name, description, starts_at, ends_at, status, rules_json, created_at, updated_at) VALUES
  ('ev-young-talents', 'Young Talents', '23歳以下の若手選手が全員候補に入るイベント。足りないポジションは通常の選手で補います。', 1794582000000, 1795186800000, 'draft', '{"pool":{"maxAge":23}}', 1794582000000, 1794582000000),
  ('ev-goalkeeper-legends', 'Goalkeeper Legends', '全20人のGKが候補に入るイベント。GKの取り合いが勝負を分けます。', 1794582000000, 1795186800000, 'draft', '{"pool":{"positions":["GK"]}}', 1794582000000, 1794582000000),
  ('ev-world-legends', 'World Legends', 'Legendary と Icon の36人が全員候補に入るイベント。', 1794582000000, 1795186800000, 'draft', '{"pool":{"rarities":["legendary","icon"]}}', 1794582000000, 1794582000000),
  ('ev-japanese-stars', 'Japanese Stars', '日本国籍の23人が全員候補に入るイベント。', 1794582000000, 1795186800000, 'draft', '{"pool":{"nationalities":["JPN"]}}', 1794582000000, 1794582000000),
  ('ev-attacking-masters', 'Attacking Masters', 'ST・CF・LW・RW・CAM の攻撃的な選手を中心にした候補で戦うイベント。', 1794582000000, 1795186800000, 'draft', '{"pool":{"positions":["ST","CF","LW","RW","CAM"]}}', 1794582000000, 1794582000000);
