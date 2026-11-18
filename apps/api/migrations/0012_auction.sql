-- PLAYER AUCTION (spec "PLAYER AUCTION SYSTEM v1.0", decisions 97-106, docs/14-auction-plan.md)
-- One market shared by every user; the live state runs in AuctionDO, every
-- bid, hold, result and refusal is written here. Only user ids are stored.

-- ---------------------------------------------------------------- auction coins (decision 100)
-- a currency of its own, kept apart from COINS and GEMS; holds (the highest
-- bids) can never exceed the balance: a bid that is not covered fails the batch
CREATE TABLE auction_wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  held INTEGER NOT NULL DEFAULT 0 CHECK (held >= 0),
  updated_at INTEGER NOT NULL,
  CHECK (held <= balance)
);

-- one row per change of a balance (initial, exchange, win, test_reset)
CREATE TABLE auction_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  op_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_auction_transactions_user ON auction_transactions(user_id, created_at);
CREATE INDEX idx_auction_transactions_reason ON auction_transactions(reason, created_at);

-- ---------------------------------------------------------------- the market
CREATE TABLE auction_lots (
  id TEXT PRIMARY KEY,
  no INTEGER NOT NULL UNIQUE,
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  rarity TEXT NOT NULL,
  -- open -> sold | unsold | cancelled, never back (conditional updates)
  status TEXT NOT NULL CHECK (status IN ('open', 'sold', 'unsold', 'cancelled')),
  source TEXT NOT NULL CHECK (source IN ('random', 'manual')),
  -- the rules the lot was listed with (start price, extension, minimum raise)
  rules_json TEXT NOT NULL,
  listed_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  current_price INTEGER,
  leader_id TEXT REFERENCES users(id),
  leader_hold_id TEXT,
  bid_count INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER,
  close_op TEXT,
  -- admin cancel / settlement problem
  close_note TEXT,
  environment TEXT NOT NULL
);
CREATE INDEX idx_auction_lots_status ON auction_lots(status, ends_at);
CREATE INDEX idx_auction_lots_player ON auction_lots(player_id, listed_at);
CREATE INDEX idx_auction_lots_closed ON auction_lots(closed_at);

-- every accepted bid (spec 6: the whole history)
CREATE TABLE auction_bids (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES auction_lots(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  bid_no INTEGER NOT NULL,
  ends_at_after INTEGER NOT NULL,
  extended INTEGER NOT NULL DEFAULT 0 CHECK (extended IN (0, 1)),
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (lot_id, bid_no)
);
CREATE INDEX idx_auction_bids_user ON auction_bids(user_id, created_at);
CREATE INDEX idx_auction_bids_created ON auction_bids(created_at);

-- the coins a highest bid holds (spec 4); released when overtaken, settled when won
CREATE TABLE auction_holds (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES auction_lots(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  bid_id TEXT NOT NULL REFERENCES auction_bids(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'released', 'settled')),
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  close_op TEXT
);
-- only the highest bid of a lot holds coins
CREATE UNIQUE INDEX idx_auction_holds_active ON auction_holds(lot_id) WHERE status = 'active';
CREATE INDEX idx_auction_holds_user ON auction_holds(user_id, status);

-- one settlement per lot (the primary key prevents a second payment / grant)
CREATE TABLE auction_results (
  lot_id TEXT PRIMARY KEY REFERENCES auction_lots(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  rarity TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  -- new card, +1 (decision 99), or premium exchange points when it was already +5
  outcome TEXT NOT NULL CHECK (outcome IN ('new', 'enhanced', 'points')),
  level_after INTEGER,
  points INTEGER NOT NULL DEFAULT 0,
  op_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_auction_results_user ON auction_results(user_id, created_at);
CREATE INDEX idx_auction_results_created ON auction_results(created_at);

-- decision 105: the cards an admin chose to list next (listing mode "manual")
CREATE TABLE auction_queue (
  player_id TEXT PRIMARY KEY REFERENCES player_cards(id),
  position INTEGER NOT NULL,
  added_by TEXT,
  added_at INTEGER NOT NULL
);
CREATE INDEX idx_auction_queue_position ON auction_queue(position);

-- spec 7: refused actions and suspicious patterns (network address as a keyed hash only)
CREATE TABLE auction_fraud_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  lot_id TEXT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'alert')),
  detail_json TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_auction_fraud_created ON auction_fraud_logs(created_at);
CREATE INDEX idx_auction_fraud_user ON auction_fraud_logs(user_id, created_at);

-- ---------------------------------------------------------------- owned cards: source 'auction'
-- rebuilt to extend the CHECK constraint (same pattern as 0009); levels, favourites
-- and the Collection Draft roster rows referencing it are kept
PRAGMA defer_foreign_keys = true;
CREATE TABLE user_collections_backup AS SELECT * FROM user_collections;
DROP TABLE user_collections;
CREATE TABLE user_collections (
  user_id TEXT NOT NULL REFERENCES users(id),
  player_id TEXT NOT NULL REFERENCES player_cards(id),
  source TEXT NOT NULL CHECK (source IN ('gacha', 'exchange', 'test_grant', 'season_pass', 'starter', 'auction')),
  source_ref TEXT,
  obtained_at INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  PRIMARY KEY (user_id, player_id)
);
INSERT INTO user_collections (user_id, player_id, source, source_ref, obtained_at, level, favorite)
  SELECT user_id, player_id, source, source_ref, obtained_at, level, favorite FROM user_collections_backup;
DROP TABLE user_collections_backup;
CREATE INDEX idx_user_collections_user ON user_collections(user_id, obtained_at);
