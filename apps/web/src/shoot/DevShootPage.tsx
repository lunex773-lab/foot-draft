import { RARITIES, type Rarity } from '@fd/shared';
import { useState } from 'react';
import { useCatalog } from '../lib/catalog';
import ShootGacha from './ShootGacha';

/**
 * Development only (not in production builds): preview the SHOOT GACHA for a
 * rarity with sample cards. Nothing is drawn and nothing is granted.
 */
export default function DevShootPage() {
  const catalog = useCatalog();
  const rarity = (new URLSearchParams(window.location.search).get('rarity') ?? 'legendary') as Rarity;
  const [open, setOpen] = useState(true);
  if (!catalog) return <div className="muted">loading…</div>;
  const pick = (r: Rarity) => [...catalog.values()].find((p) => p.rarity === r)!;
  // ?cards=common,legendary,icon: the cards in this order (default: the rarity, then a common)
  const order = (new URLSearchParams(window.location.search).get('cards') ?? '').split(',').filter((r): r is Rarity => RARITIES.includes(r as Rarity));
  const rarities = order.length ? order : RARITIES.includes(rarity) ? [rarity, 'common' as Rarity] : ['common' as Rarity];
  const items = rarities.map((r, i) => ({ playerId: pick(r).id, rarity: r, name: pick(r).name, duplicate: i > 0, enhancedTo: i > 0 ? 2 : null, points: 0 }));
  return open ? <ShootGacha results={items} catalog={catalog} onClose={() => setOpen(false)} /> : <div className="panel">closed（{rarity}）</div>;
}
