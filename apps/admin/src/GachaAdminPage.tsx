import { useEffect, useMemo, useState } from 'react';
import { adminApi } from './api';
import { confirmDialog } from './dialog';
import { fmtInt } from './charts';

const RARITIES = ['common', 'rare', 'epic', 'legendary', 'icon'] as const;
type Rarity = (typeof RARITIES)[number];
const STATUS_LABEL: Record<string, string> = { draft: '下書き', published: '公開中', archived: '終了' };

/** Japan time <-> datetime-local */
const toLocal = (ms: number | null) => (ms ? new Date(ms + 9 * 3600_000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? Date.parse(`${v}:00Z`) - 9 * 3600_000 : null);
const time = (ms: number | null) => (ms ? new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—');

interface Row {
  id: string;
  kind: 'standard' | 'premium';
  series_id: string;
  name: string;
  status: string;
  rates_version: number;
  cost_currency: string;
  cost_single: number;
  cost_multi: number;
  accepts_free_gems?: number;
  starts_at: number;
  ends_at: number | null;
  pool_size: number;
  draws: number;
}

interface Detail {
  banner: Row & { description: string; pity: { epicAt: number; legendaryAt: number; bonusEvery: number } | null; sort_order: number };
  ratesPpm: Record<Rarity, number>;
  poolIds: string[];
  versions: { version: number; change_note: string | null; created_at: number; changed_by: string | null }[];
  draws: { rates_version: number; n: number; cards: number }[];
}

interface Card {
  id: string;
  name: string;
  rarity: Rarity;
}

/** Gacha management (decision 58) */
export function GachaAdminPage({ canWrite }: { canWrite: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const load = () => adminApi<{ items: Row[] }>('/gacha/banners').then((r) => setRows(r.items));
  useEffect(() => {
    load();
  }, []);
  if (editing) return <GachaEditor id={editing === 'new' ? null : editing} canWrite={canWrite} onBack={() => (setEditing(null), load())} />;
  return (
    <div>
      <div className="spread">
        <h1>ガシャ管理</h1>
        {canWrite && (
          <button className="btn primary" onClick={() => setEditing('new')}>
            新しいガシャ
          </button>
        )}
      </div>
      <div className="small muted" style={{ marginBottom: 12 }}>
        下書きはプレイヤーに見えません。公開中のガシャを変更すると新しい版として記録され、プレイヤーのガシャ画面に変更履歴が表示されます。
      </div>
      <div className="panel scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>ガシャ</th>
              <th>種類</th>
              <th>状態</th>
              <th className="num">版</th>
              <th>価格</th>
              <th className="num">候補</th>
              <th className="num">抽選回数</th>
              <th>期間（日本時間）</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} className="clickable" tabIndex={0} onClick={() => setEditing(r.id)} onKeyDown={(e) => e.key === 'Enter' && setEditing(r.id)}>
                <td>
                  {r.name}
                  <div className="tiny muted">
                    {r.id}・シリーズ {r.series_id}
                  </div>
                </td>
                <td>{r.kind === 'premium' ? 'Premium' : 'Standard'}</td>
                <td>{STATUS_LABEL[r.status]}</td>
                <td className="num">v{r.rates_version}</td>
                <td>
                  {fmtInt(r.cost_single)}／{fmtInt(r.cost_multi)} {r.cost_currency === 'COINS' ? 'COINS' : r.accepts_free_gems ? 'GEMS（無償も可）' : '有償GEMS'}
                </td>
                <td className="num">{r.pool_size}</td>
                <td className="num">{fmtInt(r.draws)}</td>
                <td className="small">
                  {time(r.starts_at)} 〜 {r.ends_at ? time(r.ends_at) : '常設'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GachaEditor({ id: openedId, canWrite, onBack }: { id: string | null; canWrite: boolean; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  // after "create", the editor continues with the new banner
  const id = openedId ?? detail?.banner.id ?? null;
  const [cards, setCards] = useState<Card[]>([]);
  const [form, setForm] = useState({
    id: '',
    kind: 'premium' as 'standard' | 'premium',
    seriesId: '',
    name: '',
    description: '',
    costSingle: 100,
    costMulti: 1000,
    acceptsFreeGems: true,
    rates: { common: '0', rare: '65', epic: '25', legendary: '9', icon: '1' } as Record<Rarity, string>,
    pityOn: true,
    pity: { epicAt: 50, legendaryAt: 100, bonusEvery: 150 },
    included: { common: false, rare: true, epic: true, legendary: true, icon: true } as Record<Rarity, boolean>,
    excluded: '',
    startsAt: toLocal(Date.now()),
    endsAt: '',
    changeNote: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fill = (d: Detail) => {
    setDetail(d);
    const b = d.banner;
    const inPool = new Set(d.poolIds);
    const present = new Set(cards.filter((c) => inPool.has(c.id)).map((c) => c.rarity));
    setForm((f) => ({
      ...f,
      id: b.id,
      kind: b.kind,
      seriesId: b.series_id,
      name: b.name,
      description: b.description,
      costSingle: b.cost_single,
      costMulti: b.cost_multi,
      acceptsFreeGems: b.accepts_free_gems === 1,
      rates: Object.fromEntries(RARITIES.map((r) => [r, String((d.ratesPpm[r] ?? 0) / 10_000)])) as Record<Rarity, string>,
      pityOn: !!b.pity,
      pity: b.pity ?? f.pity,
      included: Object.fromEntries(RARITIES.map((r) => [r, present.has(r)])) as Record<Rarity, boolean>,
      excluded: cards
        .filter((c) => present.has(c.rarity) && !inPool.has(c.id))
        .map((c) => c.id)
        .join(' '),
      startsAt: toLocal(b.starts_at),
      endsAt: toLocal(b.ends_at),
      changeNote: '',
    }));
  };

  useEffect(() => {
    adminApi<{ items: Card[] }>('/cards?limit=500').then((r) => setCards(r.items));
  }, []);
  useEffect(() => {
    if (openedId && cards.length) adminApi<Detail>(`/gacha/banners/${openedId}`).then(fill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedId, cards.length]);

  const pool = useMemo(() => {
    const ex = new Set(form.excluded.split(/[\s,、]+/).filter(Boolean));
    return cards.filter((c) => form.included[c.rarity] && !ex.has(c.id)).map((c) => c.id);
  }, [cards, form.included, form.excluded]);
  const ppm = (r: Rarity) => Math.round(Number(form.rates[r] || 0) * 10_000);
  const sum = RARITIES.reduce((s, r) => s + ppm(r), 0);
  const status = detail?.banner.status ?? 'draft';
  const locked = !canWrite || status === 'archived';

  const payload = () => ({
    id: form.id,
    kind: form.kind,
    seriesId: form.seriesId,
    name: form.name,
    description: form.description,
    costSingle: Number(form.costSingle),
    costMulti: Number(form.costMulti),
    acceptsFreeGems: form.kind === 'premium' && form.acceptsFreeGems,
    ratesPpm: Object.fromEntries(RARITIES.map((r) => [r, ppm(r)])),
    pity: form.kind === 'premium' && form.pityOn ? form.pity : null,
    poolIds: pool,
    startsAt: fromLocal(form.startsAt),
    endsAt: fromLocal(form.endsAt),
    changeNote: form.changeNote,
  });

  const act = async (fn: () => Promise<Detail>, done: string) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      fill(await fn());
      setMsg(done);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 980 }}>
      <div>
        <button className="link-btn small" onClick={onBack}>
          ← ガシャの一覧
        </button>
        <h1 style={{ marginTop: 6 }}>
          {id ? form.name || id : '新しいガシャ'} {detail && <span className="small muted">（{STATUS_LABEL[status]}・v{detail.banner.rates_version}）</span>}
        </h1>
      </div>
      <div className="grid2">
        <div className="panel form-grid1">
          <h3>基本</h3>
          <label className="form-field">
            ID（英小文字・数字・-）
            <input value={form.id} disabled={!!id || locked} onChange={(e) => set('id', e.target.value)} placeholder="premium-s2" />
          </label>
          <label className="form-field">
            種類
            <select
              value={form.kind}
              disabled={!!id || locked}
              onChange={(e) => {
                const k = e.target.value as 'standard' | 'premium';
                setForm((f) => ({ ...f, kind: k, costSingle: k === 'standard' ? 1000 : 100, costMulti: k === 'standard' ? 10000 : 1000, pityOn: k === 'premium' }));
              }}
            >
              <option value="premium">Premium（有償GEMS・天井あり）</option>
              <option value="standard">Standard（COINS・天井なし）</option>
            </select>
          </label>
          <label className="form-field">
            シリーズ（天井を引き継ぐ単位。公開後は変更不可）
            <input value={form.seriesId} disabled={locked || status === 'published'} onChange={(e) => set('seriesId', e.target.value)} placeholder="premium-s2" />
          </label>
          <label className="form-field">
            名前
            <input value={form.name} disabled={locked} maxLength={60} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="form-field">
            説明（プレイヤーに表示）
            <textarea value={form.description} disabled={locked} maxLength={1000} rows={3} onChange={(e) => set('description', e.target.value)} />
          </label>
          <div className="row">
            <label className="form-field">
              1回
              <input type="number" value={form.costSingle} disabled={locked} onChange={(e) => set('costSingle', Number(e.target.value))} style={{ width: 110 }} />
            </label>
            <label className="form-field">
              10回
              <input type="number" value={form.costMulti} disabled={locked} onChange={(e) => set('costMulti', Number(e.target.value))} style={{ width: 110 }} />
            </label>
            <span className="small muted">{form.kind === 'standard' ? 'COINS' : form.acceptsFreeGems ? 'GEMS（無償→有償の順）' : '有償GEMS'}</span>
          </div>
          {form.kind === 'premium' && (
            <label className="row small">
              <input type="checkbox" checked={form.acceptsFreeGems} disabled={locked} onChange={(e) => set('acceptsFreeGems', e.target.checked)} />
              無償GEMSも使える（無償GEMSから先に使い、足りない分を有償GEMS。オフ＝有償限定ガシャ）
            </label>
          )}
          <div className="row">
            <label className="form-field">
              開始（日本時間）
              <input type="datetime-local" value={form.startsAt} disabled={locked} onChange={(e) => set('startsAt', e.target.value)} />
            </label>
            <label className="form-field">
              終了（空欄＝常設）
              <input type="datetime-local" value={form.endsAt} disabled={locked} onChange={(e) => set('endsAt', e.target.value)} />
            </label>
          </div>
        </div>
        <div className="panel form-grid1">
          <h3>排出率（合計 100%）</h3>
          <table className="tbl">
            <tbody>
              {RARITIES.map((r) => (
                <tr key={r}>
                  <td className={`rar-${r}`}>{r}</td>
                  <td>
                    <input type="number" step="0.0001" min={0} max={100} value={form.rates[r]} disabled={locked} onChange={(e) => set('rates', { ...form.rates, [r]: e.target.value })} style={{ width: 110 }} />
                    %
                  </td>
                  <td className="num tiny muted">{cards.filter((c) => c.rarity === r && pool.includes(c.id)).length}人</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={`small ${sum === 1_000_000 ? '' : 'error'}`}>合計 {(sum / 10_000).toFixed(4)}%</div>
          {form.kind === 'premium' && (
            <>
              <h3 style={{ marginTop: 10 }}>天井</h3>
              <label className="toggle">
                <input type="checkbox" checked={form.pityOn} disabled={locked} onChange={(e) => set('pityOn', e.target.checked)} /> 天井あり
              </label>
              {form.pityOn && (
                <div className="row small">
                  Epic以上 <input type="number" value={form.pity.epicAt} disabled={locked} onChange={(e) => set('pity', { ...form.pity, epicAt: Number(e.target.value) })} style={{ width: 70 }} />回
                  Legendary以上 <input type="number" value={form.pity.legendaryAt} disabled={locked} onChange={(e) => set('pity', { ...form.pity, legendaryAt: Number(e.target.value) })} style={{ width: 70 }} />回 特典{' '}
                  <input type="number" value={form.pity.bonusEvery} disabled={locked} onChange={(e) => set('pity', { ...form.pity, bonusEvery: Number(e.target.value) })} style={{ width: 80 }} />回ごと
                </div>
              )}
            </>
          )}
          <h3 style={{ marginTop: 10 }}>候補（{pool.length}人）</h3>
          <div className="row">
            {RARITIES.map((r) => (
              <label key={r} className="toggle">
                <input type="checkbox" checked={form.included[r]} disabled={locked} onChange={(e) => set('included', { ...form.included, [r]: e.target.checked })} />
                {r}
              </label>
            ))}
          </div>
          <label className="form-field">
            除外する選手ID（スペース区切り。例：Standard から外して Premium 限定にする選手）
            <textarea rows={2} value={form.excluded} disabled={locked} onChange={(e) => set('excluded', e.target.value)} placeholder="FD-173 FD-072" />
          </label>
        </div>
      </div>

      {canWrite && status !== 'archived' && (
        <div className="panel">
          {status === 'published' && (
            <label className="form-field">
              変更内容（プレイヤーのガシャ画面の変更履歴に表示されます）
              <input value={form.changeNote} maxLength={300} onChange={(e) => set('changeNote', e.target.value)} placeholder="例：Epic の排出率を 25% から 30% に変更" />
            </label>
          )}
          {error && <div className="error">{error}</div>}
          {msg && <div className="small" style={{ color: 'var(--accent)' }}>{msg}</div>}
          <div className="row" style={{ marginTop: 8 }}>
            {!id && (
              <button className="btn primary" disabled={busy || sum !== 1_000_000} onClick={() => act(() => adminApi<Detail>('/gacha/banners', payload()), '下書きを作りました')}>
                下書きを作成
              </button>
            )}
            {id && status === 'draft' && (
              <>
                <button className="btn" disabled={busy || sum !== 1_000_000} onClick={() => act(() => adminApi<Detail>(`/gacha/banners/${id}`, payload(), 'PATCH'), '下書きを保存しました')}>
                  下書きを保存
                </button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={async () => (await confirmDialog('公開するとプレイヤーのガシャ画面に表示されます（開始日時以降）。')) && act(() => adminApi<Detail>(`/gacha/banners/${id}/publish`, {}), '公開しました')}
                >
                  公開
                </button>
              </>
            )}
            {id && status === 'published' && (
              <>
                <button
                  className="btn primary"
                  disabled={busy || sum !== 1_000_000 || !form.changeNote.trim()}
                  onClick={async () => (await confirmDialog('変更を新しい版として公開します。以後の抽選は新しい版で行われます。')) && act(() => adminApi<Detail>(`/gacha/banners/${id}`, payload(), 'PATCH'), '新しい版を公開しました')}
                >
                  変更を公開（v{(detail?.banner.rates_version ?? 0) + 1}）
                </button>
                <button className="btn danger" disabled={busy} onClick={async () => (await confirmDialog('このガシャを今すぐ終了します。')) && act(() => adminApi<Detail>(`/gacha/banners/${id}/end`, {}), '終了しました')}>
                  今すぐ終了
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {detail && (
        <div className="panel scroll-x">
          <h3>版の履歴</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>版</th>
                <th>日時</th>
                <th>変更内容</th>
                <th>管理者</th>
                <th className="num">抽選回数</th>
              </tr>
            </thead>
            <tbody>
              {detail.versions.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    公開すると版が記録されます
                  </td>
                </tr>
              )}
              {detail.versions.map((v) => (
                <tr key={v.version}>
                  <td>v{v.version}</td>
                  <td>{time(v.created_at)}</td>
                  <td>{v.change_note}</td>
                  <td>{v.changed_by ?? '—'}</td>
                  <td className="num">{fmtInt(detail.draws.find((d) => d.rates_version === v.version)?.n ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
