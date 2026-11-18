import { LEAGUES, NATIONS, POSITIONS, RARITIES, RARITY_INFO, TRAITS, TRAIT_IDS, type PoolAnalysis, type PoolFilter } from '@fd/shared';
import { useEffect, useMemo, useState } from 'react';
import { AdminApiError, adminApi } from './api';
import { confirmDialog } from './dialog';

interface EventItem {
  id: string;
  name: string;
  description: string;
  startsAt: number;
  endsAt: number;
  status: 'draft' | 'published' | 'archived';
  open: boolean;
  filter: PoolFilter;
  conditions: string[];
  pool: PoolAnalysis;
  rooms: number;
  players: number;
  updatedAt: number;
}

const STATUS_LABEL = { draft: '下書き', published: '公開中', archived: '終了' } as const;

const fmt = (ms: number) => new Date(ms).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** epoch ms -> value of <input type="datetime-local"> (this device's time zone) */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function poolNote(p: PoolAnalysis) {
  if (p.pure) return `対象 ${p.eligible}人。候補${p.poolSize}人はすべて対象選手で作られます。`;
  return `対象 ${p.eligible}人（GK ${p.eligibleByGroup.GK}・DF ${p.eligibleByGroup.DF}・MF ${p.eligibleByGroup.MF}・FW ${p.eligibleByGroup.FW}）。そのうち ${p.included}人が全員候補に入り、残り ${p.poolSize - p.included}人は通常の選手で埋めます。`;
}

function Toggles<T extends string>({ all, value, label, onChange, disabled }: { all: readonly T[]; value: T[] | undefined; label: (v: T) => string; onChange: (v: T[]) => void; disabled?: boolean }) {
  const set = new Set(value ?? []);
  return (
    <div className="toggles">
      {all.map((v) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          className={`toggle ${set.has(v) ? 'on' : ''}`}
          onClick={() => {
            const next = new Set(set);
            if (next.has(v)) next.delete(v);
            else next.add(v);
            onChange(all.filter((x) => next.has(x)));
          }}
        >
          {label(v)}
        </button>
      ))}
    </div>
  );
}

interface Draft {
  id: string | null;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  filter: PoolFilter;
}

const emptyDraft = (): Draft => {
  const start = Date.now() + 60 * 60 * 1000;
  return { id: null, name: '', description: '', startsAt: toLocalInput(start), endsAt: toLocalInput(start + 7 * 24 * 60 * 60 * 1000), filter: {} };
};

function EventForm({ initial, canWrite, onSaved, onCancel }: { initial: Draft; canWrite: boolean; onSaved: () => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [preview, setPreview] = useState<{ conditions: string[]; pool: PoolAnalysis } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const f = d.filter;
  const setF = (patch: Partial<PoolFilter>) => setD({ ...d, filter: { ...f, ...patch } });
  const filterKey = JSON.stringify(f);

  useEffect(() => {
    const t = setTimeout(() => {
      adminApi<{ conditions: string[]; pool: PoolAnalysis }>('/events/preview', { filter: f })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const num = (v: string) => (v === '' ? undefined : Number(v));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { name: d.name, description: d.description, startsAt: new Date(d.startsAt).getTime(), endsAt: new Date(d.endsAt).getTime(), filter: f };
      if (d.id) await adminApi(`/events/${d.id}`, body, 'PATCH');
      else await adminApi('/events', body);
      onSaved();
    } catch (e) {
      setError(e instanceof AdminApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <h3>{d.id ? 'イベントを編集' : 'イベントを作成（下書き）'}</h3>
      <div className="form-grid">
        <label>
          名前
          <input value={d.name} maxLength={60} onChange={(e) => setD({ ...d, name: e.target.value })} disabled={!canWrite} placeholder="例：Young Talents" />
        </label>
        <div className="row" style={{ gap: 10 }}>
          <label className="form-field" style={{ flex: 1 }}>
            開始（この端末の時刻）
            <input type="datetime-local" value={d.startsAt} onChange={(e) => setD({ ...d, startsAt: e.target.value })} disabled={!canWrite} />
          </label>
          <label className="form-field" style={{ flex: 1 }}>
            終了
            <input type="datetime-local" value={d.endsAt} onChange={(e) => setD({ ...d, endsAt: e.target.value })} disabled={!canWrite} />
          </label>
        </div>
        <label className="wide">
          説明（プレイヤーに表示）
          <textarea value={d.description} maxLength={500} onChange={(e) => setD({ ...d, description: e.target.value })} disabled={!canWrite} />
        </label>
        <div className="form-field wide">
          候補の条件：国籍（いずれか）
          <Toggles all={NATIONS.map((n) => n.code)} value={f.nationalities} label={(c) => NATIONS.find((n) => n.code === c)!.nameJa} onChange={(v) => setF({ nationalities: v.length ? v : undefined })} disabled={!canWrite} />
        </div>
        <div className="form-field">
          レアリティ
          <Toggles all={RARITIES} value={f.rarities} label={(r) => RARITY_INFO[r].label} onChange={(v) => setF({ rarities: v.length ? v : undefined })} disabled={!canWrite} />
        </div>
        <div className="form-field">
          リーグ
          <Toggles all={LEAGUES.map((l) => l.id)} value={f.leagues} label={(id) => LEAGUES.find((l) => l.id === id)!.nameJa} onChange={(v) => setF({ leagues: v.length ? v : undefined })} disabled={!canWrite} />
        </div>
        <div className="form-field wide">
          ポジション（主ポジション）
          <Toggles all={POSITIONS} value={f.positions} label={(p) => p} onChange={(v) => setF({ positions: v.length ? v : undefined })} disabled={!canWrite} />
        </div>
        <div className="form-field wide">
          特殊能力（いずれかを持つ）
          <Toggles all={TRAIT_IDS} value={f.traits} label={(t) => TRAITS[t].nameJa} onChange={(v) => setF({ traits: v.length ? v : undefined })} disabled={!canWrite} />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <label className="form-field" style={{ flex: 1 }}>
            年齢（以上）
            <input type="number" min={15} max={50} value={f.minAge ?? ''} onChange={(e) => setF({ minAge: num(e.target.value) })} disabled={!canWrite} />
          </label>
          <label className="form-field" style={{ flex: 1 }}>
            年齢（以下）
            <input type="number" min={15} max={50} value={f.maxAge ?? ''} onChange={(e) => setF({ maxAge: num(e.target.value) })} disabled={!canWrite} />
          </label>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <label className="form-field" style={{ flex: 1 }}>
            OVR（以上）
            <input type="number" min={1} max={99} value={f.minOvr ?? ''} onChange={(e) => setF({ minOvr: num(e.target.value) })} disabled={!canWrite} />
          </label>
          <label className="form-field" style={{ flex: 1 }}>
            OVR（以下）
            <input type="number" min={1} max={99} value={f.maxOvr ?? ''} onChange={(e) => setF({ maxOvr: num(e.target.value) })} disabled={!canWrite} />
          </label>
        </div>
        <div className="preview wide">
          <b>候補の確認：</b>
          {preview ? (
            <>
              {preview.conditions.join('・')}
              <div className="muted" style={{ marginTop: 4 }}>
                {poolNote(preview.pool)}
              </div>
            </>
          ) : (
            '…'
          )}
        </div>
      </div>
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        {canWrite && (
          <button className="btn primary" disabled={busy || !d.name.trim()} onClick={save}>
            {d.id ? '保存' : '下書きとして作成'}
          </button>
        )}
        <button className="btn" onClick={onCancel}>
          閉じる
        </button>
      </div>
    </div>
  );
}

/** Special Events management (decision 28). */
export function EventsPage({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<EventItem[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    adminApi<{ items: EventItem[] }>('/events')
      .then((r) => setItems(r.items))
      .catch((e) => setError(String(e.message)));
  useEffect(() => {
    load();
  }, []);

  const act = async (id: string, action: 'publish' | 'archive', label: string) => {
    if (!(await confirmDialog(`このイベントを${label}しますか？`))) return;
    setError(null);
    try {
      await adminApi(`/events/${id}/${action}`, {});
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? `${e.code}: ${e.message}` : String(e));
    }
  };

  const counts = useMemo(() => {
    const c = { draft: 0, published: 0, archived: 0 };
    for (const e of items ?? []) c[e.status]++;
    return c;
  }, [items]);

  return (
    <div>
      <div className="spread" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>イベント管理</h1>
        {canWrite && !editing && (
          <button className="btn primary" onClick={() => setEditing(emptyDraft())}>
            新しいイベント
          </button>
        )}
      </div>
      <div className="small muted" style={{ marginBottom: 12 }}>
        公開中 {counts.published}・下書き {counts.draft}・終了 {counts.archived}。公開すると期間中だけプレイヤーが参加できます。条件の変更は、変更後に作られるルームから反映されます。報酬は通貨の実装後（現在は順位の記録のみ）。
      </div>
      {editing && (
        <EventForm
          key={editing.id ?? 'new'}
          initial={editing}
          canWrite={canWrite}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {error && <div className="error">{error}</div>}
      {items && (
        <div className="panel scroll-x">
          <table>
            <thead>
              <tr>
                <th>状態</th>
                <th>名前</th>
                <th>期間</th>
                <th>候補の条件</th>
                <th>対象選手</th>
                <th>ルーム</th>
                <th>参加者</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className={`status ${e.status}`}>{STATUS_LABEL[e.status]}</span>
                    {e.status === 'published' && <div className="tiny muted">{e.open ? '開催中' : e.startsAt > Date.now() ? '開始前' : '期間終了'}</div>}
                  </td>
                  <td>
                    <b>{e.name}</b>
                    <div className="tiny muted">{e.id}</div>
                  </td>
                  <td className="small">
                    {fmt(e.startsAt)}
                    <br />〜 {fmt(e.endsAt)}
                  </td>
                  <td className="small">{e.conditions.join('・')}</td>
                  <td className="small">
                    {e.pool.eligible}人{e.pool.pure ? '' : `（＋通常${e.pool.poolSize - e.pool.included}）`}
                  </td>
                  <td>{e.rooms}</td>
                  <td>{e.players}</td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <button
                        className="btn"
                        onClick={() => setEditing({ id: e.id, name: e.name, description: e.description, startsAt: toLocalInput(e.startsAt), endsAt: toLocalInput(e.endsAt), filter: e.filter })}
                      >
                        {canWrite && e.status !== 'archived' ? '編集' : '詳細'}
                      </button>
                      {canWrite && e.status === 'draft' && (
                        <button className="btn primary" onClick={() => act(e.id, 'publish', '公開')}>
                          公開
                        </button>
                      )}
                      {canWrite && e.status !== 'archived' && (
                        <button className="btn" onClick={() => act(e.id, 'archive', '終了')}>
                          終了
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
