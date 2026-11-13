import { cardImageUrl } from '@fd/ui';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/labels';

/** highest OVR card of each rarity in the player database v1 */
const SHOWCASE_CARDS = [
  { cardAsset: 'cards/FD-103.png', alt: 'Adrian Ferreira CDM 65 (Common)' },
  { cardAsset: 'cards/FD-013.png', alt: 'Victor Fischer CM 75 (Rare)' },
  { cardAsset: 'cards/FD-009.png', alt: 'Theo Dubois RW 85 (Epic)' },
  { cardAsset: 'cards/FD-088.png', alt: 'Axel Kovac CM 92 (Legendary)' },
  { cardAsset: 'cards/FD-173.png', alt: 'Adrian Mendes CAM 99 (Icon)' },
];

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password, displayName || username);
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setError(code === 'CONFLICT' ? 'そのユーザー名は使われています' : code === 'BAD_REQUEST' ? (err as Error).message : errorText(code, (err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="hero">
        <h1>
          FOOTBALL <span>DRAFT</span>
        </h1>
        <p>限られた選手プールから14人を指名し、戦術で勝ち抜くオンライン対戦</p>
      </div>
      <div className="showcase">
        {SHOWCASE_CARDS.map((c) => (
          <img key={c.cardAsset} src={cardImageUrl(c)} alt={c.alt} width={150} height={199} style={{ borderRadius: 10 }} />
        ))}
      </div>
      <form className="panel" style={{ maxWidth: 420, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={submit}>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
            ログイン
          </button>
          <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>
            新規登録
          </button>
        </div>
        <label className="field">
          ユーザー名（英数字と _、3〜20文字）
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        {mode === 'register' && (
          <label className="field">
            表示名（対戦相手に表示）
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={24} placeholder={username} />
          </label>
        )}
        <label className="field">
          パスワード{mode === 'register' && '（8文字以上）'}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>
          {mode === 'login' ? 'ログイン' : '登録してはじめる'}
        </button>
      </form>
    </div>
  );
}
