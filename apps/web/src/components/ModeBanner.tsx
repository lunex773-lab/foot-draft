import { describeFilter, type RoomSnapshot } from '@fd/shared';

/** Shows what kind of league this room plays (Ranked / Solo Challenge / Event). */
export function ModeBanner({ snap }: { snap: RoomSnapshot }) {
  const v = snap.variant;
  if (v.kind === 'ranked') {
    return (
      <div className="mode-banner ranked">
        <span className="chip on">RANKED</span>
        <span className="small">ランク戦：最終順位でレートが変わります（人間同士の順位のみ）</span>
      </div>
    );
  }
  if (v.kind === 'solo') {
    const c = v.challenge;
    return (
      <div className="mode-banner solo">
        <span className="chip on">SOLO CHALLENGE</span>
        <span className="small">
          目標：<b>{c.goalJa}</b>　候補：{c.pool.labelJa}　ルール：{c.ruleJa}
        </span>
      </div>
    );
  }
  if (v.kind === 'event') {
    return (
      <div className="mode-banner event">
        <span className="chip on">EVENT</span>
        <span className="small">
          <b>{v.name}</b>　{describeFilter(v.filter).join('　')}
        </span>
      </div>
    );
  }
  if (v.kind === 'collection') {
    return (
      <div className="mode-banner event">
        <span className="chip on">COLLECTION DRAFT</span>
        <span className="small">「専用」と表示されたカードは、登録した本人だけが指名できます。ほかの候補は共通です。</span>
      </div>
    );
  }
  return null;
}
