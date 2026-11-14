import { GAME_CONFIG, type SoloChallenge } from '@fd/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TierBadge } from '../components/TierBadge';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorText, modeLabel } from '../lib/labels';
import { fmt, useWallet } from '../lib/wallet';
import { eventPeriod, type EventItem } from './EventsPage';
import { Stars } from './SoloPage';

interface HistoryRow {
  room_id: string;
  code: string;
  mode: string;
  status: string;
  created_at: number;
  final_rank: number | null;
}

export default function HomePage() {
  const { me } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [pickSeconds, setPickSeconds] = useState<number>(GAME_CONFIG.pickSeconds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<HistoryRow[]>([]);
  const [stats, setStats] = useState<{ leaguesPlayed: number; leaguesWon: number } | null>(null);
  const [ranked, setRanked] = useState<{ rating: number; games: number; position: number | null; season: { name: string } } | null>(null);
  const [solo, setSolo] = useState<{ challenge: SoloChallenge; cleared: boolean } | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const { wallet, login, matchRewards } = useWallet();
  const [missionsReady, setMissionsReady] = useState(0);
  const [roster, setRoster] = useState<number | null>(null);

  useEffect(() => {
    api<typeof ranked>('/api/ranked/me').then(setRanked).catch(() => undefined);
    api<typeof solo>('/api/solo/today').then(setSolo).catch(() => undefined);
    api<{ items: EventItem[] }>('/api/events')
      .then((r) => setEvents(r.items))
      .catch(() => undefined);
    api<{ items: HistoryRow[] }>('/api/users/me/history')
      .then((r) => setActive(r.items.filter((x) => x.status !== 'finished')))
      .catch(() => undefined);
    api<{ items: { completed: boolean; claimed: boolean }[] }>('/api/missions')
      .then((r) => setMissionsReady(r.items.filter((m) => m.completed && !m.claimed).length))
      .catch(() => undefined);
    api<{ roster: (string | null)[] }>('/api/collection')
      .then((r) => setRoster(r.roster.filter(Boolean).length))
      .catch(() => undefined);
    api<{ stats: { leaguesPlayed: number; leaguesWon: number } }>('/api/users/me')
      .then((r) => setStats(r.stats))
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="hero">
        <h1>
          FOOTBALL <span>DRAFT</span>
        </h1>
        <p>
          ようこそ、{me?.displayName} さん{stats && `　リーグ ${stats.leaguesPlayed}回・優勝 ${stats.leaguesWon}回`}
        </p>
      </div>
      {active.length > 0 && (
        <div className="panel">
          <h3>進行中のルーム</h3>
          {active.map((r) => (
            <div key={r.room_id} className="spread small" style={{ padding: '4px 0' }}>
              <span>
                {modeLabel(r.mode)}
                {r.mode === 'quick' || r.mode === 'private' ? `・コード ${r.code}` : ''}・{r.status}
              </span>
              <Link className="btn small" to={`/room/${r.room_id}`}>
                戻る
              </Link>
            </div>
          ))}
        </div>
      )}
      <div className="grid3">
        <div className="panel mode-card">
          <div className="title">QUICK DRAFT</div>
          <div className="small muted">空いているルームに参加します。ホストはいつでも開始でき、空席はCPUが入ります。4人そろうと自動で開始。</div>
          <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/rooms/quick', { body: {} }))}>
            クイックドラフト
          </button>
        </div>
        <div className="panel mode-card">
          <div className="spread">
            <div className="title">RANKED</div>
            {ranked && <TierBadge rating={ranked.rating} />}
          </div>
          <div className="small muted">
            {ranked ? `${ranked.season.name}・${ranked.games}試合${ranked.position ? `・${ranked.position}位` : ''}` : 'レーティング対戦'}。60秒で4人そろわなければCPUが入ります（レートは人間同士の順位で変動）。
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/ranked/queue', { body: {} }))}>
              ランク戦を探す
            </button>
            <Link className="btn ghost small" to="/ranked">
              ランキング
            </Link>
          </div>
        </div>
        <div className="panel mode-card">
          <div className="spread">
            <div className="title">SOLO CHALLENGE</div>
            {solo?.cleared && <span className="chip on">達成済み</span>}
          </div>
          <div className="small">
            {solo ? (
              <>
                今日の課題 <Stars n={solo.challenge.difficulty} />
                <br />
                <b>{solo.challenge.titleJa}</b>
              </>
            ) : (
              <span className="muted">CPU 3チームと日替わりの課題に挑戦</span>
            )}
          </div>
          <Link className="btn primary" to="/solo">
            課題を見る
          </Link>
        </div>
      </div>
      <div className="grid2">
        <div className="panel mode-card">
          <div className="spread">
            <div className="title">COLLECTION DRAFT</div>
            {roster !== null && <span className="chip">専用枠 {roster}/3</span>}
          </div>
          <div className="small muted">所持カードから最大3枚を「自分専用枠」に登録して参加。登録カードはあなただけが指名できます。ほかの候補は通常どおり共通です。</div>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/collection/draft/quick', { body: {} }))}>
              Collection Draft
            </button>
            <Link className="btn ghost small" to="/collection">
              専用枠を選ぶ
            </Link>
          </div>
        </div>
        <div className="panel mode-card">
          <div className="title">GACHA・REWARDS</div>
          <div className="small">
            {wallet ? (
              <>
                COINS <b>{fmt(wallet.coins)}</b>　GEMS <b>{fmt(wallet.gems.total)}</b>
                <span className="muted">（無償 {fmt(wallet.gems.free)}・有償 {fmt(wallet.gems.paid)}）</span>
              </>
            ) : (
              <span className="muted">残高を読み込み中…</span>
            )}
            <br />
            <span className="muted">
              {login?.claimedToday ? `ログインボーナス受け取り済み（${login.streak}日連続）` : 'ログインボーナス未受け取り'}
              {matchRewards && `・今日の対戦報酬 ${matchRewards.leaguesToday}/${matchRewards.cap}リーグ`}
            </span>
          </div>
          <div className="row">
            <Link className="btn primary small" to="/gacha">
              ガシャ
            </Link>
            <Link className="btn small" to="/missions">
              ミッション{missionsReady > 0 && <span className="chip on">{missionsReady}</span>}
            </Link>
            <Link className="btn small ghost" to="/exchange">
              交換所
            </Link>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="spread" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>SPECIAL EVENTS</h3>
          <Link className="small" to="/events">
            すべて見る
          </Link>
        </div>
        {events.length === 0 && <div className="small muted">開催中・開催予定のイベントはありません。</div>}
        {events.slice(0, 3).map((e) => (
          <div key={e.id} className="spread small" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
            <span>
              <b>{e.name}</b>　<span className="muted">{eventPeriod(e)}・{e.conditions.join('・')}</span>
            </span>
            {e.open ? (
              <button className="btn small primary" disabled={busy} onClick={() => go(() => api(`/api/events/${e.id}/join`, { body: {} }))}>
                参加する
              </button>
            ) : (
              <span className="chip">開催予定</span>
            )}
          </div>
        ))}
      </div>
      <div className="grid2">
        <div className="panel mode-card">
          <div className="title">PRIVATE ROOM</div>
          <div className="small muted">友だちと対戦。招待コード・招待リンクで参加できます。</div>
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
          <button className="btn" disabled={busy} onClick={() => go(() => api('/api/rooms', { body: { settings: { pickSeconds, fillWithCpu: true } } }))}>
            ルームを作成
          </button>
        </div>
        <div className="panel mode-card">
          <div className="title">JOIN</div>
          <div className="small muted">招待コード（6文字）を入力して参加します。</div>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="例：AB12CD" aria-label="招待コード" style={{ letterSpacing: '0.2em', fontFamily: 'var(--display)', fontSize: 18 }} />
          <button className="btn" disabled={busy || code.length !== 6} onClick={() => go(() => api('/api/rooms/join', { body: { code } }))}>
            参加する
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn ghost" to="/history">
          対戦履歴
        </Link>
        <Link className="btn ghost" to="/ranked">
          ランキング
        </Link>
        <Link className="btn ghost" to="/events">
          イベント
        </Link>
        <Link className="btn ghost" to="/cards">
          選手図鑑
        </Link>
      </div>
    </div>
  );
}

export function JoinByLink() {
  const nav = useNavigate();
  const code = window.location.pathname.split('/').pop() ?? '';
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ roomId: string }>('/api/rooms/join', { body: { code } })
      .then((r) => nav(`/room/${r.roomId}`, { replace: true }))
      .catch((e) => setError(errorText((e as { code?: string }).code ?? '', (e as Error).message)));
  }, [code, nav]);
  return error ? <div className="error">{error}</div> : <div className="muted">ルームに参加しています…</div>;
}
