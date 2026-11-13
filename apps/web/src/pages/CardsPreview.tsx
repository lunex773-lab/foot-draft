import { SHOWCASE, getCatalog } from '@fd/shared';
import { PlayerCard } from '@fd/ui';

/** Development page: the 5 showcase cards side by side (compare with the reference image). */
export default function CardsPreview() {
  const catalog = getCatalog();
  const showcase = SHOWCASE.map((s) => catalog.find((p) => p.name === `${s.firstName} ${s.lastName}`)!);
  const extra = catalog.slice(5, 25);
  return (
    <div style={{ background: '#0b0c0f', minHeight: '100vh', padding: 24 }}>
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap' }}>
        {showcase.map((p) => (
          <PlayerCard key={p.id} player={p} width={250} showLabel />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 32 }}>
        {extra.map((p) => (
          <PlayerCard key={p.id} player={p} width={170} showLabel />
        ))}
      </div>
    </div>
  );
}
