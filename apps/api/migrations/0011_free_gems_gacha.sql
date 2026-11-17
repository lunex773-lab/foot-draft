-- FREE GEMS for GEMS gacha (decisions 86-87): set per banner; FREE GEMS are used first,
-- then distributed PAID GEMS, then purchased PAID GEMS. The current Premium accepts them.
ALTER TABLE gacha_banners ADD COLUMN accepts_free_gems INTEGER NOT NULL DEFAULT 0;
UPDATE gacha_banners SET accepts_free_gems = 1 WHERE id = 'premium-s1';
