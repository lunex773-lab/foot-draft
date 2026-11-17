import { GAME_CONFIG, type SoloChallenge } from '@fd/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TierBadge } from '../components/TierBadge';
import { api } from '../lib/api';
import { errorText, modeLabel } from '../lib/labels';
import { eventPeriod, type EventItem } from './EventsPage';
import { Stars } from './SoloPage';

export interface HistoryRow {
  room_id: string;
  code: string;
  mode: string;
  status: string;
  created_at: number;
  final_rank: number | null;
}

const STATUS_LABEL: Record<string, string> = { lobby: '待機中', drafting: 'ドラフト中', lineup: '編成中', playing: '試合中' };

/** rooms the player has not finished (shown on the home screen and here) */
export function ActiveRooms({ rooms }: { rooms: HistoryRow[] }) {
  if (rooms.length === 0) return null;
  return (
    <article className="fd-card live">
      <div className="fd-card-header">
        <h3>進行中のルーム</h3>
        <span className="badge on">LIVE</span>
      </div>
      <div className="list">
        {rooms.map((r) => (
          <div key={r.room_id} className="list-item">
            <span>
              {modeLabel(r.mode)}
              {r.mode === 'quick' || r.mode === 'private' ? `・${r.code}` : ''}・{STATUS_LABEL[r.status] ?? r.status}
            </span>
            <Link className="btn small primary" to={`/room/${r.room_id}`}>
              戻る
            </Link>
          </div>
        ))}
      </div>
    </article>
  );
}

/**
 * Mode select (opened by the DUEL button): every way to start a draft.
 */
export default function PlayPage() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [pickSeconds, setPickSeconds] = useState<number>(GAME_CONFIG.pickSeconds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<HistoryRow[]>([]);
  const [ranked, setRanked] = useState<{ rating: number; games: number; position: number | null; season: { name: string } } | null>(null);
  const [solo, setSolo] = useState<{ challenge: SoloChallenge; cleared: boolean } | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [roster, setRoster] = useState<number | null>(null);

  useEffect(() => {
    api<typeof ranked>('/api/ranked/me').then(setRanked).catch(() => undefined);
    api<typeof solo>('/api/solo/today').then(setSolo).catch(() => undefined);
    api<{ items: EventItem[] }>('/api/events')
      .then((r) => setEvents(r.items))
      .catch(() => undefined);
    api<{ items: HistoryRow[] }>('/api/users/me/history')
      .then((r) => setActive(r.items.filter((x) => x.status !== 'finished' && x.status !== 'closed')))
      .catch(() => undefined);
    api<{ roster: (string | null)[] }>('/api/collection')
      .then((r) => setRoster(r.roster.filter(Boolean).length))
      .catch(() => undefined);
  }, []);

  const go = async (fn: () => Promise<{ roomId: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      nav(`/room/${r.roomId}`);
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <section className="page-head">
        <div className="eyebrow">ENTER THE ARENA</div>
        <h1>MODE SELECT</h1>
        <p>遊ぶモードを選んでください。どのモードも4人のスネークドラフト（空席はCPU）です。</p>
      </section>
      {error && <div className="error">{error}</div>}
      <ActiveRooms rooms={active} />
      <section className="cards">
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>QUICK DRAFT</h3>
            <span className="badge">4 PLAYERS</span>
          </div>
          <p>空いているルームに参加します。ホストはいつでも開始でき、空席はCPUが入ります。4人そろうと自動で開始。</p>
          <div className="button-row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/rooms/quick', { body: {} }))}>
              クイックドラフト
            </button>
          </div>
        </article>
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>RANKED</h3>
            {ranked && <TierBadge rating={ranked.rating} />}
          </div>
          <p>
            {ranked ? `${ranked.season.name}・${ranked.games}試合${ranked.position ? `・${ranked.position}位` : ''}。` : ''}
            60秒で4人そろわなければCPUが入ります（レートは人間同士の順位で変動）。
          </p>
          <div className="button-row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/ranked/queue', { body: {} }))}>
              ランク戦を探す
            </button>
            <Link className="btn" to="/ranked">
              ランキング
            </Link>
          </div>
        </article>
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>SOLO CHALLENGE</h3>
            <span className={`badge ${solo?.cleared ? 'on' : ''}`}>{solo?.cleared ? '達成済み' : 'DAILY'}</span>
          </div>
          <p>
            {solo ? (
              <>
                今日の課題 <Stars n={solo.challenge.difficulty} />　<b className="text">{solo.challenge.titleJa}</b>
              </>
            ) : (
              'CPU 3チームと日替わりの課題に挑戦。'
            )}
          </p>
          <div className="button-row">
            <Link className="btn primary" to="/solo">
              チャレンジを始める
            </Link>
          </div>
        </article>
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>COLLECTION DRAFT</h3>
            {roster !== null && <span className="badge">専用枠 {roster}/3</span>}
          </div>
          <p>所持カードから最大3枚を「自分専用枠」に登録して参加。登録カードはあなただけが指名できます。</p>
          <div className="button-row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/collection/draft/quick', { body: {} }))}>
              Collection Draft
            </button>
            <Link className="btn" to="/collection">
              専用枠を選ぶ
            </Link>
          </div>
        </article>
      </section>

      <div className="section-title">
        <h2>SPECIAL EVENTS</h2>
        <Link to="/events">VIEW ALL</Link>
      </div>
      <section className="cards">
        {events.length === 0 && (
          <article className="fd-card">
            <p className="flush">開催中・開催予定のイベントはありません。</p>
          </article>
        )}
        {events.slice(0, 3).map((e) => (
          <article key={e.id} className="fd-card">
            <div className="fd-card-header">
              <h3>{e.name}</h3>
              <span className={`badge ${e.open ? 'on' : ''}`}>{e.open ? '開催中' : '開催予定'}</span>
            </div>
            <p>
              {eventPeriod(e)}・{e.conditions.join('・')}
            </p>
            {e.open && (
              <div className="button-row">
                <button className="btn primary" disabled={busy} onClick={() => go(() => api(`/api/events/${e.id}/join`, { body: {} }))}>
                  参加する
                </button>
                <Link className="btn" to={`/events/${e.id}`}>
                  詳細
                </Link>
              </div>
            )}
          </article>
        ))}
      </section>

      <div className="section-title">
        <h2>PRIVATE ROOM</h2>
        <span>FRIENDS</span>
      </div>
      <section className="cards">
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>ルームを作る</h3>
          </div>
          <p>友だちと対戦。作ったあと、招待コード・招待リンクを送ります。</p>
          <label className="field">
            1ピックの制限時間
            <select value={pickSeconds} onChange={(e) => setPickSeconds(Number(e.target.value))}>
              {GAME_CONFIG.pickSecondsOptions.map((s) => (
                <option key={s} value={s}>
                  {s}秒
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/rooms', { body: { settings: { pickSeconds, fillWithCpu: true } } }))}>
              ルームを作成
            </button>
          </div>
        </article>
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>コードで参加</h3>
          </div>
          <p>招待コード（6文字）を入力して参加します。</p>
          <div className="button-row">
            <input className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="AB12CD" aria-label="招待コード" autoCapitalize="characters" />
            <button className="btn primary" disabled={busy || code.length !== 6} onClick={() => go(() => api('/api/rooms/join', { body: { code } }))}>
              参加する
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
