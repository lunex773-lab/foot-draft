import { useEffect, useState, type FormEvent } from 'react';
import { adminApi } from './api';
import { fmtInt, fmtPct } from './charts';
import { TAGS, tagLabel } from './InsightsPages';

interface UserView {
  id: string;
  username: string;
  displayName: string;
  status: 'active' | 'suspended';
  createdAt: number;
  lastLoginAt: number | null;
  lastActiveDay: string | null;
  tags: string[];
}

const time = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—');
const MODE: Record<string, string> = { quick: 'クイック', private: 'プライベート', ranked: 'ランク戦', solo: 'ソロ課題', event: 'イベント', collection: 'Collection Draft', match: 'MATCH', draft_match: 'DRAFT MATCH' };
const STATUS_LABEL = { active: '有効', suspended: '停止中' } as const;

/** Users (spec 12-4): search and details */
export function UsersPage({ canWrite, canWallet, openUser }: { canWrite: boolean; canWallet: boolean; openUser?: string | null }) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('created');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: UserView[]; total: number; limit: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(openUser ?? null);

  const load = (e?: FormEvent) => {
    e?.preventDefault();
    const qs = new URLSearchParams({ q, sort, offset: String(offset), limit: '50', ...(tag ? { tag } : {}), ...(status ? { status } : {}) });
    adminApi<{ items: UserView[]; total: number; limit: number }>(`/users?${qs}`)
      .then((r) => (setData(r), setError(null)))
      .catch((err) => setError(String(err.message)));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, status, sort, offset]);

  if (selected) return <UserDetail id={selected} canWrite={canWrite} canWallet={canWallet} onBack={() => (setSelected(null), load())} />;
  return (
    <div>
      <h1>Users</h1>
      <form className="filter-row" onSubmit={(e) => (setOffset(0), load(e))}>
        <input placeholder="ユーザーID・ユーザー名・表示名" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <button className="btn">検索</button>
        <select value={tag} onChange={(e) => (setOffset(0), setTag(e.target.value))} aria-label="タグ">
          <option value="">全タグ</option>
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {tagLabel(t)}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => (setOffset(0), setStatus(e.target.value))} aria-label="状態">
          <option value="">全状態</option>
          <option value="active">有効</option>
          <option value="suspended">停止中</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="並び順">
          <option value="created">登録日が新しい順</option>
          <option value="last_login">最終ログイン順</option>
          <option value="username">ユーザー名順</option>
        </select>
      </form>
      {error && <div className="error">{error}</div>}
      {data && (
        <div className="panel scroll-x">
          <div className="small muted" style={{ marginBottom: 8 }}>
            {fmtInt(data.total)}人中 {data.total ? offset + 1 : 0}〜{Math.min(offset + data.limit, data.total)}人目
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>ユーザー名</th>
                <th>表示名</th>
                <th>登録日</th>
                <th>最終ログイン</th>
                <th>最終アクティブ</th>
                <th>状態</th>
                <th>タグ</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setSelected(u.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(u.id)}>
                  <td>{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>{time(u.createdAt)}</td>
                  <td>{time(u.lastLoginAt)}</td>
                  <td>{u.lastActiveDay ?? '—'}</td>
                  <td>
                    <span className={`status ${u.status === 'active' ? 'published' : 'archived'}`}>{STATUS_LABEL[u.status]}</span>
                  </td>
                  <td>{u.tags.map(tagLabel).join('・')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.limit))}>
              前へ
            </button>
            <button className="btn" disabled={offset + data.limit >= data.total} onClick={() => setOffset(offset + data.limit)}>
              次へ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Detail {
  user: UserView;
  stats: { leagues: number; leagueWins: number; matches: number; matchWins: number; matchDraws: number; winRate: number | null };
  logins: { event_name: string; timestamp: number; platform: string | null; app_version: string | null }[];
  leagues: { room_id: string; mode: string; status: string; created_at: number; final_rank: number | null; points: number | null }[];
  drafts: { draft_id: string; room_id: string; started_at: number; picks: number; auto_picks: number }[];
  collection: { player_id: string; name: string; rarity: string; source: string; obtained_at: number }[];
  feedback: { id: string; category: string; subject: string; status: string; priority: string; created_at: number }[];
  economy: null | {
    wallet: { coins: number; gems: { free: number; paidPurchased: number; paidGranted: number }; points: { standard: number; premium: number } };
    ledger: { currency: string; amount: number; balance_after: number; reason: string; created_at: number }[];
    gacha: { draw_id: string; idx: number; name: string; rarity: string; guarantee: string; is_duplicate: number; points: number; created_at: number; banner_id: string }[];
  };
  purchases: null | {
    implemented: boolean;
    items: { id: string; product_name: string; store: string; status: string; price_jpy: number; gems_purchased: number; gems_granted: number; is_renewal: number; created_at: number }[];
    membership: { active: boolean; autoRenew: boolean; periodEnd: number | null };
  };
}

const EVENT_LABEL: Record<string, string> = { login_succeeded: 'ログイン', session_started: 'ゲームを開いた', login_failed: 'ログイン失敗' };

function UserDetail({ id, canWrite, canWallet, onBack }: { id: string; canWrite: boolean; canWallet: boolean; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () =>
    adminApi<Detail>(`/users/${encodeURIComponent(id)}`)
      .then((r) => (setD(r), setTags(r.user.tags)))
      .catch((e) => setError(String(e.message)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const patch = async (body: Record<string, unknown>, done: string) => {
    setError(null);
    try {
      await adminApi(`/users/${d!.user.id}`, body, 'PATCH');
      setMsg(done);
      load();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  if (!d) return <div className="muted">{error ?? '読み込み中…'}</div>;
  const u = d.user;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <button className="link-btn small" onClick={onBack}>
          ← ユーザー一覧
        </button>
        <h1 style={{ marginTop: 6 }}>
          {u.displayName}（{u.username}）
        </h1>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="small" style={{ color: 'var(--accent)' }}>{msg}</div>}
      <div className="grid2">
        <div className="panel">
          <h3>登録情報</h3>
          <dl className="kv">
            <dt>ユーザーID</dt>
            <dd className="mono">{u.id}</dd>
            <dt>登録日</dt>
            <dd>{time(u.createdAt)}</dd>
            <dt>最終ログイン</dt>
            <dd>{time(u.lastLoginAt)}</dd>
            <dt>最終アクティブ</dt>
            <dd>{u.lastActiveDay ?? '—'}</dd>
            <dt>状態</dt>
            <dd>{STATUS_LABEL[u.status]}</dd>
          </dl>
          {canWrite && (
            <div className="row" style={{ marginTop: 10 }}>
              {u.status === 'active' ? (
                <button
                  className="btn danger"
                  onClick={() => {
                    const reason = window.prompt('停止の理由（操作ログに残ります）');
                    if (reason !== null) patch({ status: 'suspended', reason }, 'アカウントを停止しました（ログイン中の端末もログアウト）');
                  }}
                >
                  アカウントを停止
                </button>
              ) : (
                <button className="btn" onClick={() => patch({ status: 'active' }, 'アカウントを再開しました')}>
                  停止を解除
                </button>
              )}
            </div>
          )}
        </div>
        <div className="panel">
          <h3>タグ（ベータテスト）</h3>
          <div className="row">
            {TAGS.map((t) => (
              <label key={t} className="toggle">
                <input type="checkbox" disabled={!canWrite} checked={tags.includes(t)} onChange={(e) => setTags(e.target.checked ? [...tags, t] : tags.filter((x) => x !== t))} />
                {tagLabel(t)}
              </label>
            ))}
          </div>
          {canWrite && (
            <button className="btn" style={{ marginTop: 10 }} disabled={tags.slice().sort().join() === u.tags.slice().sort().join()} onClick={() => patch({ tags }, 'タグを保存しました')}>
              タグを保存
            </button>
          )}
          <h3 style={{ marginTop: 14 }}>成績</h3>
          <div className="small">
            リーグ {d.stats.leagues}回（1位 {d.stats.leagueWins}回）・試合 {d.stats.matches}（{d.stats.matchWins}勝 {d.stats.matchDraws}分）・勝率 {fmtPct(d.stats.winRate)}
          </div>
        </div>
      </div>

      {canWallet && d.economy && (
        <div className="grid2">
          <div className="panel">
            <h3>残高</h3>
            <div className="small">
              COINS {fmtInt(d.economy.wallet.coins)}・無償GEMS {fmtInt(d.economy.wallet.gems.free)}・有償GEMS（購入）{fmtInt(d.economy.wallet.gems.paidPurchased)}・有償GEMS（配布）{fmtInt(d.economy.wallet.gems.paidGranted)}
              <br />
              Standardポイント {fmtInt(d.economy.wallet.points.standard)}・Premiumポイント {fmtInt(d.economy.wallet.points.premium)}
            </div>
            <h3 style={{ marginTop: 12 }}>通貨の取引履歴（最新50件）</h3>
            <div className="scroll-x" style={{ maxHeight: 300 }}>
              <table className="tbl tiny">
                <tbody>
                  {d.economy.ledger.map((l, i) => (
                    <tr key={i}>
                      <td>{time(l.created_at)}</td>
                      <td>{l.reason}</td>
                      <td>{l.currency}</td>
                      <td className="num">{l.amount > 0 ? `+${fmtInt(l.amount)}` : fmtInt(l.amount)}</td>
                      <td className="num">{fmtInt(l.balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <h3>ガシャ履歴（最新50枚）</h3>
            <div className="scroll-x" style={{ maxHeight: 300 }}>
              <table className="tbl tiny">
                <tbody>
                  {d.economy.gacha.length === 0 && (
                    <tr>
                      <td className="muted">なし</td>
                    </tr>
                  )}
                  {d.economy.gacha.map((g) => (
                    <tr key={`${g.draw_id}-${g.idx}`}>
                      <td>{time(g.created_at)}</td>
                      <td>{g.banner_id}</td>
                      <td>{g.name}</td>
                      <td className={`rar-${g.rarity}`}>{g.rarity}</td>
                      <td>{g.is_duplicate ? `重複 +${g.points}pt` : 'NEW'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 style={{ marginTop: 12 }}>購入履歴</h3>
            {d.purchases && (
              <>
                <div className="small">
                  Premium Membership：{d.purchases.membership.active ? `会員（${d.purchases.membership.autoRenew ? '自動更新あり' : '自動更新なし'}・${time(d.purchases.membership.periodEnd)}まで）` : 'なし'}
                </div>
                <table className="tbl tiny">
                  <tbody>
                    {d.purchases.items.length === 0 && (
                      <tr>
                        <td className="muted">なし</td>
                      </tr>
                    )}
                    {d.purchases.items.map((p) => (
                      <tr key={p.id}>
                        <td>{time(p.created_at)}</td>
                        <td>
                          {p.product_name}
                          {p.is_renewal ? '（更新）' : ''}
                        </td>
                        <td>¥{fmtInt(p.price_jpy)}</td>
                        <td>{p.status}</td>
                        <td>{p.store === 'mock' ? '模擬' : p.store}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="panel">
          <h3>プレイ履歴（最新30件）</h3>
          <div className="scroll-x" style={{ maxHeight: 280 }}>
            <table className="tbl tiny">
              <tbody>
                {d.leagues.map((l) => (
                  <tr key={l.room_id}>
                    <td>{time(l.created_at)}</td>
                    <td>{MODE[l.mode] ?? l.mode}</td>
                    <td>{l.status}</td>
                    <td>{l.final_rank ? `${l.final_rank}位（${l.points}点）` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ marginTop: 12 }}>ドラフト履歴（最新20件）</h3>
          <div className="scroll-x" style={{ maxHeight: 200 }}>
            <table className="tbl tiny">
              <tbody>
                {d.drafts.map((x) => (
                  <tr key={x.draft_id}>
                    <td>{time(x.started_at)}</td>
                    <td>{x.picks}回指名</td>
                    <td>うち自動 {x.auto_picks}回</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>ログイン履歴（最新30件）</h3>
          <div className="scroll-x" style={{ maxHeight: 200 }}>
            <table className="tbl tiny">
              <tbody>
                {d.logins.map((l, i) => (
                  <tr key={i}>
                    <td>{time(l.timestamp)}</td>
                    <td>{EVENT_LABEL[l.event_name] ?? l.event_name}</td>
                    <td>{l.platform ?? ''}</td>
                    <td>{l.app_version ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ marginTop: 12 }}>コレクション（{d.collection.length}枚）</h3>
          <div className="small">{d.collection.slice(0, 40).map((c) => c.name).join('、') || 'なし'}</div>
          <h3 style={{ marginTop: 12 }}>フィードバック</h3>
          {d.feedback.length === 0 && <div className="small muted">なし</div>}
          {d.feedback.map((f) => (
            <div key={f.id} className="small">
              {time(f.created_at)}　{f.subject}（{f.status}・{f.priority}）
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
