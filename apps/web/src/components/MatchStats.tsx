import { type MatchResultData, type Player, type TeamStats } from '@fd/shared';
import { noteText } from '../lib/labels';
import type { Team } from './MatchBoard';

function Bar({ label, h, a, fmt, home, away }: { label: string; h: number; a: number; fmt?: (v: number) => string; home: Team; away: Team }) {
  const total = h + a || 1;
  const f = fmt ?? ((v: number) => String(v));
  return (
    <div className="statbar">
      <span className="display">{f(h)}</span>
      <div className="bars">
        <span className="lbl">{label}</span>
        <div className="track">
          <div style={{ width: `${(h / total) * 100}%`, background: home.color }} />
          <div style={{ width: `${(a / total) * 100}%`, background: away.color }} />
        </div>
      </div>
      <span className="display" style={{ textAlign: 'right' }}>
        {f(a)}
      </span>
    </div>
  );
}

const pct = (s: TeamStats) => (s.passes ? Math.round((s.passesCompleted / s.passes) * 100) : 0);

export function MatchStats({ result, players, home, away }: { result: MatchResultData; players: Map<string, Player>; home: Team; away: Team }) {
  const h = result.stats.home;
  const a = result.stats.away;
  const mvp = players.get(result.mvpId);
  const top = (side: 'home' | 'away') => result.players.filter((p) => p.side === side && p.minutes > 0).sort((x, y) => y.rating - x.rating);
  return (
    <div className="grid2">
      <div>
        <Bar label="支配率 %" h={h.possession} a={a.possession} home={home} away={away} />
        <Bar label="シュート" h={h.shots} a={a.shots} home={home} away={away} />
        <Bar label="枠内シュート" h={h.shotsOnTarget} a={a.shotsOnTarget} home={home} away={away} />
        <Bar label="xG（ゴール期待値）" h={h.xg} a={a.xg} fmt={(v) => v.toFixed(2)} home={home} away={away} />
        <Bar label="パス成功率 %" h={pct(h)} a={pct(a)} home={home} away={away} />
        <Bar label="コーナーキック" h={h.corners} a={a.corners} home={home} away={away} />
        <Bar label="ファウル" h={h.fouls} a={a.fouls} home={home} away={away} />
        <Bar label="警告 / 退場" h={h.yellow + h.red} a={a.yellow + a.red} home={home} away={away} />
        <div className="grid2" style={{ marginTop: 12 }}>
          {(['home', 'away'] as const).map((side) => (
            <div key={side} className="small">
              <div style={{ color: side === 'home' ? home.color : away.color, fontWeight: 700, marginBottom: 4 }}>{side === 'home' ? home.name : away.name}：戦術の効果</div>
              {result.notes[side].map((n, i) => (
                <div key={i} className="muted">
                  ・{noteText(n)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div>
        {mvp && (
          <div className="chip on" style={{ marginBottom: 10 }}>
            MVP：{mvp.name}（評価 {result.players.find((p) => p.playerId === mvp.id)?.rating.toFixed(1)}）
          </div>
        )}
        <div className="grid2">
          {(['home', 'away'] as const).map((side) => (
            <div key={side}>
              <div className="small" style={{ color: side === 'home' ? home.color : away.color, fontWeight: 700, marginBottom: 4 }}>
                選手評価
              </div>
              {top(side).map((p) => {
                const pl = players.get(p.playerId);
                return (
                  <div key={p.playerId} className="spread tiny" style={{ padding: '2px 0', borderBottom: '1px solid #1f2330' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                      {pl?.name ?? p.playerId}
                      {p.goals > 0 && ` ⚽${p.goals > 1 ? p.goals : ''}`}
                      {p.assists > 0 && ` 🅰${p.assists > 1 ? p.assists : ''}`}
                      {!p.started && ' (途中)'}
                    </span>
                    <span className="display" style={{ color: p.rating >= 7.5 ? 'var(--good)' : p.rating < 6 ? 'var(--bad)' : undefined }}>
                      {p.rating.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
