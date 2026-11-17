-- DRAFT MATCH (official spec "MATCH / DRAFT MATCH v2.0" 9, decisions 75-85, docs/12-draft-match-plan.md)

-- the draft of the retired modes keeps its records under new names (decision 80):
-- "draft_picks" is the name of a DRAFT MATCH table in the spec
ALTER TABLE draft_picks RENAME TO legacy_draft_picks;
ALTER TABLE drafts RENAME TO legacy_drafts;

-- one row per DRAFT MATCH room (the room is also listed in rooms with mode 'draft_match',
-- which history, matches and the admin site use)
CREATE TABLE draft_rooms (
  id TEXT PRIMARY KEY REFERENCES rooms(id),
  status TEXT NOT NULL CHECK (status IN ('WAITING', 'MATCHING', 'FORMATION_SELECTION', 'POOL_GENERATION', 'CHINCHIRO', 'DRAFT_ORDER', 'PLAYER_DRAFT', 'TEAM_CONFIRMATION', 'SIMULATION', 'RESULT', 'COMPLETED', 'CANCELLED')),
  players INTEGER NOT NULL DEFAULT 0,
  seed TEXT NOT NULL,
  pick_seconds INTEGER NOT NULL,
  season_id TEXT,
  environment TEXT NOT NULL,
  history_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  draft_started_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX idx_draft_rooms_open ON draft_rooms(status, created_at);

CREATE TABLE draft_participants (
  room_id TEXT NOT NULL REFERENCES draft_rooms(id),
  seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
  user_id TEXT NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  formation TEXT,
  -- 1 = first pick (チンチロ)
  draft_position INTEGER,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  final_rank INTEGER,
  points INTEGER,
  goals_for INTEGER,
  goals_against INTEGER,
  rating_before INTEGER,
  rating_after INTEGER,
  rating_delta INTEGER,
  PRIMARY KEY (room_id, seat),
  UNIQUE (room_id, user_id)
);
CREATE INDEX idx_draft_participants_user ON draft_participants(user_id, joined_at);

-- every throw of チンチロ (decided by the server)
CREATE TABLE draft_dice_results (
  room_id TEXT NOT NULL REFERENCES draft_rooms(id),
  round_no INTEGER NOT NULL,
  throw_no INTEGER NOT NULL CHECK (throw_no BETWEEN 1 AND 3),
  seat INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  die1 INTEGER NOT NULL CHECK (die1 BETWEEN 1 AND 6),
  die2 INTEGER NOT NULL CHECK (die2 BETWEEN 1 AND 6),
  die3 INTEGER NOT NULL CHECK (die3 BETWEEN 1 AND 6),
  hand TEXT NOT NULL CHECK (hand IN ('pinzoro', 'shigoro', 'zorome', 'normal', 'hifumi', 'none')),
  hand_value INTEGER NOT NULL,
  strength INTEGER NOT NULL,
  is_auto INTEGER NOT NULL,
  is_rematch INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, round_no, throw_no, seat)
);

-- the common card pool (the same cards for everybody)
CREATE TABLE draft_card_pools (
  room_id TEXT NOT NULL REFERENCES draft_rooms(id),
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  sort_order INTEGER NOT NULL,
  rarity TEXT NOT NULL,
  position_group TEXT NOT NULL,
  PRIMARY KEY (room_id, player_id)
);

-- picks: one card can be picked once per room (spec 10: no simultaneous double pick)
CREATE TABLE draft_picks (
  room_id TEXT NOT NULL REFERENCES draft_rooms(id),
  pick_no INTEGER NOT NULL,
  round_no INTEGER NOT NULL,
  seat INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  is_auto INTEGER NOT NULL,
  ms INTEGER,
  picked_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, pick_no),
  UNIQUE (room_id, player_id)
);
CREATE INDEX idx_dm_picks_player ON draft_picks(player_id);

CREATE TABLE draft_teams (
  room_id TEXT NOT NULL REFERENCES draft_rooms(id),
  seat INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  formation TEXT NOT NULL,
  roster_json TEXT NOT NULL,
  lineup_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, seat)
);

-- one row per match of a DRAFT MATCH room (events, statistics and teams stay in the match tables)
CREATE TABLE draft_match_results (
  match_id TEXT PRIMARY KEY REFERENCES matches(id),
  room_id TEXT NOT NULL REFERENCES draft_rooms(id),
  matchday INTEGER NOT NULL,
  home_seat INTEGER NOT NULL,
  away_seat INTEGER NOT NULL,
  home_goals INTEGER NOT NULL,
  away_goals INTEGER NOT NULL,
  winner_seat INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_draft_match_results_room ON draft_match_results(room_id);

-- ranking (decision 77: rating, monthly seasons, DRAFT MATCH only)
CREATE TABLE draft_rankings (
  season_id TEXT NOT NULL,
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
CREATE INDEX idx_draft_rankings_board ON draft_rankings(season_id, rating);

-- refused / invalid operations (spec 10: 不正操作を監査ログに保存する)
CREATE TABLE draft_audit_logs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_draft_audit_room ON draft_audit_logs(room_id, created_at);
CREATE INDEX idx_draft_audit_time ON draft_audit_logs(created_at);
