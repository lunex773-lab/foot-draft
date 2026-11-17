import {
  DEFAULT_TACTICS,
  FORMATIONS,
  FORMATION_IDS,
  POSITION_GROUP,
  TACTIC_FIELD_LABELS_JA,
  TACTIC_LABELS_JA,
  autoLineup,
  bestFormation,
  computeChemistry,
  fitSquad,
  lineupStrength,
  positionRatings,
  type FormationId,
  type Lineup,
  type Player,
  type PositionGroup,
  type Tactics,
} from '@fd/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CardDetail, LevelTag } from '../components/CardDetail';
import { PitchEditor, type PitchTarget } from '../components/PitchEditor';
import { PlayerRow } from '../components/PlayerRow';
import { api } from '../lib/api';
import { useCatalog } from '../lib/catalog';
import { errorText } from '../lib/labels';
import { setFavorite, strengthenedCards, useTeam, type TeamData } from '../lib/team';

type Sort = 'ovr' | 'level' | 'new';

/**
 * Team screen (user request 2026-11-17, decision 73): the players, positions
 * and tactics used in MATCH. 3 saved teams; one of them is used in MATCH.
 */
export default function TeamPage() {
  const catalog = useCatalog();
  const nav = useNavigate();
  const { data, setData, error: loadError } = useTeam();
  const [slot, setSlot] = useState<number>(1);
  const [lineup, setLineup] = useState<Lineup | null>(null);
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<string | null>(null);
  const [group, setGroup] = useState<'ALL' | PositionGroup>('ALL');
  const [favOnly, setFavOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('ovr');
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starterSeen, setStarterSeen] = useState(false);

  /** the owned cards as they play in MATCH (strengthened) */
  const cards = useMemo(() => (data && catalog ? strengthenedCards(data.cards, catalog) : []), [data, catalog]);
  const byId = useMemo(() => new Map(cards.map((p) => [p.id, p])), [cards]);
  const info = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.playerId, c])), [data]);

  // open the active team first
  useEffect(() => {
    if (data?.active) setSlot(data.active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.active === undefined]);

  // the team of the chosen slot (an empty slot starts with おまかせ編成); not reset by a favourite mark
  const savedKey = data ? `${slot}|${cards.length}|${JSON.stringify(data.squads.find((s) => s.slot === slot) ?? null)}` : '';
  useEffect(() => {
    if (!data || cards.length < 11) return;
    const saved = data.squads.find((s) => s.slot === slot);
    const fitted = saved ? fitSquad(saved.lineup, cards) : null;
    setLineup(fitted ?? autoLineup(cards));
    setName(saved?.name ?? `チーム${slot}`);
    setIncoming(null);
    const changed = !!saved && !!fitted && fitted.bench.join() !== saved.lineup.bench.join();
    setDirty(!saved || !fitted || changed);
    setNote(!saved ? 'まだ保存されていないチームです（おまかせ編成で並べました）' : !fitted ? '持っていない選手がいたため、おまかせ編成で並べ直しました' : changed ? '所持カードが増えたので、控えを自動で入れました' : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  if (loadError) return <div className="error">{loadError}</div>;
  if (!data || !catalog || !lineup) return <div className="muted">読み込み中…</div>;

  const roster = [...lineup.starters, ...lineup.bench].map((id) => byId.get(id)!).filter(Boolean);
  const levels = Object.fromEntries(data.cards.map((c) => [c.playerId, c.level]));
  const chem = computeChemistry(lineup.starters.map((id) => byId.get(id)), lineup.formation, lineup.tactics);
  const strength = lineupStrength(lineup, byId);
  const slots = FORMATIONS[lineup.formation].slots;
  const offPosition = lineup.starters.filter((id, i) => {
    const p = byId.get(id);
    return p && !p.positions.includes(slots[i].pos) && positionRatings(p)[slots[i].pos] < p.ovr - 6;
  }).length;
  const saved = data.squads.find((s) => s.slot === slot);
  const isActive = data.active === slot;

  const change = (l: Lineup) => {
    setLineup(l);
    setDirty(true);
    setMsg(null);
  };
  const setTactic = <K extends keyof Tactics>(k: K, v: Tactics[K]) => change({ ...lineup, tactics: { ...lineup.tactics, [k]: v } });
  const setFormation = (f: FormationId) => {
    // keep the same players, placed for the new formation
    change(autoLineup(roster, f, lineup.tactics));
  };
  const omakase = (keepFormation: boolean) => {
    const f = keepFormation ? lineup.formation : bestFormation(cards).formation;
    change({ ...autoLineup(cards, f), tactics: { ...lineup.tactics } });
    setNote(keepFormation ? `おまかせ編成（${f} のまま）` : `おまかせ編成（いちばん合う ${f}）`);
  };
  const place = (target: PitchTarget) => {
    if (!incoming) return;
    const starters = [...lineup.starters];
    const bench = [...lineup.bench];
    const arr = target.kind === 'slot' ? starters : bench;
    const current = arr[target.index];
    const si = starters.indexOf(incoming);
    const bi = bench.indexOf(incoming);
    if (si >= 0) starters[si] = current;
    else if (bi >= 0) bench[bi] = current;
    arr[target.index] = incoming;
    setIncoming(null);
    change({ ...lineup, starters, bench });
  };

  const save = async (activate: boolean) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      let next = await api<TeamData & { missionsCompleted?: string[] }>(`/api/team/squads/${slot}`, { method: 'PUT', body: { name, lineup } });
      if (activate && next.active !== slot) next = await api<TeamData>('/api/team/active', { body: { slot } });
      setData(next);
      setDirty(false);
      setNote(null);
      setMsg(activate ? 'MATCH で使うチームにしました' : '保存しました');
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const activate = async () => {
    if (dirty) return save(true);
    setBusy(true);
    try {
      setData(await api<TeamData>('/api/team/active', { body: { slot } }));
      setMsg('MATCH で使うチームにしました');
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const toggleFavorite = async (id: string, fav: boolean) => {
    const r = await setFavorite(id, fav).catch(() => null);
    if (r) setData({ ...data, cards: data.cards.map((x) => (x.playerId === id ? { ...x, favorite: r.favorite } : x)) });
  };

  const inLineup = (id: string) => (lineup.starters.includes(id) ? 'start' : lineup.bench.includes(id) ? 'bench' : null);
  const list = cards
    .filter((p) => (group === 'ALL' || POSITION_GROUP[p.primaryPosition] === group) && (!favOnly || info.get(p.id)?.favorite))
    .sort((a, b) => {
      if (sort === 'level') return (info.get(b.id)?.level ?? 0) - (info.get(a.id)?.level ?? 0) || b.ovr - a.ovr;
      if (sort === 'new') return (info.get(b.id)?.obtainedAt ?? 0) - (info.get(a.id)?.obtainedAt ?? 0) || b.ovr - a.ovr;
      return b.ovr - a.ovr || a.id.localeCompare(b.id);
    });
  const incomingPlayer = incoming ? byId.get(incoming) : null;
  const detailPlayer = detail ? catalog.get(detail) : null;
  const detailInfo = detail ? info.get(detail) : null;

  return (
    <div className="screen team-page">
      {data.starter && !starterSeen && <StarterWelcome starter={data.starter} catalog={catalog} onClose={() => setStarterSeen(true)} />}

      <div className="panel">
        <div className="spread">
          <h2 style={{ margin: 0 }}>チーム編成</h2>
          <span className="small muted">所持 {data.cards.length}枚</span>
        </div>
        <div className="tabs squad-tabs" role="tablist" aria-label="保存したチーム">
          {Array.from({ length: data.slots }, (_, i) => i + 1).map((n) => {
            const s = data.squads.find((x) => x.slot === n);
            return (
              <button
                key={n}
                role="tab"
                aria-selected={slot === n}
                className={slot === n ? 'on' : ''}
                onClick={() => {
                  if (dirty && n !== slot && !window.confirm('保存していない変更があります。切り替えますか？')) return;
                  setSlot(n);
                  setMsg(null);
                  setError(null);
                }}
              >
                {s?.name ?? `チーム${n}`}
                {data.active === n && <span className="use-dot" title="MATCH で使用中" />}
                {!s && <span className="tiny muted">（空）</span>}
              </button>
            );
          })}
        </div>
        <div className="team-summary">
          <div>
            <div className="tiny muted">チーム総合力</div>
            <div className="display big-num">{strength}</div>
          </div>
          <div>
            <div className="tiny muted">ケミストリー</div>
            <div className="display big-num">{chem.score}</div>
            <div className="meter">
              <div style={{ width: `${chem.score}%` }} />
            </div>
          </div>
          <div>
            <div className="tiny muted">状態</div>
            <div className="small">
              {isActive ? <span className="badge on">MATCH で使用中</span> : <span className="badge">控えチーム</span>}
              {dirty && <span className="badge warn">未保存</span>}
            </div>
            {offPosition > 0 && <div className="tiny warn-text">本職でない位置に {offPosition}人</div>}
          </div>
        </div>
        <div className="tiny muted">
          適性 {chem.positionFit}/40・連携 {chem.links}/25・戦術 {chem.tacticFit}/25・バランス {chem.balance}
        </div>
        {note && <div className="small note">{note}</div>}
      </div>

      <div className="lineup-layout">
        <div className="panel">
          <div className="team-tools">
            <label className="field">
              チーム名
              <input value={name} maxLength={16} onChange={(e) => (setName(e.target.value), setDirty(true))} />
            </label>
            <label className="field">
              フォーメーション
              <select value={lineup.formation} onChange={(e) => setFormation(e.target.value as FormationId)}>
                {FORMATION_IDS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="button-row" style={{ margin: '8px 0 10px' }}>
            <button className="btn small" onClick={() => omakase(false)}>
              おまかせ編成
            </button>
            <button className="btn small ghost" onClick={() => omakase(true)}>
              この形でおまかせ
            </button>
          </div>
          {incomingPlayer && (
            <div className="placing-banner" role="status">
              <span>
                <b>{incomingPlayer.name}</b> を入れる位置をタップ
              </span>
              <button className="btn small ghost" onClick={() => setIncoming(null)}>
                やめる
              </button>
            </div>
          )}
          <PitchEditor roster={roster} lineup={lineup} onChange={change} placing={!!incoming} onPlace={place} levels={levels} />
        </div>

        <div className="stack">
          <div className="panel">
            <h3>戦術</h3>
            <div className="tactics">
              {(Object.keys(TACTIC_LABELS_JA) as (keyof Tactics)[]).map((k) => (
                <label key={k} className="field">
                  {TACTIC_FIELD_LABELS_JA[k]}
                  <select value={lineup.tactics[k]} onChange={(e) => setTactic(k, e.target.value as never)}>
                    {Object.entries(TACTIC_LABELS_JA[k]).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button className="btn small ghost" style={{ marginTop: 10 }} onClick={() => change({ ...lineup, tactics: { ...DEFAULT_TACTICS } })}>
              戦術を初期値に戻す
            </button>
          </div>

          <div className="panel">
            <div className="button-row">
              <button className="btn primary" disabled={busy || (!dirty && !!saved)} onClick={() => save(false)}>
                保存
              </button>
              <button className="btn" disabled={busy || (isActive && !dirty)} onClick={activate}>
                {isActive ? 'MATCH で使用中' : 'MATCH で使う'}
              </button>
              <button className="btn ghost" disabled={busy || dirty || !isActive} onClick={() => nav('/play')} title={dirty ? '先に保存してください' : undefined}>
                MATCH へ
              </button>
            </div>
            {msg && <div className="small good-text" style={{ marginTop: 8 }}>{msg}</div>}
            {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
            <div className="tiny muted" style={{ marginTop: 8 }}>
              MATCH には「使用中」のチームで出場します。チームは{data.slots}つまで保存できます。
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="spread" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>選手一覧</h3>
          <Link className="small" to="/cards">
            選手図鑑へ
          </Link>
        </div>
        <div className="tiny muted" style={{ margin: '4px 0 8px' }}>
          選手をタップしてから、ピッチ上の位置（または控え）をタップすると入れ替わります。
        </div>
        <div className="filters">
          <div className="tabs">
            {(['ALL', 'GK', 'DF', 'MF', 'FW'] as const).map((g) => (
              <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>
                {g === 'ALL' ? '全員' : g}
              </button>
            ))}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="並べ替え">
            <option value="ovr">OVR順</option>
            <option value="level">強化順</option>
            <option value="new">入手順</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} /> ★のみ
          </label>
        </div>
        <div className="plist">
          {list.map((p: Player) => {
            const where = inLineup(p.id);
            const c = info.get(p.id)!;
            return (
              <PlayerRow
                key={p.id}
                player={p}
                selected={incoming === p.id}
                onClick={() => setIncoming(incoming === p.id ? null : p.id)}
                right={
                  <span className="row-tags">
                    <LevelTag level={c.level} />
                    {where && <span className={`chip ${where === 'start' ? 'on' : ''}`}>{where === 'start' ? '先発' : '控え'}</span>}
                    <button
                      className={`icon-btn ${c.favorite ? 'on' : ''}`}
                      aria-label={c.favorite ? 'お気に入りを外す' : 'お気に入りにする'}
                      aria-pressed={c.favorite}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(p.id, !c.favorite);
                      }}
                    >
                      {c.favorite ? '★' : '☆'}
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`${p.name} の詳細`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetail(p.id);
                      }}
                    >
                      i
                    </button>
                  </span>
                }
              />
            );
          })}
        </div>
      </div>
      {detailPlayer && detailInfo && <CardDetail player={detailPlayer} owned={detailInfo} onClose={() => setDetail(null)} onFavorite={(f) => toggleFavorite(detailPlayer.id, f)} />}
    </div>
  );
}

/** first visit: the 11 starting cards (decision 72) */
function StarterWelcome({ starter, catalog, onClose }: { starter: NonNullable<TeamData['starter']>; catalog: Map<string, Player>; onClose: () => void }) {
  const strengthened = starter.filter((s) => s.levelTo !== null).length;
  return (
    <div className="panel starter-panel" role="status">
      <div className="spread">
        <h3 style={{ margin: 0 }}>初期選手 11人を受け取りました</h3>
        <button className="btn small ghost" onClick={onClose}>
          OK
        </button>
      </div>
      <p className="small muted" style={{ margin: '6px 0' }}>
        GK1・DF4・MF3・FW3 の COMMON 選手です。{strengthened > 0 && `すでに持っていた ${strengthened}人は +1 に強化されました。`}ガシャで強い選手を集めて、チームを強くしよう。
      </p>
      <div className="chip-row">
        {starter.map((s) => {
          const p = catalog.get(s.playerId);
          return (
            <span key={s.playerId} className="chip">
              {p?.primaryPosition} {p?.lastName}
              {s.levelTo !== null ? ` +${s.levelTo}` : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}
