/**
 * MATCH end-to-end test against a running local API (`npm run dev -w @fd/api`).
 *
 *   npm run e2e:match -w @fd/api
 *
 *  - first 11 cards (decision 72): COMMON GK1 / DF4 / MF3 / FW3, once per player, team 1 made
 *    and active; players who own the cards already get them strengthened instead
 *  - gacha duplicates strengthen cards +1 up to +5, then become points (decision 70)
 *  - team screen API: 3 saved teams, validation against owned cards, active team, favourites
 *  - MATCH rooms (decisions 68-69): matchmaking, private rooms not matched, start with CPU
 *    teams, no draft, strengthened cards in the matches, CPU teams avoid people's cards
 *  - rewards (decision 71): match reward + Standard points by rank, goal missions
 *  - a test data reset gives the first 11 cards again
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATCH_CONFIG, POSITION_GROUP, autoLineup, enhancePlayer, getCatalog, type Lineup, type RoomSnapshot } from '@fd/shared';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';
const RUN = Math.random().toString(36).slice(2, 8);
const HERE = dirname(fileURLToPath(import.meta.url));
const FAST = { lineupSecondsFirst: 2, lineupSecondsBetween: 1, playbackSeconds: 1 };
const catalog = getCatalog();
const byId = new Map(catalog.map((p) => [p.id, p]));
let failures = 0;

function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rid = () => `e2e-${RUN}-${Math.random().toString(36).slice(2, 12)}`;

async function api<T = any>(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${API}${path}`, {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data };
    } catch (e) {
      if (i >= 4) throw e;
      await sleep(1000);
    }
  }
}

function d1<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', sql], { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  const parsed = JSON.parse(out) as { results: T[] }[];
  return parsed[parsed.length - 1]?.results ?? [];
}

async function register(name: string) {
  const username = `${name}_${RUN}`;
  const r = await api<{ token: string; user: { id: string } }>('/api/auth/register', { body: { username, password: 'password-1234', displayName: name } });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.data)}`);
  return { username, token: r.data.token, id: r.data.user.id };
}

function createAdmin(name: string) {
  execFileSync('npx', ['tsx', join(HERE, 'create-admin.ts'), '--local', '--username', name, '--role', 'admin', '--no-totp'], {
    env: { ...process.env, FD_ADMIN_PASSWORD: 'admin-password-123' },
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitRoom(token: string, roomId: string, ok: (s: RoomSnapshot) => boolean, label: string, timeoutMs = 120_000): Promise<RoomSnapshot> {
  const start = Date.now();
  for (;;) {
    const r = await api<RoomSnapshot>(`/api/rooms/${roomId}`, { token });
    if (r.status === 200 && ok(r.data)) return r.data;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label} (phase ${r.data?.phase})`);
    await sleep(400);
  }
}

const groups = (ids: string[]) => {
  const n: Record<string, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const id of ids) n[POSITION_GROUP[byId.get(id)!.primaryPosition]]++;
  return n;
};

async function main() {
  console.log(`MATCH E2E against ${API} (run ${RUN})`);
  const [a, b, c, d] = await Promise.all(['mt_a', 'mt_b', 'mt_c', 'mt_d'].map(register));

  // ------------------------------------------------------------ first 11 cards
  console.log('\n[first 11 cards]');
  const t1 = await api('/api/team', { token: a.token });
  const starterIds: string[] = (t1.data.starter ?? []).map((x: any) => x.playerId);
  check(t1.status === 200 && starterIds.length === 11, 'the first visit gives 11 cards');
  check(starterIds.every((id) => byId.get(id)?.rarity === 'common'), 'all of them COMMON');
  check(JSON.stringify(groups(starterIds)) === JSON.stringify(MATCH_CONFIG.starter), `GK1 / DF4 / MF3 / FW3 (${JSON.stringify(groups(starterIds))})`);
  check(t1.data.cards.length === 11 && t1.data.cards.every((x: any) => x.source === 'starter' && x.level === 0), 'owned as "starter" cards at +0');
  const team1: Lineup = t1.data.squads[0]?.lineup;
  check(t1.data.active === 1 && t1.data.squads.length === 1 && team1.formation === '4-3-3' && team1.starters.length === 11 && team1.bench.length === 0, 'team 1 (4-3-3) made and active');
  check(new Set(team1.starters).size === 11 && team1.starters.every((id) => starterIds.includes(id)), 'team 1 uses the 11 cards');
  const t1b = await api('/api/team', { token: a.token });
  check(t1b.data.starter === null && t1b.data.cards.length === 11, 'only once: a second visit gives nothing');
  const simultaneous = await Promise.all([api('/api/team', { token: b.token }), api('/api/collection', { token: b.token }), api('/api/team', { token: b.token })]);
  check(simultaneous.every((r) => r.status === 200), 'simultaneous first visits succeed');
  check(d1<{ n: number }>(`SELECT COUNT(*) AS n FROM user_collections WHERE user_id = '${b.id}'`)[0].n === 11, 'simultaneous first visits still give 11 cards once');

  // a player who owned every COMMON card before: the 11 cards strengthen them
  const commons = catalog.filter((p) => p.rarity === 'common').map((p) => p.id);
  d1(`INSERT INTO user_collections (user_id, player_id, source, source_ref, obtained_at) SELECT '${c.id}', id, 'test_grant', 'e2e', 1 FROM player_cards WHERE rarity = 'common'`);
  const tc = await api('/api/team', { token: c.token });
  const cStarter: any[] = tc.data.starter ?? [];
  check(cStarter.length === 11 && cStarter.every((x) => !x.newCard && x.levelTo === 1), 'owned cards are strengthened to +1 instead');
  check(tc.data.cards.length === commons.length && tc.data.cards.filter((x: any) => x.level === 1).length === 11, 'no new cards, 11 cards at +1');
  check(tc.data.squads[0]?.lineup.bench.length === 3, 'their team 1 is the best of all owned cards (with 3 substitutes)');

  // ------------------------------------------------------------ gacha strengthening
  console.log('\n[gacha strengthening]');
  const admin = `mt_admin_${RUN}`;
  createAdmin(admin);
  const at = (await api('/api/admin/auth/login', { body: { username: admin, password: 'admin-password-123' } })).data.token as string;
  await api('/api/admin/economy/test-grants', { token: at, body: { username: a.username, kind: 'COINS', amount: 50_000, note: 'e2e' } });
  // A owns every Standard card at +4: every draw is a duplicate
  d1(
    `INSERT OR IGNORE INTO user_collections (user_id, player_id, source, source_ref, obtained_at, level) SELECT '${a.id}', g.player_id, 'test_grant', 'e2e', 2, 4 FROM gacha_pool_items g WHERE g.banner_id = 'standard'`,
  );
  // COMMON cards at +5 (a duplicate gives points), the others at +4 (a duplicate strengthens)
  d1(`UPDATE user_collections SET level = CASE WHEN player_id IN (SELECT id FROM player_cards WHERE rarity = 'common') THEN 5 ELSE 4 END WHERE user_id = '${a.id}'`);
  const startLevel = (id: string) => (byId.get(id)!.rarity === 'common' ? 5 : 4);
  const pointsBefore = (await api('/api/exchange/catalog', { token: a.token })).data.points.standard as number;
  const draw = await api('/api/gacha/banners/standard/draw', { token: a.token, body: { count: 10, requestId: rid() } });
  const results: any[] = draw.data.results ?? [];
  check(draw.status === 200 && results.length === 10 && results.every((r) => r.duplicate), '10 draws, all duplicates');
  const seen = new Map<string, number>();
  let expectedPoints = 0;
  let order = true;
  for (const r of results) {
    const lv = seen.get(r.playerId) ?? startLevel(r.playerId);
    if (lv < 5) {
      order &&= r.enhancedTo === lv + 1 && r.points === 0;
      seen.set(r.playerId, lv + 1);
    } else {
      order &&= r.enhancedTo === null && r.points > 0;
      expectedPoints += r.points;
      seen.set(r.playerId, 5);
    }
  }
  check(order, 'a duplicate below +5 strengthens the card (+1, no points); at +5 it gives points');
  check(draw.data.pointsGained.amount === expectedPoints && results.some((r) => r.enhancedTo !== null) === results.some((r) => byId.get(r.playerId)!.rarity !== 'common'), `points only for +5 duplicates (${expectedPoints})`);
  const after = (await api('/api/exchange/catalog', { token: a.token })).data.points.standard as number;
  check(after === pointsBefore + expectedPoints, 'Standard points added to the wallet');
  const lvRows = d1<{ player_id: string; level: number }>(`SELECT player_id, level FROM user_collections WHERE user_id = '${a.id}' AND player_id IN (${[...seen.keys()].map((x) => `'${x}'`).join(',')})`);
  check(lvRows.every((r) => r.level === seen.get(r.player_id)), 'levels stored in the collection');
  const hist = d1<{ enhanced_to: number | null }>(`SELECT enhanced_to FROM gacha_history WHERE draw_id = '${draw.data.drawId}' ORDER BY idx`);
  check(hist.map((h) => h.enhanced_to).join() === results.map((r) => r.enhancedTo).join(), 'gacha history records the level reached');
  const missions = await api('/api/missions', { token: a.token });
  const enhanceMission = missions.data.items?.find((m: any) => m.id === 'b-enhance');
  check(enhanceMission && enhanceMission.progress >= 1, 'beginner mission "strengthen a card" progressed');

  // ------------------------------------------------------------ team screen API
  console.log('\n[team screen]');
  const teamA = await api('/api/team', { token: a.token });
  const owned: any[] = teamA.data.cards;
  const strong = owned.map((x) => enhancePlayer(byId.get(x.playerId)!, x.level));
  const best = autoLineup(strong);
  check(best.bench.length === 3, 'a team of 11 + 3 from the owned cards');
  const unowned = catalog.find((p) => !owned.some((x) => x.playerId === p.id));
  const bad1 = await api('/api/team/squads/2', { method: 'PUT', token: a.token, body: { name: 'X', lineup: unowned ? { ...best, starters: [unowned.id, ...best.starters.slice(1)] } : { ...best, starters: [] } } });
  check(bad1.status === 400 && bad1.data?.error?.code === 'UNKNOWN_PLAYER', 'a card one does not own is rejected');
  const bad2 = await api('/api/team/squads/2', { method: 'PUT', token: a.token, body: { lineup: { ...best, bench: best.bench.slice(0, 1) } } });
  check(bad2.status === 400 && bad2.data?.error?.code === 'INVALID_BENCH', 'the bench must have 3 substitutes when one owns 14+ cards');
  const bad3 = await api('/api/team/squads/4', { method: 'PUT', token: a.token, body: { lineup: best } });
  check(bad3.status === 400, 'only 3 team slots');
  const saved = await api('/api/team/squads/2', { method: 'PUT', token: a.token, body: { name: 'ベスト', lineup: best } });
  check(saved.status === 200 && saved.data.squads.length === 2 && saved.data.squads[1].name === 'ベスト' && saved.data.active === 1, 'team 2 saved, team 1 still active');
  check((await api('/api/team/active', { token: a.token, body: { slot: 3 } })).status === 404, 'an empty slot cannot be made active');
  const act = await api('/api/team/active', { token: a.token, body: { slot: 2 } });
  check(act.status === 200 && act.data.active === 2, 'team 2 is now used in MATCH');
  const fav = await api('/api/team/favorite', { token: a.token, body: { playerId: best.starters[0], favorite: true } });
  check(fav.status === 200 && (await api('/api/team', { token: a.token })).data.cards.find((x: any) => x.playerId === best.starters[0]).favorite === true, 'favourite mark saved');
  check(unowned ? (await api('/api/team/favorite', { token: a.token, body: { playerId: unowned.id, favorite: true } })).status === 404 : true, 'no favourite mark for cards one does not own');
  const teamMission = (await api('/api/missions', { token: a.token })).data.items?.find((m: any) => m.id === 'b-team');
  check(teamMission && teamMission.progress >= 1, 'beginner mission "save a team" progressed');

  // ------------------------------------------------------------ MATCH rooms
  console.log('\n[MATCH league]');
  const priv = await api('/api/match/private', { token: c.token, body: { settings: FAST } });
  check(priv.status === 201, 'C opens a MATCH room for friends');
  const qa = await api('/api/match/quick', { token: a.token, body: { settings: FAST } });
  const qb = await api('/api/match/quick', { token: b.token, body: { settings: FAST } });
  check(qa.status === 201 && qb.status === 200 && qb.data.roomId === qa.data.roomId, "B is matched with A (not with C's private room)");
  const byCode = await api('/api/rooms/join', { token: d.token, body: { code: priv.data.code } });
  check(byCode.status === 200 && byCode.data.roomId === priv.data.roomId, 'D joins the private room with its code');
  await api(`/api/rooms/${priv.data.roomId}/leave`, { token: d.token, body: {} });
  await api(`/api/rooms/${priv.data.roomId}/leave`, { token: c.token, body: {} });
  const roomId = qa.data.roomId as string;
  const lobby = (await api<RoomSnapshot>(`/api/rooms/${roomId}`, { token: a.token })).data;
  check(lobby.mode === 'match' && lobby.phase === 'lobby' && lobby.variant.kind === 'match', 'a MATCH room in the lobby');
  check((await api(`/api/rooms/${roomId}/start`, { token: b.token, body: {} })).status === 403, 'only the host starts');
  check((await api(`/api/rooms/${roomId}/start`, { token: a.token, body: {} })).status === 200, 'the host starts (empty seats: CPU teams)');
  const lineup = await waitRoom(a.token, roomId, (s) => s.phase !== 'lobby', 'lineup phase');
  check(lineup.draft === null && (lineup.phase === 'lineup' || lineup.phase === 'playing'), 'no draft: straight to the lineups');
  const seatA = lineup.seats.find((x) => x.userId === a.id)!.seat;
  const seatB = lineup.seats.find((x) => x.userId === b.id)!.seat;
  const rosterA = lineup.rosters[seatA];
  check(rosterA.length === 14 && [...best.starters, ...best.bench].every((id) => rosterA.includes(id)), "A plays with A's active team (team 2)");
  check(lineup.rosters[seatB].length === 11 && lineup.rosters[seatB].every((id) => byId.get(id)?.rarity === 'common'), "B plays with B's first 11 cards");
  check(Object.entries(lineup.levels?.[seatA] ?? {}).length === 14 && Object.values(lineup.levels![seatA]).every((lv) => lv >= 4), "A's strengthening levels are in the room");
  const cpuSeats = lineup.seats.filter((x) => x.isCpu).map((x) => x.seat);
  check(cpuSeats.length === 2 && cpuSeats.every((s) => lineup.rosters[s].length === 14), '2 CPU teams of 14 cards');
  const humanCards = new Set([...rosterA, ...lineup.rosters[seatB]]);
  check(cpuSeats.every((s) => lineup.rosters[s].every((id) => !humanCards.has(id))), "CPU teams do not use the people's cards");
  const myLineup = lineup.lineups[seatA];
  check(myLineup?.formation === best.formation && myLineup.starters.join() === best.starters.join(), "A's saved lineup is the starting lineup");
  // a lineup with a card from outside the team is refused
  const outside = catalog.find((p) => !rosterA.includes(p.id))!;
  const badLineup = await api(`/api/rooms/${roomId}/lineup`, { token: a.token, body: { lineup: { ...myLineup, starters: [outside.id, ...myLineup!.starters.slice(1)] } } });
  check(badLineup.status === 400 || badLineup.status === 409, 'cards outside the team cannot be used in the room');

  const done = await waitRoom(a.token, roomId, (s) => s.phase === 'finished' && !!s.outcome?.rewards, 'league finished', 180_000);
  check(done.fixtures.length === 6 && done.fixtures.every((f) => f.homeGoals !== null), 'round robin: 6 matches played');
  const rankA = done.finalRanks![seatA];
  const rankB = done.finalRanks![seatB];
  const rwA = done.outcome!.rewards![seatA];
  const rwB = done.outcome!.rewards![seatB];
  check(rwA.matchRewardGiven && rwA.coins > 0, `A got the match reward (${rwA.coins} COINS, rank ${rankA})`);
  check(rwA.exchangePoints === MATCH_CONFIG.rankPoints[rankA] && rwB.exchangePoints === MATCH_CONFIG.rankPoints[rankB], `Standard points by rank (A ${rwA.exchangePoints}, B ${rwB.exchangePoints})`);
  const pointsAfter = (await api('/api/exchange/catalog', { token: a.token })).data.points.standard as number;
  check(pointsAfter === after + MATCH_CONFIG.rankPoints[rankA], 'the points are in the wallet');
  const tx = d1<{ n: number }>(`SELECT COUNT(*) AS n FROM exchange_transactions WHERE user_id = '${a.id}' AND ref_id = '${roomId}' AND reason = 'match_reward'`);
  check(tx[0].n === 1, 'one ledger row for the points');
  // the matches were played with the strengthened cards
  const mt = d1<{ players_json: string }>(`SELECT t.players_json FROM match_teams t JOIN matches m ON m.id = t.match_id WHERE m.room_id = '${roomId}' AND t.seat = ${seatA} LIMIT 1`);
  const played = (JSON.parse(mt[0].players_json) as { id: string; ovr: number }[]).find((p) => p.id === best.starters[0])!;
  const lvl = done.levels![seatA][best.starters[0]];
  check(played.ovr === Math.min(99, byId.get(best.starters[0])!.ovr + lvl), `strengthened card played with OVR ${played.ovr} (+${lvl})`);
  const goalsA = done.standings.find((r) => r.seat === seatA)!.goalsFor;
  const goalMission = (await api('/api/missions', { token: a.token })).data.items?.find((m: any) => m.id === 'd-goals');
  check(goalMission && goalMission.progress === Math.min(goalMission.target, goalsA), `daily mission "goals" counts the league's goals (${goalsA})`);
  const leagueMission = (await api('/api/missions', { token: b.token })).data.items?.find((m: any) => m.id === 'b-match3');
  check(leagueMission && leagueMission.progress === 1, 'beginner mission "3 MATCH leagues" progressed');

  // ------------------------------------------------------------ test data reset
  console.log('\n[test data reset]');
  const rs = await api('/api/admin/beta/resets', { token: at, body: { target: { usernames: [b.username] }, note: 'e2e match' } });
  await api(`/api/admin/beta/resets/${rs.data.id}/run`, { token: at, body: {} });
  check(d1<{ n: number }>(`SELECT COUNT(*) AS n FROM user_squads WHERE user_id = '${b.id}'`)[0].n === 0, 'the reset removes the teams');
  const again = await api('/api/team', { token: b.token });
  check(again.data.starter?.length === 11 && again.data.cards.length === 11 && again.data.active === 1, 'after a reset the first 11 cards come again');

  console.log(failures === 0 ? '\nMATCH E2E: all checks passed' : `\nMATCH E2E: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
