-- Phase 4: Collection, COINS, FREE GEMS, PAID GEMS, Standard / Premium Gacha,
-- duplicate exchange, exchange shop, Collection Draft.
-- Design: docs/07-phase4-plan.md, decisions: docs/02-decisions.md 36-44.
-- Only user ids are stored (no names / e-mail addresses).

-- ---------------------------------------------------------------- wallets and ledgers
-- balances are kept in separate columns (spec 8-1, 8-4) and can never go below 0:
-- a spend that is not covered fails the whole batch and changes nothing.
CREATE TABLE currency_wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  gems_free INTEGER NOT NULL DEFAULT 0 CHECK (gems_free >= 0),
  gems_paid_purchased INTEGER NOT NULL DEFAULT 0 CHECK (gems_paid_purchased >= 0),
  gems_paid_granted INTEGER NOT NULL DEFAULT 0 CHECK (gems_paid_granted >= 0),
  updated_at INTEGER NOT NULL
);

-- one row per change of one balance; balance_after is read inside the same batch
CREATE TABLE currency_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  currency TEXT NOT NULL CHECK (currency IN ('COINS', 'GEMS_FREE', 'GEMS_PAID_PURCHASED', 'GEMS_PAID_GRANTED')),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  -- match_reward, login_bonus, mission, solo_clear, event_bonus, season_reward, gacha, test_grant
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  -- groups the rows written by one operation (e.g. a 10-draw)
  op_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_currency_transactions_user ON currency_transactions(user_id, created_at);
CREATE INDEX idx_currency_transactions_op ON currency_transactions(op_id);

-- exchange points from duplicates, Standard and Premium kept separately (spec 9-4)
CREATE TABLE exchange_wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  standard_points INTEGER NOT NULL DEFAULT 0 CHECK (standard_points >= 0),
  premium_points INTEGER NOT NULL DEFAULT 0 CHECK (premium_points >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE exchange_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  point_type TEXT NOT NULL CHECK (point_type IN ('standard', 'premium')),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  -- duplicate, redeem, test_grant
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  op_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_exchange_transactions_user ON exchange_transactions(user_id, created_at);

-- Operations that read state and then write (gacha, exchange, roster) take the
-- next number of the user: two operations computed from the same state cannot
-- both commit (the second fails on the primary key and is retried).
CREATE TABLE economy_ops (
  user_id TEXT NOT NULL REFERENCES users(id),
  seq INTEGER NOT NULL,
  op TEXT NOT NULL,
  op_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, seq)
);

-- request ids (idempotency keys) sent by the client: a repeated request returns
-- the stored response instead of running again
CREATE TABLE economy_requests (
  user_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  op_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, request_key)
);

-- ---------------------------------------------------------------- rewards
-- every reward is recorded under a unique key before it is paid
-- (match:<room>, login:<day>, mission:<id>:<period>, season:<id>, solo:<challenge>, event:<room>)
CREATE TABLE reward_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  reward_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  op_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);
CREATE INDEX idx_reward_claims_user ON reward_claims(user_id, created_at);

-- decision 41: match rewards for at most 10 leagues per Japan day (all modes)
CREATE TABLE daily_match_rewards (
  user_id TEXT NOT NULL REFERENCES users(id),
  day_key TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 10),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day_key, slot),
  UNIQUE (user_id, room_id)
);

CREATE TABLE login_streaks (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  last_day_key TEXT NOT NULL,
  streak INTEGER NOT NULL CHECK (streak >= 1),
  best_streak INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------- missions
CREATE TABLE missions (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'beginner')),
  metric TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target >= 1),
  reward_currency TEXT NOT NULL CHECK (reward_currency IN ('COINS', 'GEMS_FREE')),
  reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
  title_ja TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE mission_progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  mission_id TEXT NOT NULL REFERENCES missions(id),
  -- Japan day (YYYY-MM-DD), week (WYYYY-MM-DD, Monday) or "once"
  period_key TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  claimed_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, mission_id, period_key)
);

-- ---------------------------------------------------------------- collection
CREATE TABLE user_collections (
  user_id TEXT NOT NULL REFERENCES users(id),
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  source TEXT NOT NULL CHECK (source IN ('gacha', 'exchange', 'test_grant')),
  source_ref TEXT,
  obtained_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, player_id)
);
CREATE INDEX idx_user_collections_user ON user_collections(user_id, obtained_at);

-- decision 36: own cards that only this player can pick in Collection Draft
CREATE TABLE collection_draft_rosters (
  user_id TEXT NOT NULL REFERENCES users(id),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  player_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot),
  UNIQUE (user_id, player_id),
  FOREIGN KEY (user_id, player_id) REFERENCES user_collections(user_id, player_id)
);

-- ---------------------------------------------------------------- gacha
CREATE TABLE gacha_banners (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('standard', 'premium')),
  -- pity is kept per series and carried over to reruns of the same series
  series_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  cost_currency TEXT NOT NULL CHECK (cost_currency IN ('COINS', 'GEMS_PAID')),
  cost_single INTEGER NOT NULL CHECK (cost_single > 0),
  cost_multi INTEGER NOT NULL CHECK (cost_multi > 0),
  rates_version INTEGER NOT NULL,
  -- null or {"epicAt":50,"legendaryAt":100,"bonusEvery":150}
  pity_json TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- rates in parts per million per version (a draw stores the version it used)
CREATE TABLE gacha_probabilities (
  banner_id TEXT NOT NULL REFERENCES gacha_banners(id),
  rates_version INTEGER NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'icon')),
  rate_ppm INTEGER NOT NULL CHECK (rate_ppm BETWEEN 0 AND 1000000),
  PRIMARY KEY (banner_id, rates_version, rarity)
);

CREATE TABLE gacha_pool_items (
  banner_id TEXT NOT NULL REFERENCES gacha_banners(id),
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  PRIMARY KEY (banner_id, player_id)
);

CREATE TABLE gacha_pity (
  user_id TEXT NOT NULL REFERENCES users(id),
  series_id TEXT NOT NULL,
  since_epic INTEGER NOT NULL DEFAULT 0 CHECK (since_epic >= 0),
  since_legendary INTEGER NOT NULL DEFAULT 0 CHECK (since_legendary >= 0),
  toward_bonus INTEGER NOT NULL DEFAULT 0 CHECK (toward_bonus >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, series_id)
);

-- one row per draw request (single or 10-draw)
CREATE TABLE gacha_draws (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  banner_id TEXT NOT NULL REFERENCES gacha_banners(id),
  series_id TEXT NOT NULL,
  draw_count INTEGER NOT NULL,
  cost_currency TEXT NOT NULL,
  cost_amount INTEGER NOT NULL,
  -- {"GEMS_PAID_GRANTED":60,"GEMS_PAID_PURCHASED":40} or {"COINS":1000}
  cost_split_json TEXT NOT NULL,
  rates_version INTEGER NOT NULL,
  pity_before_json TEXT,
  pity_after_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_gacha_draws_user ON gacha_draws(user_id, created_at);

-- every card received (spec 9-6: draw history)
CREATE TABLE gacha_history (
  draw_id TEXT NOT NULL REFERENCES gacha_draws(id),
  idx INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  rarity TEXT NOT NULL,
  guarantee TEXT NOT NULL CHECK (guarantee IN ('none', 'epic', 'legendary', 'bonus')),
  is_free INTEGER NOT NULL,
  is_duplicate INTEGER NOT NULL,
  point_type TEXT NOT NULL CHECK (point_type IN ('standard', 'premium')),
  points INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (draw_id, idx)
);
CREATE INDEX idx_gacha_history_user ON gacha_history(user_id, created_at);

-- ---------------------------------------------------------------- exchange shop
-- decision 43: cards only; Standard points -> Common..Legendary, Premium points -> Rare..Icon
CREATE TABLE exchange_catalog (
  point_type TEXT NOT NULL CHECK (point_type IN ('standard', 'premium')),
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'icon')),
  price INTEGER NOT NULL CHECK (price > 0),
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (point_type, rarity)
);

CREATE TABLE exchange_redemptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  point_type TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  price INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_exchange_redemptions_user ON exchange_redemptions(user_id, created_at);

-- ---------------------------------------------------------------- rooms: Collection Draft
-- rebuilt under the same name (see 0004 for why this pattern is used)
PRAGMA defer_foreign_keys = true;
CREATE TABLE rooms_backup AS SELECT * FROM rooms;
DROP TABLE rooms;
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('quick', 'private', 'ranked', 'solo', 'event', 'collection')),
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

-- ---------------------------------------------------------------- seed data
INSERT INTO missions (id, period, metric, target, reward_currency, reward_amount, title_ja, sort_order) VALUES
  ('d-league', 'daily', 'league_completed', 1, 'COINS', 100, 'リーグを1回完走する', 1),
  ('d-wins', 'daily', 'match_won', 2, 'COINS', 100, '試合で2勝する', 2),
  ('d-picks', 'daily', 'manual_pick', 10, 'COINS', 100, 'ドラフトで自分で10回指名する', 3),
  ('w-leagues', 'weekly', 'league_completed', 10, 'COINS', 500, 'リーグを10回完走する', 11),
  ('w-firsts', 'weekly', 'league_won', 3, 'COINS', 500, 'リーグで3回1位になる', 12),
  ('w-competitive', 'weekly', 'ranked_or_event_league', 5, 'COINS', 500, 'ランク戦かイベントに5回参加する', 13),
  ('b-first-league', 'beginner', 'league_completed', 1, 'GEMS_FREE', 50, '初めてのリーグを完走する', 21),
  ('b-first-win', 'beginner', 'league_won', 1, 'GEMS_FREE', 50, 'リーグで初めて1位になる', 22),
  ('b-ranked', 'beginner', 'ranked_league', 1, 'GEMS_FREE', 50, 'ランク戦に参加する', 23),
  ('b-solo', 'beginner', 'solo_attempt', 1, 'GEMS_FREE', 50, 'ソロ課題に挑戦する', 24),
  ('b-gacha', 'beginner', 'gacha_draw', 1, 'GEMS_FREE', 50, 'ガシャを引く', 25),
  ('b-collection', 'beginner', 'collection_draft_league', 1, 'GEMS_FREE', 50, 'Collection Draft で遊ぶ', 26);

-- 2026-11-01 00:00 UTC; Premium series 1 ends 2027-01-31 23:59:59 JST (provisional)
INSERT INTO gacha_banners (id, kind, series_id, name, description, cost_currency, cost_single, cost_multi, rates_version, pity_json, starts_at, ends_at, status, sort_order, created_at, updated_at) VALUES
  ('standard', 'standard', 'standard', 'スタンダードガシャ', 'COINSで引ける常設ガシャ。天井・確率上昇・最低保証はありません（毎回独立した抽選）。', 'COINS', 1000, 10000, 1, NULL, 1793491200000, NULL, 'published', 1, 1793491200000, 1793491200000),
  ('premium-s1', 'premium', 'premium-s1', 'プレミアムガシャ シリーズ1', '有償GEMSで引けるガシャ。Epic以上が50回出なければ50回目でEpic以上、Legendary以上が100回出なければ100回目でLegendary以上を保証。累計150回ごとにEpic以上確定の単発が無料で1回引かれます。天井の回数はシリーズ内で引き継がれ、別シリーズには移りません。', 'GEMS_PAID', 100, 1000, 1, '{"epicAt":50,"legendaryAt":100,"bonusEvery":150}', 1793491200000, 1801407599000, 'published', 2, 1793491200000, 1793491200000);

INSERT INTO gacha_probabilities (banner_id, rates_version, rarity, rate_ppm) VALUES
  ('standard', 1, 'common', 600000),
  ('standard', 1, 'rare', 280000),
  ('standard', 1, 'epic', 100000),
  ('standard', 1, 'legendary', 20000),
  ('standard', 1, 'icon', 0),
  ('premium-s1', 1, 'common', 0),
  ('premium-s1', 1, 'rare', 650000),
  ('premium-s1', 1, 'epic', 250000),
  ('premium-s1', 1, 'legendary', 90000),
  ('premium-s1', 1, 'icon', 10000);

-- Standard: every card except Icon (291); Premium: Rare or better (180, decision 42)
INSERT INTO gacha_pool_items (banner_id, player_id) SELECT 'standard', id FROM player_cards WHERE is_active = 1 AND rarity <> 'icon';
INSERT INTO gacha_pool_items (banner_id, player_id) SELECT 'premium-s1', id FROM player_cards WHERE is_active = 1 AND rarity <> 'common';

INSERT INTO exchange_catalog (point_type, rarity, price) VALUES
  ('standard', 'common', 100),
  ('standard', 'rare', 300),
  ('standard', 'epic', 1000),
  ('standard', 'legendary', 3000),
  ('premium', 'rare', 300),
  ('premium', 'epic', 1000),
  ('premium', 'legendary', 3000),
  ('premium', 'icon', 10000);
