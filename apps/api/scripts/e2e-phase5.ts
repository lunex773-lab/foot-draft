/**
 * Phase 5 end-to-end test against a running local API (`npm run dev -w @fd/api`).
 *
 *   npm run e2e:phase5 -w @fd/api
 *
 *  - roles (owner / admin / support / viewer): who can reach what
 *  - admin accounts: owner creates admins, changes roles; last owner protected; password change
 *  - sessions -> active players (DAU), play time
 *  - retention: a cohort with known activity gives the expected D1
 *  - feedback: send (auto-recorded device / version / error code), limits, own only,
 *    admin status / priority / internal note / reply, the player sees the reply but not the note
 *  - users: search, details, tags, suspension (logged out, cannot log in)
 *  - FREE GEMS distribution: preview, limits, suspended players excluded, create (idempotent),
 *    run in chunks, paid once, reconciliation, cancel
 *  - audit log filters
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';
const RUN = Math.random().toString(36).slice(2, 8);
/** app version reported by this run (unique, so earlier runs do not count) */
const VERSION = `e2e-${RUN}`;
const HERE = dirname(fileURLToPath(import.meta.url));
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
let failures = 0;

function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T = any>(path: string, opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; data: T }> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${API}${path}`, {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
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
      // the local dev server can drop a connection right after `wrangler d1 execute`
      if (i >= 4) throw e;
      await sleep(1000);
    }
  }
}

function d1(sql: string) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', sql], { cwd: join(HERE, '..'), stdio: ['ignore', 'ignore', 'inherit'] });
}

async function register(name: string) {
  const username = `${name}_${RUN}`;
  const r = await api<{ token: string; user: { id: string } }>('/api/auth/register', { body: { username, password: 'password-1234', displayName: name } });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.data)}`);
  return { username, token: r.data.token, id: r.data.user.id };
}

async function adminLogin(name: string, password = 'admin-password-123') {
  const r = await api('/api/admin/auth/login', { body: { username: name, password } });
  if (r.status !== 200) throw new Error(`admin login ${name} failed ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token as string;
}

const jstDay = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`) - 9 * 3600_000;

async function main() {
  console.log(`Phase 5 E2E against ${API} (run ${RUN})`);

  // ------------------------------------------------------------ admin accounts and roles
  console.log('\n[roles and admin accounts]');
  const ownerName = `owner_${RUN}`;
  execFileSync('npx', ['tsx', join(HERE, 'create-admin.ts'), '--local', '--username', ownerName, '--role', 'owner', '--no-totp'], {
    env: { ...process.env, FD_ADMIN_PASSWORD: 'admin-password-123' },
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await sleep(1000);
  const ot = await adminLogin(ownerName);
  const mk = async (role: string) => {
    const name = `${role}_${RUN}`;
    const r = await api('/api/admin/admins', { token: ot, body: { username: name, role, password: 'admin-password-123' } });
    return { name, id: r.data.id as string, status: r.status };
  };
  const adm = await mk('admin');
  const sup = await mk('support');
  const vie = await mk('viewer');
  check(adm.status === 201 && sup.status === 201 && vie.status === 201, 'owner creates admin / support / viewer accounts');
  const at = await adminLogin(adm.name);
  const st = await adminLogin(sup.name);
  const vt = await adminLogin(vie.name);
  const me = await api('/api/admin/auth/me', { token: st });
  check(me.data.admin.role === 'support' && me.data.admin.permissions.includes('feedback.write') && !me.data.admin.permissions.includes('analytics.read'), 'support permissions');
  check((await api('/api/admin/admins', { token: at, body: { username: `x_${RUN}`, role: 'viewer', password: 'admin-password-123' } })).status === 403, 'admin cannot create admins (owner only)');
  check((await api(`/api/admin/admins/${adm.id}`, { method: 'PATCH', token: at, body: { role: 'owner' } })).status === 403, 'admin cannot change roles');
  const ownerMe = await api('/api/admin/auth/me', { token: ot });
  check((await api(`/api/admin/admins/${ownerMe.data.admin.id}`, { method: 'PATCH', token: ot, body: { role: 'viewer' } })).status === 403, 'owner cannot change the own role');

  const player = await register('p5a');
  const matrix: [string, string, Record<string, number>][] = [
    ['GET', '/api/admin/overview', { owner: 200, admin: 200, support: 403, viewer: 200 }],
    ['GET', '/api/admin/analytics', { owner: 200, admin: 200, support: 403, viewer: 200 }],
    ['GET', '/api/admin/retention', { owner: 200, admin: 200, support: 403, viewer: 200 }],
    ['GET', '/api/admin/economy', { owner: 200, admin: 200, support: 403, viewer: 200 }],
    ['GET', '/api/admin/users', { owner: 200, admin: 200, support: 200, viewer: 403 }],
    ['GET', `/api/admin/users/${player.id}`, { owner: 200, admin: 200, support: 200, viewer: 403 }],
    ['GET', '/api/admin/feedback', { owner: 200, admin: 200, support: 200, viewer: 403 }],
    ['GET', '/api/admin/distributions', { owner: 200, admin: 200, support: 403, viewer: 403 }],
    ['GET', '/api/admin/admins', { owner: 200, admin: 403, support: 403, viewer: 403 }],
    ['GET', '/api/admin/audit-logs', { owner: 200, admin: 200, support: 403, viewer: 403 }],
  ];
  const tokens: Record<string, string> = { owner: ot, admin: at, support: st, viewer: vt };
  let matrixOk = true;
  for (const [, path, expect] of matrix) {
    for (const [role, code] of Object.entries(expect)) {
      const r = await api(path, { token: tokens[role] });
      if (r.status !== code) {
        matrixOk = false;
        console.log(`    ${role} ${path}: ${r.status} (expected ${code})`);
      }
    }
    if ((await api(path, { token: player.token })).status !== 401) {
      matrixOk = false;
      console.log(`    player token ${path} was not refused`);
    }
  }
  check(matrixOk, 'each role reaches only its pages (10 endpoints x 4 roles); player tokens are refused');
  const econViewer = await api('/api/admin/economy', { token: vt });
  check(econViewer.data.topGemSpenders === null, 'viewer sees economy totals but no individual players');
  const supDetail = await api(`/api/admin/users/${player.id}`, { token: st });
  check(supDetail.data.economy?.wallet !== undefined, 'support sees balances of a player (read only)');
  check((await api(`/api/admin/users/${player.id}`, { method: 'PATCH', token: st, body: { tags: ['beta_tester'] } })).status === 403, 'support cannot change tags');

  // password change
  const at2 = await adminLogin(adm.name);
  check((await api('/api/admin/auth/password', { token: at, body: { currentPassword: 'wrong-password-000', newPassword: 'new-password-4567' } })).status === 401, 'password change with a wrong current password is refused');
  const pw = await api('/api/admin/auth/password', { token: at, body: { currentPassword: 'admin-password-123', newPassword: 'new-password-4567' } });
  check(pw.status === 200 && (await api('/api/admin/auth/me', { token: at })).status === 200 && (await api('/api/admin/auth/me', { token: at2 })).status === 401, 'password changed: the current session stays, other sessions end');
  check((await api('/api/admin/auth/login', { body: { username: adm.name, password: 'new-password-4567' } })).status === 200, 'login with the new password');
  // a disabled admin is logged out
  const dis = await api(`/api/admin/admins/${vie.id}`, { method: 'PATCH', token: ot, body: { status: 'disabled' } });
  check(dis.status === 200 && (await api('/api/admin/overview', { token: vt })).status === 401, 'a disabled admin is logged out');
  await api(`/api/admin/admins/${vie.id}`, { method: 'PATCH', token: ot, body: { status: 'active' } });
  const vt2 = await adminLogin(vie.name);

  // ------------------------------------------------------------ sessions and activity
  console.log('\n[sessions, activity, retention]');
  const sid = `s-${RUN}-1234`;
  check((await api('/api/sessions/start', { token: player.token, body: { sessionId: sid }, headers: { 'X-FD-Platform': 'web', 'X-FD-App-Version': VERSION } })).status === 200, 'session started');
  check((await api('/api/sessions/end', { token: player.token, body: { sessionId: sid, durationMs: 120_000 }, headers: { 'X-FD-Platform': 'web', 'X-FD-App-Version': VERSION } })).status === 200, 'session ended (2 min)');
  const today = jstDay(Date.now());
  const an = await api(`/api/admin/analytics?from=${today}&to=${today}&version=${VERSION}`, { token: vt2 });
  check(an.status === 200 && an.data.dau === 1 && an.data.sessions === 1 && an.data.avgSessionMs === 120_000, `analytics filtered by version ${VERSION}: DAU 1, 1 session of 2 min (dau ${an.data.dau}, sessions ${an.data.sessions})`);
  check(an.data.options.versions.includes(VERSION), 'filters offer the app versions seen');

  // cohort with known activity: registered 3 days ago, active the next day (founder tag only on this player)
  const cohortUser = await register('p5cohort');
  const day0 = addDays(today, -3);
  d1(
    `UPDATE users SET created_at = ${dayStart(day0) + 3600_000} WHERE id = '${cohortUser.id}'; ` +
      `DELETE FROM user_tags WHERE tag = 'founder'; INSERT INTO user_tags (user_id, tag, created_at) VALUES ('${cohortUser.id}', 'founder', 0); ` +
      `DELETE FROM analytics_events WHERE user_id = '${cohortUser.id}'; ` +
      `INSERT INTO analytics_events (event_id, event_name, user_id, timestamp, environment) VALUES ('e2e-${RUN}-1', 'session_started', '${cohortUser.id}', ${dayStart(addDays(day0, 1)) + 7200_000}, 'local'); ` +
      `DELETE FROM metrics_days WHERE day_key >= '${day0}'`,
  );
  const ret = await api(`/api/admin/retention?from=${day0}&to=${day0}&tag=founder`, { token: vt2 });
  const coh = ret.data.cohorts?.[0];
  check(coh && coh.day === day0 && coh.size === 1 && coh.rates[1] === 1 && coh.rates[3] === null && coh.rates[7] === null, `retention: cohort ${day0} size 1, D1 100%, D3 not finished yet`);
  const series = await api(`/api/admin/analytics?from=${day0}&to=${today}&tag=founder`, { token: vt2 });
  const s1 = series.data.series.find((r: any) => r.day === addDays(day0, 1));
  check(s1?.active === 1 && series.data.series.find((r: any) => r.day === day0)?.newUsers === 1, 'daily series: registration on day 0, active on day 1');
  check(ret.data.groups && 'friend_tester' in ret.data.groups, 'retention compares friend testers, beta testers and normal players');
  const ov = await api('/api/admin/overview', { token: vt2 });
  check(ov.status === 200 && ov.data.totals.users > 0 && ov.data.current.dau >= 1 && ov.data.revenue.implemented === true && ov.data.revenue.storesConnected === false, 'overview: totals, DAU, revenue (stores not connected yet)');
  check(ov.data.series.length === 14 && ov.data.previous.to === addDays(ov.data.period.from, -1), 'overview: 14 days and the previous period for comparison');

  // ------------------------------------------------------------ feedback
  console.log('\n[feedback]');
  const other = await register('p5b');
  const fb = await api('/api/feedback', {
    token: player.token,
    headers: { 'User-Agent': IPHONE, 'X-FD-Platform': 'web', 'X-FD-App-Version': VERSION },
    body: { category: 'bug', subject: 'ドラフトが止まる', body: '3巡目で画面が止まりました。', wantsReply: true, context: { errorCode: 'NOT_YOUR_TURN' } },
  });
  check(fb.status === 201 && /^fb-/.test(fb.data.id), 'player sends feedback');
  check((await api('/api/feedback', { token: player.token, body: { category: 'spam', subject: 'x', body: 'y' } })).status === 400, 'unknown category refused');
  check((await api(`/api/feedback/${fb.data.id}`, { token: other.token })).status === 404, "another player cannot read it");
  const adminFb = await api(`/api/admin/feedback/${fb.data.id}`, { token: st });
  const f = adminFb.data.feedback;
  check(f.os === 'iOS' && f.device_type === 'mobile' && f.app_version === VERSION && f.error_code === 'NOT_YOUR_TURN' && f.status === 'new' && f.wants_reply === 1, `recorded automatically: iOS, mobile, version ${VERSION}, last error code`);
  const upd = await api(`/api/admin/feedback/${fb.data.id}`, { method: 'PATCH', token: st, body: { status: 'investigating', priority: 'high', body: 'changed!' } });
  check(upd.data.feedback.status === 'investigating' && upd.data.feedback.priority === 'high' && upd.data.feedback.body === '3巡目で画面が止まりました。', 'status / priority changed, the original text stays');
  await api(`/api/admin/feedback/${fb.data.id}/notes`, { token: st, body: { body: '内部メモ：再現手順を確認中' } });
  const rep = await api(`/api/admin/feedback/${fb.data.id}/replies`, { token: st, body: { body: 'ご報告ありがとうございます。調査しています。' } });
  check(rep.status === 201 && rep.data.notes.length === 1 && rep.data.replies.length === 1 && rep.data.history.length >= 3, 'note and reply saved, operations in the history');
  const list = await api('/api/feedback', { token: player.token });
  check(list.data.unread === 1 && list.data.items[0].replies === 1, 'the player sees 1 unread reply');
  const mine = await api(`/api/feedback/${fb.data.id}`, { token: player.token });
  check(mine.data.replies.length === 1 && !('notes' in mine.data) && !JSON.stringify(mine.data).includes('内部メモ'), 'the player sees the reply, never the internal note');
  check((await api('/api/feedback', { token: player.token })).data.unread === 0, 'reply marked as read');
  check((await api('/api/admin/feedback?status=open', { token: at })).data.items.some((x: any) => x.id === fb.data.id), 'admin list: open feedback');
  let limited = 0;
  for (let i = 0; i < 10; i++) {
    const r = await api('/api/feedback', { token: other.token, body: { category: 'other', subject: `t${i}`, body: 'test' } });
    if (r.status === 429) limited++;
  }
  check(limited === 0 && (await api('/api/feedback', { token: other.token, body: { category: 'other', subject: 't10', body: 'test' } })).status === 429, '10 messages per day, the 11th is refused');

  // ------------------------------------------------------------ users
  console.log('\n[users]');
  const search = await api(`/api/admin/users?q=${player.username}`, { token: st });
  check(search.data.items.length === 1 && search.data.items[0].id === player.id && search.data.items[0].tags.includes('normal'), 'search by username');
  const detail = await api(`/api/admin/users/${player.id}`, { token: at });
  check(detail.data.feedback.length === 1 && detail.data.logins.length >= 1 && Array.isArray(detail.data.purchases.items), 'details: feedback, login history, purchases');
  const tags = await api(`/api/admin/users/${player.id}`, { method: 'PATCH', token: at, body: { tags: ['friend_tester', 'beta_tester'] } });
  check(tags.status === 200 && tags.data.user.tags.sort().join() === 'beta_tester,friend_tester', 'admin sets tags');
  const sus = await api(`/api/admin/users/${other.id}`, { method: 'PATCH', token: at, body: { status: 'suspended', reason: 'test' } });
  check(sus.data.user.status === 'suspended' && (await api('/api/users/me', { token: other.token })).status === 401, 'suspended: logged out');
  check((await api('/api/auth/login', { body: { username: other.username, password: 'password-1234' } })).status === 401, 'suspended: cannot log in');

  // ------------------------------------------------------------ distribution
  console.log('\n[FREE GEMS distribution]');
  const third = await register('p5c');
  const pv = await api('/api/admin/distributions/preview', { token: at, body: { target: { kind: 'users', usernames: [player.username, third.username, other.username, 'nobody_here'] }, amount: 100 } });
  check(pv.data.count === 2 && pv.data.total === 200 && pv.data.notFound.length === 2 && pv.data.problems.length === 0, 'preview: 2 players (suspended and unknown names excluded), total 200');
  const big = await api('/api/admin/distributions/preview', { token: at, body: { target: { kind: 'users', usernames: [player.username] }, amount: 1001 } });
  check(big.data.problems.length === 1, 'more than 1,000 per player is refused');
  check((await api('/api/admin/distributions/preview', { token: vt2, body: { target: { kind: 'all' }, amount: 1 } })).status === 403, 'viewer cannot distribute');
  const req = `dist-${RUN}-req0001`;
  const body = { reason: 'beta_reward', title: 'ベータテスト参加のお礼', target: { kind: 'users', usernames: [player.username, third.username] }, amount: 100, requestId: req };
  const cr = await api('/api/admin/distributions', { token: at, body });
  const cr2 = await api('/api/admin/distributions', { token: at, body });
  check(cr.status === 201 && cr.data.batch.status === 'ready' && cr2.data.batch.id === cr.data.batch.id, 'created (ready); the same request id does not create a second one');
  const id = cr.data.batch.id as string;
  const before = (await api('/api/currency', { token: player.token })).data.wallet.gems.free;
  const [r1, r2] = await Promise.all([api(`/api/admin/distributions/${id}/run`, { token: at, body: {} }), api(`/api/admin/distributions/${id}/run`, { token: ot, body: {} })]);
  const after = (await api('/api/currency', { token: player.token })).data.wallet.gems.free;
  check((r1.data.done || r2.data.done) && after === before + 100, `two simultaneous runs pay once (+${after - before})`);
  const dd = await api(`/api/admin/distributions/${id}`, { token: at });
  check(dd.data.batch.status === 'completed' && dd.data.progress.granted === 2 && dd.data.reconciliation.ok === true, 'completed, reconciliation: items = claims = ledger');
  check((await api(`/api/admin/distributions/${id}/run`, { token: at, body: {} })).status === 409, 'a completed distribution cannot run again');
  const led = await api('/api/currency/history?currency=GEMS_FREE', { token: third.token });
  check(led.data.items[0]?.reason === 'distribution' && led.data.items[0]?.amount === 100, 'the player ledger shows the distribution');
  // by tag, many players, in chunks
  const tagCr = await api('/api/admin/distributions', { token: at, body: { reason: 'campaign', title: 'friend testers', target: { kind: 'tags', tags: ['friend_tester'] }, amount: 5, requestId: `dist-${RUN}-req0002` } });
  check(tagCr.status === 201 && tagCr.data.batch.target_count >= 1, `tag target: ${tagCr.data.batch?.target_count} friend tester(s)`);
  const allCr = await api('/api/admin/distributions', { token: at, body: { reason: 'test_play', title: 'everyone', target: { kind: 'all' }, amount: 1, requestId: `dist-${RUN}-req0003` } });
  let runs = 0;
  for (;;) {
    const r = await api(`/api/admin/distributions/${allCr.data.batch.id}/run`, { token: at, body: {} });
    runs++;
    if (r.data.done || runs > 50) break;
  }
  const all = await api(`/api/admin/distributions/${allCr.data.batch.id}`, { token: at });
  check(all.data.batch.status === 'completed' && all.data.progress.granted === all.data.batch.target_count && all.data.reconciliation.ok, `all players (${all.data.batch.target_count}) paid in ${runs} run(s), reconciliation ok`);
  // cancel
  const cc = await api('/api/admin/distributions', { token: at, body: { reason: 'other', title: 'cancel me', target: { kind: 'users', usernames: [player.username] }, amount: 10, requestId: `dist-${RUN}-req0004` } });
  const can = await api(`/api/admin/distributions/${cc.data.batch.id}/cancel`, { token: at, body: {} });
  check(can.status === 200 && can.data.progress.skipped === 1 && (await api(`/api/admin/distributions/${cc.data.batch.id}/run`, { token: at, body: {} })).status === 409, 'cancelled before running: nobody paid');

  // ------------------------------------------------------------ audit log
  console.log('\n[audit log]');
  const logs = await api(`/api/admin/audit-logs?action=distribution_completed&admin=${adm.name}`, { token: ot });
  check(logs.data.items.length >= 2 && logs.data.items.every((l: any) => l.action === 'distribution_completed'), 'filter by action and admin');
  check(logs.data.actions.includes('feedback_replied') && logs.data.actions.includes('user_suspended') && logs.data.actions.includes('admin_created'), 'operations are logged (reply, suspension, admin created)');

  // restore the suspended test player
  await api(`/api/admin/users/${other.id}`, { method: 'PATCH', token: at, body: { status: 'active' } });

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
