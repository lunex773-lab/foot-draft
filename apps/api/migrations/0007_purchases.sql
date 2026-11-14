-- Phase 6: products, purchases (mock store now, Apple / Google later), refunds,
-- membership subscriptions, Season Pass, gacha versions for admin editing.
-- Decisions: docs/02-decisions.md 52-58, plan: docs/09-phase6-plan.md.

-- ---------------------------------------------------------------- products (spec 11-2, 11-3)
CREATE TABLE purchase_products (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('gems', 'membership')),
  name TEXT NOT NULL,
  price_jpy INTEGER NOT NULL CHECK (price_jpy > 0),
  -- purchased PAID GEMS (the price part)
  gems_base INTEGER NOT NULL DEFAULT 0 CHECK (gems_base >= 0),
  -- distributed PAID GEMS added to every purchase
  gems_bonus INTEGER NOT NULL DEFAULT 0 CHECK (gems_bonus >= 0),
  -- distributed PAID GEMS on the first purchase of this product only
  first_time_bonus INTEGER NOT NULL DEFAULT 0 CHECK (first_time_bonus >= 0),
  period_days INTEGER,
  apple_product_id TEXT,
  google_product_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- one row per purchase attempt (started -> completed / failed -> refunded)
CREATE TABLE purchase_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES purchase_products(id),
  store TEXT NOT NULL CHECK (store IN ('mock', 'apple', 'google')),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'refunded')),
  -- the store's transaction id: one grant per store transaction
  store_transaction_id TEXT,
  -- subscriptions: the first transaction of the chain
  original_transaction_id TEXT,
  price_jpy INTEGER NOT NULL,
  gems_purchased INTEGER NOT NULL DEFAULT 0,
  gems_granted INTEGER NOT NULL DEFAULT 0,
  receipt_status TEXT NOT NULL DEFAULT 'none' CHECK (receipt_status IN ('none', 'verified', 'invalid', 'not_connected')),
  failure_reason TEXT,
  -- sandbox (mock / store test) or production
  store_environment TEXT NOT NULL,
  -- renewal of a subscription (not started from the game)
  is_renewal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  refunded_at INTEGER,
  UNIQUE (store, store_transaction_id)
);
CREATE INDEX idx_purchase_transactions_user ON purchase_transactions(user_id, created_at);
CREATE INDEX idx_purchase_transactions_time ON purchase_transactions(status, created_at);

-- receipts as verified (summary only; no card or personal data is stored)
CREATE TABLE purchase_receipts (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES purchase_transactions(id),
  store TEXT NOT NULL,
  receipt_sha256 TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('verified', 'invalid', 'not_connected')),
  detail_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_purchase_receipts_tx ON purchase_receipts(transaction_id);

-- refunds (decision 57): what could be taken back and what is still missing
CREATE TABLE refund_records (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES purchase_transactions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  amount_jpy INTEGER NOT NULL,
  gems_to_recover INTEGER NOT NULL,
  gems_recovered INTEGER NOT NULL,
  shortfall INTEGER NOT NULL CHECK (shortfall >= 0),
  status TEXT NOT NULL CHECK (status IN ('settled', 'shortfall', 'resolved')),
  resolved_by TEXT REFERENCES admin_users(id),
  resolution_note TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX idx_refund_records_status ON refund_records(status, created_at);

-- membership (decision 55): one row per subscription chain
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES purchase_products(id),
  store TEXT NOT NULL,
  original_transaction_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'refunded')),
  auto_renew INTEGER NOT NULL DEFAULT 1,
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store, original_transaction_id)
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id, status, current_period_end);

-- ---------------------------------------------------------------- Season Pass (decisions 54, 56)
CREATE TABLE season_pass_progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  season_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  premium INTEGER NOT NULL DEFAULT 0,
  premium_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, season_id)
);

-- XP is added once per league
CREATE TABLE season_pass_xp (
  user_id TEXT NOT NULL REFERENCES users(id),
  room_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  xp INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, room_id)
);

-- cards can now also come from the Season Pass: rebuilt to change the CHECK
-- constraint (same pattern as 0004; the roster rows referencing it are kept)
PRAGMA defer_foreign_keys = true;
CREATE TABLE user_collections_backup AS SELECT * FROM user_collections;
DROP TABLE user_collections;
CREATE TABLE user_collections (
  user_id TEXT NOT NULL REFERENCES users(id),
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  source TEXT NOT NULL CHECK (source IN ('gacha', 'exchange', 'test_grant', 'season_pass')),
  source_ref TEXT,
  obtained_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, player_id)
);
INSERT INTO user_collections (user_id, player_id, source, source_ref, obtained_at)
  SELECT user_id, player_id, source, source_ref, obtained_at FROM user_collections_backup;
DROP TABLE user_collections_backup;
CREATE INDEX idx_user_collections_user ON user_collections(user_id, obtained_at);

-- ---------------------------------------------------------------- gacha versions (decision 58)
-- every published state of a banner: rates, pool, cost, pity, period
CREATE TABLE gacha_banner_versions (
  banner_id TEXT NOT NULL REFERENCES gacha_banners(id),
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  change_note TEXT,
  changed_by TEXT REFERENCES admin_users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (banner_id, version)
);

INSERT INTO gacha_banner_versions (banner_id, version, snapshot_json, change_note, created_at)
  SELECT b.id, b.rates_version,
         json_object(
           'name', b.name,
           'description', b.description,
           'cost', json_object('currency', b.cost_currency, 'single', b.cost_single, 'multi', b.cost_multi),
           'rates', (SELECT json_group_object(p.rarity, p.rate_ppm) FROM gacha_probabilities p WHERE p.banner_id = b.id AND p.rates_version = b.rates_version),
           'pool', (SELECT json_group_array(i.player_id) FROM gacha_pool_items i WHERE i.banner_id = b.id),
           'pity', json(b.pity_json),
           'startsAt', b.starts_at,
           'endsAt', b.ends_at
         ),
         '初版', b.created_at
    FROM gacha_banners b;

-- ---------------------------------------------------------------- seed products (decision 53, 55)
INSERT INTO purchase_products (id, kind, name, price_jpy, gems_base, gems_bonus, first_time_bonus, period_days, apple_product_id, google_product_id, sort_order, created_at, updated_at) VALUES
  ('gems_300', 'gems', 'Starter Pack', 300, 300, 0, 150, NULL, NULL, NULL, 1, 1794636000000, 1794636000000),
  ('gems_600', 'gems', 'Small Pack', 600, 600, 0, 0, NULL, NULL, NULL, 2, 1794636000000, 1794636000000),
  ('gems_1200', 'gems', 'Medium Pack', 1200, 1200, 50, 0, NULL, NULL, NULL, 3, 1794636000000, 1794636000000),
  ('gems_3000', 'gems', 'Large Pack', 3000, 3000, 200, 0, NULL, NULL, NULL, 4, 1794636000000, 1794636000000),
  ('gems_5000', 'gems', 'Premium Pack', 5000, 5000, 500, 0, NULL, NULL, NULL, 5, 1794636000000, 1794636000000),
  ('gems_10000', 'gems', 'Ultimate Pack', 10000, 10000, 1500, 0, NULL, NULL, NULL, 6, 1794636000000, 1794636000000),
  ('membership_monthly', 'membership', 'Premium Membership', 500, 0, 0, 0, 30, NULL, NULL, 10, 1794636000000, 1794636000000);
