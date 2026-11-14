-- Phase 5: admin platform (spec 12-16). Decisions: docs/02-decisions.md 45-51.

-- ---------------------------------------------------------------- admin roles (decision 45)
-- owner / admin / support / viewer. The table is rebuilt to change the CHECK
-- constraint (same pattern as 0004: rows referencing it are restored in the
-- same transaction).
PRAGMA defer_foreign_keys = true;
CREATE TABLE admin_users_backup AS SELECT * FROM admin_users;
DROP TABLE admin_users;
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'support', 'viewer')),
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER,
  created_by TEXT,
  password_changed_at INTEGER
);
INSERT INTO admin_users (id, username, password_hash, password_salt, password_iterations, role, totp_secret, totp_enabled, status, created_at, updated_at, last_login_at)
  SELECT id, username, password_hash, password_salt, password_iterations, role, totp_secret, totp_enabled, status, created_at, updated_at, last_login_at FROM admin_users_backup;
DROP TABLE admin_users_backup;

CREATE INDEX idx_admin_audit_logs_action ON admin_audit_logs(action, created_at);
CREATE INDEX idx_admin_audit_logs_admin ON admin_audit_logs(admin_id, created_at);

-- ---------------------------------------------------------------- users
CREATE INDEX idx_users_created ON users(created_at);
CREATE INDEX idx_user_tags_tag ON user_tags(tag, user_id);

-- ---------------------------------------------------------------- feedback (spec 13, decisions 48-49)
-- the original text is never changed (no update API); status, priority, notes
-- and replies are kept separately
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'balance', 'payment', 'other')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  wants_reply INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'investigating', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  -- recorded automatically when sent (spec 13-3); no raw User-Agent is stored
  app_version TEXT,
  platform TEXT,
  os TEXT,
  device_type TEXT,
  game_mode TEXT,
  last_room_id TEXT,
  last_match_id TEXT,
  error_code TEXT,
  environment TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX idx_feedback_status ON feedback(status, created_at);
CREATE INDEX idx_feedback_user ON feedback(user_id, created_at);

-- internal notes (never shown to the player)
CREATE TABLE feedback_notes (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id),
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_feedback_notes_feedback ON feedback_notes(feedback_id, created_at);

-- replies shown in the game (decision 48)
CREATE TABLE feedback_replies (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id),
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX idx_feedback_replies_feedback ON feedback_replies(feedback_id, created_at);

-- ---------------------------------------------------------------- GEMS distribution (spec 14, decisions 46-47)
CREATE TABLE gem_distribution_batches (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('test_play', 'beta_reward', 'apology', 'campaign', 'season', 'event', 'other')),
  title TEXT NOT NULL,
  note TEXT,
  currency TEXT NOT NULL CHECK (currency = 'GEMS_FREE'),
  amount_per_user INTEGER NOT NULL CHECK (amount_per_user BETWEEN 1 AND 1000),
  -- conditions used to pick the players (the list itself is fixed in gem_distribution_items)
  target_json TEXT NOT NULL,
  target_count INTEGER NOT NULL CHECK (target_count >= 1),
  total_amount INTEGER NOT NULL CHECK (total_amount BETWEEN 1 AND 1000000),
  status TEXT NOT NULL CHECK (status IN ('ready', 'running', 'completed', 'cancelled')),
  granted_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES admin_users(id),
  executed_by TEXT REFERENCES admin_users(id),
  request_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  cancelled_at INTEGER
);
CREATE INDEX idx_gem_distribution_batches_time ON gem_distribution_batches(created_at);

CREATE TABLE gem_distribution_items (
  batch_id TEXT NOT NULL REFERENCES gem_distribution_batches(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'skipped', 'failed')),
  error TEXT,
  processed_at INTEGER,
  PRIMARY KEY (batch_id, user_id)
);
CREATE INDEX idx_gem_distribution_items_status ON gem_distribution_items(batch_id, status);

-- ---------------------------------------------------------------- analytics (spec 12-5, 12-6, 16)
CREATE INDEX idx_analytics_events_time ON analytics_events(timestamp);

-- one row per player and Japan day with any activity; finished days are
-- summarised once (metrics_days) and never recomputed
CREATE TABLE daily_user_metrics (
  day_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  platform TEXT,
  app_version TEXT,
  events INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  playtime_ms INTEGER NOT NULL DEFAULT 0,
  drafts_started INTEGER NOT NULL DEFAULT 0,
  drafts_completed INTEGER NOT NULL DEFAULT 0,
  matches_started INTEGER NOT NULL DEFAULT 0,
  matches_completed INTEGER NOT NULL DEFAULT 0,
  picks INTEGER NOT NULL DEFAULT 0,
  -- {"quick":2,"ranked":1}
  modes_json TEXT,
  PRIMARY KEY (day_key, user_id)
);
CREATE INDEX idx_daily_user_metrics_user ON daily_user_metrics(user_id, day_key);

CREATE TABLE metrics_days (
  day_key TEXT PRIMARY KEY,
  active_users INTEGER NOT NULL,
  events INTEGER NOT NULL,
  computed_at INTEGER NOT NULL
);
