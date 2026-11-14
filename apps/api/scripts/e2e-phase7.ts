/**
 * Phase 7 end-to-end test against a running local API (`npm run dev -w @fd/api`).
 *
 *   npm run e2e:phase7 -w @fd/api
 *
 *  - test accounts: "check_..." sign-ups are Developer accounts and stay out of the figures
 *  - activity: operator actions (test grants) do not make a player active
 *  - draft timer comparison: fixed / compare settings, rooms get 8 or 12 seconds, 12 s in private rooms
 *  - leagues: abandonment recorded for a player who was away at the end
 *  - league ratings: once per day, only for finished leagues of one's own, server-side context
 *  - beta tools: bulk tags, test grants to many players (once per request), test data reset
 *    (balances to 0 through the ledger, collection / roster / pity / missions / pass cleared,
 *    records kept), permissions
 *  - Matches / Draft Analytics / beta report, feedback with the sender's activity
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickSecondsFor, type RoomSnapshot, type ServerMessage } from '@fd/shared';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';
const WS = API.replace(/^http/, 'ws');
const RUN = Math.random().toString(36).slice(2, 8);
const HERE = dirname(fileURLToPath(import.meta.url));
const FAST = { pickSeconds: 2, lineupSecondsFirst: 2, lineupSecondsBetween: 1, playbackSeconds: 1 };
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
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

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

/** runs SQL on the local database and returns the rows */
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

function createAdmin(name: string, role: string) {
  execFileSync('npx', ['tsx', join(HERE, 'create-admin.ts'), '--local', '--username', name, '--role', role, '--no-totp'], {
    env: { ...process.env, FD_ADMIN_PASSWORD: 'admin-password-123' },
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function adminLogin(name: string) {
  const r = await api('/api/admin/auth/login', { body: { username: name, password: 'admin-password-123' } });
  if (r.status !== 200) throw new Error(`admin login failed ${r.status}`);
  return r.data.token as string;
}

/** private room with fast test timings; `stay` keeps the game open until the end */
async function playLeague(token: string, stay: boolean): Promise<{ roomId: string; snap: RoomSnapshot | null }> {
  const room = await api<{ roomId: string }>('/api/rooms', { token, body: { settings: FAST } });
  if (room.status !== 201) throw new Error(`room failed ${room.status}`);
  const roomId = room.data.roomId;
  await api(`/api/rooms/${roomId}/start`, { token, body: {} });
  if (!stay) {
    // nobody watches: the server picks and plays; wait until the room is finished
    const start = Date.now();
    for (;;) {
      const r = await api(`/api/rooms/${roomId}`, { token });
      if (r.data?.phase === 'finished') return { roomId, snap: r.data };
      if (Date.now() - start > 400_000) throw new Error('league timed out');
      await sleep(2000);
    }
  }
  const { data } = await api<{ ticket: string }>(`/api/rooms/${roomId}/ticket`, { token, body: {} });
  const ws = new WebSocket(`${WS}/api/rooms/${roomId}/ws?ticket=${encodeURIComponent(data.ticket)}`);
  let snap: RoomSnapshot | null = null;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    if (msg.type === 'snapshot') snap = msg.state;
  });
  const start = Date.now();
  for (;;) {
    const s = snap as RoomSnapshot | null;
    if (s?.phase === 'finished' && s.outcome) break;
    if (Date.now() - start > 400_000) throw new Error('league timed out');
    await sleep(250);
  }
  await sleep(500);
  ws.close();
  return { roomId, snap };
}

async function main() {
  console.log(`Phase 7 E2E against ${API} (run ${RUN})`);
  const a = await register('p7a');
  const b = await register('p7b');
  const adminName = `p7admin_${RUN}`;
  const viewerName = `p7viewer_${RUN}`;
  const supportName = `p7support_${RUN}`;
  createAdmin(adminName, 'admin');
  createAdmin(viewerName, 'viewer');
  createAdmin(supportName, 'support');
  await sleep(1000);
  const at = await adminLogin(adminName);
  const vt = await adminLogin(viewerName);
  const st = await adminLogin(supportName);

  // ------------------------------------------------------------ test accounts and activity
  console.log('\n[test accounts and activity]');
  const chk = await register('check');
  const chkTags = d1<{ tag: string }>(`SELECT tag FROM user_tags WHERE user_id = '${chk.id}'`).map((r) => r.tag);
  check(chkTags.join() === 'developer', `a "check_" sign-up is a Developer account (${chkTags.join()})`);
  check(d1<{ tag: string }>(`SELECT tag FROM user_tags WHERE user_id = '${a.id}'`).map((r) => r.tag).join() === 'normal', 'other sign-ups are Normal');
  await api('/api/sessions/start', { token: chk.token, body: { sessionId: `s-${rid()}` } });
  const withDev = await api(`/api/admin/analytics?from=${today()}&to=${today()}&dev=include`, { token: vt });
  const noDev = await api(`/api/admin/analytics?from=${today()}&to=${today()}`, { token: vt });
  check(noDev.data.filter.excludeDevelopers === true && withDev.data.activeUsers - noDev.data.activeUsers >= 1, `Developer accounts are left out by default (${noDev.data.activeUsers} / with them ${withDev.data.activeUsers})`);
  const ov = await api(`/api/admin/overview?from=${today()}&to=${today()}`, { token: vt });
  check(ov.data.filter?.excludeDevelopers === true, 'overview leaves Developer accounts out too');
  // a player who did nothing today stays inactive when the operator grants something
  const ghostId = `ghost${RUN}`;
  d1(`INSERT INTO users (id, username, display_name, password_hash, password_salt, password_iterations, status, created_at, updated_at) VALUES ('${ghostId}', 'ghost_${RUN}', 'Ghost', 'x', 'x', 1, 'active', 1700000000000, 1700000000000); INSERT INTO user_tags (user_id, tag, created_at) VALUES ('${ghostId}', 'normal', 1700000000000);`);
  const before = (await api(`/api/admin/analytics?from=${today()}&to=${today()}`, { token: vt })).data.activeUsers;
  const g = await api('/api/admin/economy/test-grants', { token: at, body: { username: `ghost_${RUN}`, kind: 'COINS', amount: 100 } });
  const after = (await api(`/api/admin/analytics?from=${today()}&to=${today()}`, { token: vt })).data.activeUsers;
  check(g.status === 200 && after === before, `a test grant does not make the player active (${before} -> ${after})`);

  // ------------------------------------------------------------ draft timer comparison
  console.log('\n[draft timer comparison]');
  const t0 = await api('/api/admin/beta/draft-timer', { token: vt });
  check(t0.status === 200 && t0.data.setting.mode === 'compare' && t0.data.setting.variants.join() === '8,12', 'default: compare 8 and 12 seconds');
  check((await api('/api/admin/beta/draft-timer', { method: 'PUT', token: vt, body: { mode: 'fixed', seconds: 12 } })).status === 403, 'viewer cannot change it');
  check((await api('/api/admin/beta/draft-timer', { method: 'PUT', token: at, body: { mode: 'compare', variants: [8, 9] } })).status === 400, 'only allowed values');
  const fixed = await api('/api/admin/beta/draft-timer', { method: 'PUT', token: at, body: { mode: 'fixed', seconds: 12 } });
  check(fixed.status === 200 && fixed.data.setting.seconds === 12, 'admin fixes it to 12 seconds');
  // rooms created by the matchmaking get the setting (a room joined instead is not ours to check)
  const roomSeconds = async (token: string, path: string) => {
    const r = await api(path, { token, body: {} });
    const s = await api(`/api/rooms/${r.data.roomId}`, { token });
    await api(`/api/rooms/${r.data.roomId}/leave`, { token, body: {} });
    return { created: r.status === 201, roomId: r.data.roomId as string, seconds: s.data?.settings?.pickSeconds as number };
  };
  const q1 = await roomSeconds((await register('p7q1')).token, '/api/rooms/quick');
  check(!q1.created || q1.seconds === 12, `quick room: ${q1.created ? `${q1.seconds} s` : 'joined an open room'}`);
  await api('/api/admin/beta/draft-timer', { method: 'PUT', token: at, body: { mode: 'compare', variants: [8, 12] } });
  let compared = 0;
  for (let i = 0; i < 3; i++) {
    const r = await roomSeconds((await register(`p7c${i}`)).token, '/api/rooms/quick');
    if (!r.created) continue;
    compared++;
    if (r.seconds !== pickSecondsFor(r.roomId, { mode: 'compare', variants: [8, 12] })) compared = -99;
  }
  check(compared >= 0, `compare: every new room gets 8 or 12 seconds from its id (${Math.max(compared, 0)} room(s))`);
  const priv = await api('/api/rooms', { token: a.token, body: { settings: { pickSeconds: 12 } } });
  const ps = await api(`/api/rooms/${priv.data.roomId}`, { token: a.token });
  check(ps.data.settings.pickSeconds === 12, 'private rooms can choose 12 seconds');
  await api(`/api/rooms/${priv.data.roomId}/leave`, { token: a.token, body: {} });
  check((await api('/api/admin/audit-logs?action=draft_timer_changed', { token: at })).data.items?.length >= 2, 'changes are in the audit log');

  // ------------------------------------------------------------ leagues and ratings
  console.log('\n[leagues and ratings]');
  check((await api('/api/ratings/today', { token: a.token })).data.rated === false, 'not rated yet today');
  const [la, lb] = await Promise.all([playLeague(a.token, true), playLeague(b.token, false)]);
  check(la.snap?.phase === 'finished' && lb.snap?.phase === 'finished', 'two leagues finished (one with the game closed)');
  await sleep(1500);
  const abandoned = d1<{ user_id: string }>(`SELECT user_id FROM analytics_events WHERE event_name = 'match_abandoned' AND json_extract(properties_json, '$.roomId') IN ('${la.roomId}', '${lb.roomId}')`);
  check(abandoned.length === 1 && abandoned[0].user_id === b.id, 'away at the end = left the league (match_abandoned), present = not');
  check((await api('/api/ratings', { token: a.token, body: { roomId: la.roomId, draftFun: 6, resultFair: 3 } })).status === 400, 'scores are 1-5');
  check((await api('/api/ratings', { token: a.token, body: { roomId: lb.roomId, draftFun: 4, resultFair: 3 } })).status === 404, "another player's league cannot be rated");
  const r1 = await api('/api/ratings', { token: a.token, body: { roomId: la.roomId, draftFun: 4, resultFair: 3 } });
  check(r1.status === 201, 'rating saved');
  const r2 = await api('/api/ratings', { token: a.token, body: { roomId: la.roomId, draftFun: 5, resultFair: 5 } });
  check(r2.status === 409 && r2.data.error.code === 'ALREADY_RATED', 'once per day');
  check((await api('/api/ratings/today', { token: a.token })).data.rated === true, 'the game knows it was rated today');
  const saved = d1<Record<string, unknown>>(`SELECT mode, pick_seconds, formation, final_rank, draft_fun, result_fair FROM league_ratings WHERE user_id = '${a.id}'`)[0];
  check(saved?.mode === 'private' && saved.pick_seconds === 2 && typeof saved.formation === 'string' && Number(saved.final_rank) >= 1, `context from the server: ${JSON.stringify(saved)}`);
  const open = await api('/api/rooms', { token: b.token, body: { settings: FAST } });
  check((await api('/api/ratings', { token: b.token, body: { roomId: open.data.roomId, draftFun: 3, resultFair: 3 } })).status === 409, 'a league that has not finished cannot be rated');
  await api(`/api/rooms/${open.data.roomId}/leave`, { token: b.token, body: {} });

  // ------------------------------------------------------------ Matches and Draft Analytics
  console.log('\n[Matches and Draft Analytics]');
  const ms = await api(`/api/admin/matches?from=${today()}&to=${today()}&mode=private`, { token: vt });
  check(ms.status === 200 && ms.data.summary.matches >= 12 && ms.data.byFormation.length >= 1 && ms.data.byOffense.length >= 1, `matches: ${ms.data.summary?.matches}, ${ms.data.summary?.goals?.toFixed?.(2)} goals per match`);
  const gm = ms.data.goalMinutes.reduce((s: number, x: any) => s + x.goals, 0);
  check(Math.abs(gm - Math.round(ms.data.summary.goals * ms.data.summary.matches)) <= 1, `goals per 15 minutes add up (${gm})`);
  check(ms.data.strengthGap.length >= 1 && ms.data.traits.length >= 2 && ms.data.byChemistry.length >= 1, 'strength gap, traits, chemistry');
  const hm = await api(`/api/admin/matches?from=${today()}&to=${today()}&mode=private&humans=1`, { token: vt });
  check(hm.data.summary.matches < ms.data.summary.matches, `only matches with a person: ${hm.data.summary.matches}`);
  const dr = await api(`/api/admin/drafts?from=${today()}&to=${today()}&mode=private`, { token: vt });
  check(dr.status === 200 && dr.data.summary.completed >= 2 && dr.data.rounds.length === 14, `drafts: ${dr.data.summary?.completed} completed, 14 rounds`);
  check(dr.data.rounds[0].ovr > dr.data.rounds[13].ovr, `early picks are stronger (round 1: ${dr.data.rounds[0].ovr.toFixed(1)}, round 14: ${dr.data.rounds[13].ovr.toFixed(1)})`);
  check(dr.data.summary.humanAutoPicks >= 28, `auto picks counted: ${dr.data.summary.humanAutoPicks} (the two test players never pick)`);
  check(dr.data.ranks.length === 2 && dr.data.earliest.length >= 1, 'people vs CPU ranks, earliest picks');
  check((await api('/api/admin/matches', { token: st })).status === 403, 'support cannot see the statistics');

  // ------------------------------------------------------------ beta tools
  console.log('\n[tags]');
  const tg = await api('/api/admin/beta/tags', { token: at, body: { usernames: [a.username, b.username, `nobody_${RUN}`], tag: 'friend_tester', action: 'add' } });
  check(tg.status === 200 && tg.data.changed === 2 && tg.data.notFound.join() === `nobody_${RUN}`, 'two players tagged Friend Tester, unknown names reported');
  check(d1<{ tag: string }>(`SELECT tag FROM user_tags WHERE user_id = '${a.id}'`).map((r) => r.tag).join() === 'friend_tester', 'Normal is replaced');
  check((await api('/api/admin/beta/tags', { token: st, body: { usernames: [a.username], tag: 'beta_tester', action: 'add' } })).status === 403, 'support cannot change tags here');
  const testers = await api('/api/admin/beta/testers?tag=friend_tester', { token: st });
  const ta = testers.data.items?.find((x: any) => x.username === a.username);
  check(testers.status === 200 && ta && ta.matches >= 3 && ta.activeDays >= 1, `tester list with activity (${ta?.matches} matches)`);
  check((await api('/api/admin/beta/testers', { token: vt })).status === 403, 'viewer cannot list players');

  console.log('\n[test grants to many players]');
  const req = rid();
  const tgr = await api('/api/admin/beta/test-grants', { token: at, body: { target: { usernames: [a.username, b.username] }, kind: 'COINS', amount: 20000, requestId: req } });
  check(tgr.status === 200 && tgr.data.paid === 2, 'two players paid');
  const again = await api('/api/admin/beta/test-grants', { token: at, body: { target: { usernames: [a.username, b.username] }, kind: 'COINS', amount: 20000, requestId: req } });
  check(again.status === 200 && again.data.paid === 0, 'the same request pays nobody twice');
  const pts = await api('/api/admin/beta/test-grants', { token: at, body: { target: { usernames: [a.username] }, kind: 'POINTS_STANDARD', amount: 300, requestId: rid() } });
  check(pts.data.paid === 1, 'exchange points too');
  check((await api('/api/admin/beta/test-grants', { token: st, body: { target: { usernames: [a.username] }, kind: 'COINS', amount: 1, requestId: rid() } })).status === 403, 'support cannot grant');

  console.log('\n[test data reset]');
  // things to take back: cards and a roster card, gacha pity, missions, the Season Pass
  const draw = await api('/api/gacha/banners/standard/draw', { token: a.token, body: { count: 10, requestId: rid() } });
  check(draw.status === 200, 'ten Standard draws');
  const coll = await api('/api/collection', { token: a.token });
  const owned = (coll.data.items ?? []).map((x: any) => x.playerId as string);
  await api('/api/collection/roster', { method: 'PUT', token: a.token, body: { playerIds: owned.slice(0, 1) } });
  await api('/api/missions/claim-all', { token: a.token, body: {} });
  const pass0 = (await api('/api/pass', { token: a.token })).data;
  const beforeReset = {
    wallet: (await api('/api/currency', { token: a.token })).data.wallet,
    cards: d1<{ n: number }>(`SELECT COUNT(*) AS n FROM user_collections WHERE user_id = '${a.id}'`)[0].n,
    roster: d1<{ n: number }>(`SELECT COUNT(*) AS n FROM collection_draft_rosters WHERE user_id = '${a.id}'`)[0].n,
    pity: d1<{ n: number }>(`SELECT COUNT(*) AS n FROM gacha_pity WHERE user_id = '${a.id}'`)[0].n,
    missions: d1<{ n: number }>(`SELECT COUNT(*) AS n FROM mission_progress WHERE user_id = '${a.id}'`)[0].n,
  };
  check(beforeReset.cards >= 1 && beforeReset.missions >= 1 && pass0.xp > 0 && beforeReset.wallet.coins > 0, `before: ${beforeReset.cards} cards, roster ${beforeReset.roster}, ${beforeReset.missions} missions, pass ${pass0.xp} XP, ${beforeReset.wallet.coins} COINS`);
  check((await api('/api/admin/beta/resets', { token: st, body: { target: { usernames: [a.username] } } })).status === 403, 'support cannot reset');
  const rs = await api('/api/admin/beta/resets', { token: at, body: { target: { usernames: [a.username, `nobody_${RUN}`] }, note: 'e2e' } });
  check(rs.status === 201 && rs.data.players === 1 && rs.data.notFound.length === 1, 'reset prepared for one player');
  const [run1, run2] = await Promise.all([
    api(`/api/admin/beta/resets/${rs.data.id}/run`, { token: at, body: {} }),
    api(`/api/admin/beta/resets/${rs.data.id}/run`, { token: at, body: {} }),
  ]);
  check(run1.status === 200 && run2.status === 200 && (run1.data.done || run2.data.done), 'two runs at the same time finish it');
  const w = (await api('/api/currency', { token: a.token })).data.wallet;
  check(w.coins === 0 && w.gems.total === 0, 'every balance is 0');
  const ledger = d1<{ currency: string; total: number }>(`SELECT currency, SUM(amount) AS total FROM currency_transactions WHERE user_id = '${a.id}' GROUP BY currency`);
  check(ledger.every((l) => l.total === 0), `ledger = balance (${ledger.map((l) => `${l.currency} ${l.total}`).join(', ')})`);
  const resetRows = d1<{ n: number }>(`SELECT COUNT(*) AS n FROM currency_transactions WHERE user_id = '${a.id}' AND reason = 'test_reset'`)[0].n;
  check(resetRows >= 1 && resetRows <= 4, `the reset is in the ledger (${resetRows} row(s), not doubled by the second run)`);
  const pointsLeft = d1<{ s: number; p: number }>(`SELECT standard_points AS s, premium_points AS p FROM exchange_wallets WHERE user_id = '${a.id}'`)[0];
  check(pointsLeft.s === 0 && pointsLeft.p === 0, 'exchange points 0');
  const left = d1<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM user_collections WHERE user_id = '${a.id}') AS cards, (SELECT COUNT(*) FROM collection_draft_rosters WHERE user_id = '${a.id}') AS roster,
            (SELECT COUNT(*) FROM gacha_pity WHERE user_id = '${a.id}') AS pity, (SELECT COUNT(*) FROM mission_progress WHERE user_id = '${a.id}') AS missions,
            (SELECT COUNT(*) FROM reward_claims WHERE user_id = '${a.id}' AND (reward_key LIKE 'mission:%' OR reward_key LIKE 'pass:%')) AS claims,
            (SELECT COUNT(*) FROM season_pass_progress WHERE user_id = '${a.id}') AS pass`,
  )[0];
  check(Object.values(left).every((v) => v === 0), `collection, roster, pity, missions, pass cleared (${JSON.stringify(left)})`);
  const kept = d1<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM room_members WHERE user_id = '${a.id}') AS rooms, (SELECT COUNT(*) FROM gacha_history WHERE user_id = '${a.id}') AS gacha,
            (SELECT COUNT(*) FROM league_ratings WHERE user_id = '${a.id}') AS ratings, (SELECT COUNT(*) FROM user_tags WHERE user_id = '${a.id}' AND tag = 'friend_tester') AS tag`,
  )[0];
  check(kept.rooms >= 1 && kept.gacha >= 10 && kept.ratings === 1 && kept.tag === 1, `records kept (${JSON.stringify(kept)})`);
  check((await api('/api/missions', { token: a.token })).status === 200 && (await api('/api/pass', { token: a.token })).data.xp === 0, 'missions and pass start over');
  const resets = await api('/api/admin/beta/resets', { token: st });
  check(resets.data.items?.[0]?.id === rs.data.id && resets.data.items[0].status === 'completed' && resets.data.items[0].done === 1, 'reset listed as completed');
  check((await api(`/api/admin/audit-logs?action=test_reset_completed`, { token: at })).data.items?.length >= 1, 'reset in the audit log');

  // ------------------------------------------------------------ feedback and report
  console.log('\n[feedback and report]');
  const fb = await api('/api/feedback', { token: b.token, body: { category: 'balance', subject: `p7 ${RUN}`, body: 'CPU が強すぎる気がする' } });
  check(fb.status === 201, 'feedback sent');
  const fd = await api(`/api/admin/feedback/${fb.data.id}`, { token: st });
  check(fd.status === 200 && fd.data.activity.tags.includes('friend_tester') && fd.data.activity.leaguesBefore.length >= 1, 'feedback shows the sender: tags and leagues before it');
  const rep = await api(`/api/admin/beta/report?from=${today()}&to=${today()}&tag=friend_tester`, { token: vt });
  check(rep.status === 200 && rep.data.testers.total >= 2 && rep.data.activity.activeUsers >= 2, `report: ${rep.data.testers?.total} testers, ${rep.data.activity?.activeUsers} active`);
  check(rep.data.ratings.count >= 1 && rep.data.ratings.histogram.draftFun[3] >= 1, 'ratings in the report');
  check(rep.data.abandon.abandoned >= 1 && rep.data.abandon.leagues >= 2, `left before the end: ${rep.data.abandon?.abandoned} of ${rep.data.abandon?.leagues}`);
  check(rep.data.features.find((x: any) => x.key === 'private')?.players >= 2 && rep.data.features.find((x: any) => x.key === 'gacha')?.players >= 1, 'feature use (private rooms, gacha)');
  check(rep.data.feedback.total >= 1 && rep.data.revisit.players >= 2, 'feedback count, revisit');
  check(Array.isArray(rep.data.timer) && rep.data.retention.average !== undefined, 'timer comparison and retention in the report');
  const def = await api('/api/admin/beta/report', { token: vt });
  check(def.status === 200 && def.data.period.days >= 1 && def.data.filter.excludeDevelopers === true, `default period from the first sign-up (${def.data.period?.from} - ${def.data.period?.to})`);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
