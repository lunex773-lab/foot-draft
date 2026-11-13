-- FOOTBALL DRAFT initial schema (Phase 1 + Phase 2 + admin cards)
-- All timestamps are epoch milliseconds (UTC).

-- ---------------------------------------------------------------- accounts
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY, -- sha256 of the bearer token (the token itself is never stored)
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent TEXT
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);

CREATE TABLE user_tags (
  user_id TEXT NOT NULL REFERENCES users(id),
  tag TEXT NOT NULL CHECK (tag IN ('founder', 'beta_tester', 'friend_tester', 'developer', 'normal')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, tag)
);

-- ---------------------------------------------------------------- player cards
CREATE TABLE player_cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  nationality TEXT NOT NULL,
  league_id TEXT NOT NULL,
  club_id TEXT NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'icon')),
  primary_position TEXT NOT NULL,
  ovr INTEGER NOT NULL CHECK (ovr BETWEEN 1 AND 99),
  role TEXT NOT NULL,
  pac INTEGER NOT NULL,
  sho INTEGER NOT NULL,
  pas INTEGER NOT NULL,
  dri INTEGER NOT NULL,
  def INTEGER NOT NULL,
  phy INTEGER NOT NULL,
  age INTEGER NOT NULL,
  preferred_foot TEXT NOT NULL,
  height_cm INTEGER NOT NULL,
  appearance_json TEXT NOT NULL,
  catalog_version INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_player_cards_rarity ON player_cards(rarity);
CREATE INDEX idx_player_cards_position ON player_cards(primary_position);
CREATE INDEX idx_player_cards_ovr ON player_cards(ovr);

CREATE TABLE player_attributes (
  player_id TEXT PRIMARY KEY REFERENCES player_cards(id),
  acceleration INTEGER NOT NULL,
  sprint_speed INTEGER NOT NULL,
  shot_accuracy INTEGER NOT NULL,
  shot_power INTEGER NOT NULL,
  finishing INTEGER NOT NULL,
  short_passing INTEGER NOT NULL,
  long_passing INTEGER NOT NULL,
  vision INTEGER NOT NULL,
  ball_control INTEGER NOT NULL,
  dribbling INTEGER NOT NULL,
  tackling INTEGER NOT NULL,
  interception INTEGER NOT NULL,
  positioning INTEGER NOT NULL,
  stamina INTEGER NOT NULL,
  strength INTEGER NOT NULL,
  jumping INTEGER NOT NULL,
  gk_reflexes INTEGER NOT NULL,
  gk_handling INTEGER NOT NULL,
  gk_positioning INTEGER NOT NULL
);

CREATE TABLE player_positions (
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  position TEXT NOT NULL,
  is_primary INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (player_id, position)
);

CREATE TABLE player_traits (
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  trait TEXT NOT NULL,
  slot INTEGER NOT NULL,
  PRIMARY KEY (player_id, trait)
);

-- ---------------------------------------------------------------- rooms / draft
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('quick', 'private')),
  status TEXT NOT NULL CHECK (status IN ('lobby', 'drafting', 'lineup', 'playing', 'finished', 'closed')),
  host_user_id TEXT REFERENCES users(id),
  settings_json TEXT NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 0,
  environment TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX idx_rooms_open ON rooms(mode, status, created_at);

CREATE TABLE room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
  user_id TEXT REFERENCES users(id),
  display_name TEXT NOT NULL,
  is_cpu INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  final_rank INTEGER,
  points INTEGER,
  goals_for INTEGER,
  goals_against INTEGER,
  PRIMARY KEY (room_id, seat)
);
CREATE INDEX idx_room_members_user ON room_members(user_id);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  seed TEXT NOT NULL,
  pool_json TEXT NOT NULL,
  pick_seconds INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_drafts_room ON drafts(room_id);

CREATE TABLE draft_picks (
  draft_id TEXT NOT NULL REFERENCES drafts(id),
  pick_no INTEGER NOT NULL,
  seat INTEGER NOT NULL,
  user_id TEXT,
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  is_auto INTEGER NOT NULL,
  picked_at INTEGER NOT NULL,
  PRIMARY KEY (draft_id, pick_no),
  UNIQUE (draft_id, player_id) -- no duplicate player in one draft (spec 3-1)
);

-- ---------------------------------------------------------------- matches
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  matchday INTEGER NOT NULL,
  seed TEXT NOT NULL,
  sim_version TEXT NOT NULL,
  home_seat INTEGER NOT NULL,
  away_seat INTEGER NOT NULL,
  home_user_id TEXT,
  away_user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('simulated', 'completed')),
  created_at INTEGER NOT NULL,
  playback_start_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_matches_room ON matches(room_id);
CREATE INDEX idx_matches_home_user ON matches(home_user_id);
CREATE INDEX idx_matches_away_user ON matches(away_user_id);

-- team composition, tactics and player abilities at kickoff (spec 6-4)
CREATE TABLE match_teams (
  match_id TEXT NOT NULL REFERENCES matches(id),
  side TEXT NOT NULL CHECK (side IN ('home', 'away')),
  seat INTEGER NOT NULL,
  user_id TEXT,
  team_name TEXT NOT NULL,
  lineup_json TEXT NOT NULL,
  players_json TEXT NOT NULL,
  chemistry INTEGER NOT NULL,
  PRIMARY KEY (match_id, side)
);

CREATE TABLE match_events (
  match_id TEXT PRIMARY KEY REFERENCES matches(id),
  events_json TEXT NOT NULL,
  track_json TEXT NOT NULL
);

CREATE TABLE match_statistics (
  match_id TEXT NOT NULL REFERENCES matches(id),
  side TEXT NOT NULL CHECK (side IN ('home', 'away')),
  stats_json TEXT NOT NULL,
  players_json TEXT NOT NULL,
  notes_json TEXT NOT NULL,
  PRIMARY KEY (match_id, side)
);

CREATE TABLE match_results (
  match_id TEXT PRIMARY KEY REFERENCES matches(id),
  home_goals INTEGER NOT NULL,
  away_goals INTEGER NOT NULL,
  winner_seat INTEGER,
  mvp_player_id TEXT,
  created_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------- admin
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY, -- sha256 of the token
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_admin_sessions_admin ON admin_sessions(admin_id);

CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail_json TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_admin_audit_logs_time ON admin_audit_logs(created_at);

-- ---------------------------------------------------------------- analytics (spec 16)
CREATE TABLE analytics_events (
  event_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  timestamp INTEGER NOT NULL,
  platform TEXT,
  app_version TEXT,
  environment TEXT NOT NULL,
  properties_json TEXT
);
CREATE INDEX idx_analytics_events_name_time ON analytics_events(event_name, timestamp);
CREATE INDEX idx_analytics_events_user ON analytics_events(user_id);
