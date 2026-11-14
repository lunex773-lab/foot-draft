import { RATING_QUESTIONS, type RoomSnapshot } from '@fd/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiFailure } from './api';

/**
 * Beta test (Phase 7, decisions 60-66): welcome note, new-version notice,
 * "add to home screen" and the optional rating after a league.
 */

// ---------------------------------------------------------------- add to home screen (decision 64)

/** opened from the home screen (no browser bars) */
export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallPromptEvent | null = null;
// Chrome / Edge offer the install once; keep it for the button in the settings
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  window.dispatchEvent(new Event('fd:installable'));
});

function deviceOf(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

export function InstallGuide() {
  const [can, setCan] = useState(!!deferred);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const on = () => setCan(true);
    window.addEventListener('fd:installable', on);
    return () => window.removeEventListener('fd:installable', on);
  }, []);
  if (isStandalone()) return <p className="small muted">ホーム画面から開いています。</p>;
  const device = deviceOf();
  return (
    <div className="small">
      <p className="muted" style={{ marginTop: 0 }}>ホーム画面に追加すると、アプリのように全画面で遊べます。</p>
      {can && !done && (
        <button
          className="btn primary small"
          onClick={async () => {
            if (!deferred) return;
            await deferred.prompt();
            const r = await deferred.userChoice;
            deferred = null;
            setCan(false);
            setDone(r.outcome === 'accepted');
          }}
        >
          ホーム画面に追加する
        </button>
      )}
      {done && <p className="good">追加しました。ホーム画面のアイコンから開いてください。</p>}
      {!can && !done && (
        <ol className="install-steps">
          {device === 'ios' ? (
            <>
              <li>Safari でこのページを開く</li>
              <li>画面下の共有ボタン（□に↑）を押す</li>
              <li>「ホーム画面に追加」を選ぶ</li>
            </>
          ) : device === 'android' ? (
            <>
              <li>Chrome でこのページを開く</li>
              <li>右上のメニュー（︙）を押す</li>
              <li>「ホーム画面に追加」または「アプリをインストール」を選ぶ</li>
            </>
          ) : (
            <li>Chrome・Edge では、アドレスバーの右側のインストールのアイコンから追加できます</li>
          )}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- welcome note

const WELCOME_KEY = 'fd:beta-welcome-v1';

export function BetaWelcome() {
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(WELCOME_KEY);
    } catch {
      return false;
    }
  });
  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* storage unavailable */
    }
    setOpen(false);
  };
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal panel beta-welcome" role="dialog" aria-labelledby="beta-title" onClick={(e) => e.stopPropagation()}>
        <div className="beta-tag">BETA</div>
        <h2 id="beta-title">ベータテストへようこそ</h2>
        <ul>
          <li>FOOTBALL DRAFT は開発中のベータ版です。遊んでいる途中に新しい版に更新されることがあります（その時は自動で再接続します）。</li>
          <li>リーグが終わると「感想（5段階）」をお聞きすることがあります。飛ばしてもかまいません。</li>
          <li>不具合や気づいたことは「設定」→「フィードバックを送信」から送ってください。返信もゲーム内に届きます。</li>
          <li>テスト中のデータ（COINS・GEMS・カードなど）は、調整のために初期状態に戻すことがあります。購入はテスト用の模擬ストアで、実際の請求は発生しません。</li>
        </ul>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Link className="btn small ghost" to="/settings" onClick={close}>
            ホーム画面に追加する方法
          </Link>
          <button className="btn primary" onClick={close}>
            はじめる
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- new version (staging keeps updating, decision 60)

export function VersionBanner() {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const v = (await r.json()) as { build?: string };
        if (!stopped && v.build && v.build !== __BUILD_ID__) setNewer(true);
      } catch {
        /* offline: try again later */
      }
    };
    const timer = setInterval(check, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    check();
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  if (!newer) return null;
  return (
    <div className="update-banner" role="status">
      新しいバージョンがあります。
      <button className="btn small primary" onClick={() => window.location.reload()}>
        再読み込み
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- rating after a league (decision 65)

const SKIP_KEY = 'fd:rating-skipped';

function Scale({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="rating-row">
      <div className="rating-q">{label}</div>
      <div className="rating-scale" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((v) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} aria-label={`${v}`} className={`rating-star ${v <= value ? 'on' : ''}`} onClick={() => onChange(v)}>
            ★
          </button>
        ))}
      </div>
      <div className="rating-ends small muted">
        <span>そう思わない</span>
        <span>とてもそう思う</span>
      </div>
    </div>
  );
}

export function LeagueRating({ snap }: { snap: RoomSnapshot }) {
  const human = snap.you !== null && !!snap.seats[snap.you]?.userId;
  const [state, setState] = useState<'hidden' | 'ask' | 'sending' | 'done'>('hidden');
  const [values, setValues] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!human) return;
    try {
      if (sessionStorage.getItem(SKIP_KEY) === snap.roomId) return;
    } catch {
      /* storage unavailable */
    }
    api<{ rated: boolean }>('/api/ratings/today')
      .then((r) => setState(r.rated ? 'hidden' : 'ask'))
      .catch(() => setState('hidden'));
  }, [human, snap.roomId]);
  if (state === 'hidden') return null;
  if (state === 'done')
    return (
      <div className="panel rating-panel small" role="status">
        感想ありがとうございました。今後の調整に使わせていただきます。
      </div>
    );
  const ready = RATING_QUESTIONS.every((q) => values[q.key]);
  const skip = () => {
    try {
      sessionStorage.setItem(SKIP_KEY, snap.roomId);
    } catch {
      /* storage unavailable */
    }
    setState('hidden');
  };
  const send = async () => {
    setState('sending');
    setError(null);
    try {
      await api('/api/ratings', { body: { roomId: snap.roomId, draftFun: values.draftFun, resultFair: values.resultFair } });
      setState('done');
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'ALREADY_RATED') setState('hidden');
      else {
        setError('送信できませんでした。もう一度お試しください。');
        setState('ask');
      }
    }
  };
  return (
    <div className="panel rating-panel">
      <div className="spread">
        <h3 style={{ margin: 0 }}>このリーグの感想（任意）</h3>
        <span className="beta-tag">BETA</span>
      </div>
      {RATING_QUESTIONS.map((q) => (
        <Scale key={q.key} label={q.label} value={values[q.key] ?? 0} onChange={(v) => setValues((x) => ({ ...x, [q.key]: v }))} />
      ))}
      {error && <div className="small bad">{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn small ghost" onClick={skip}>
          スキップ
        </button>
        <button className="btn small primary" disabled={!ready || state === 'sending'} onClick={send}>
          送信
        </button>
      </div>
      <div className="small muted">1日1回までお聞きします。詳しい感想は「設定」→「フィードバックを送信」へ。</div>
    </div>
  );
}
