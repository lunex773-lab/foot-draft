import type { Player } from '@fd/shared';
import { useEffect, useRef, useState } from 'react';
import { CardReveal, type RevealItem } from './CardReveal';
import { IconTitle, preloadIconFont } from './IconTitle';
import { CHANT_AIM } from './audio';
import { ShootEngine, type ShootPhase } from './engine';
import { sound } from '../sound/player';
import { bestRarity } from './plan';

/**
 * SHOOT GACHA (spec "SHOOT GACHA"): the draw is already decided by the
 * server; this only shows it. Pull the ball down, release to shoot, the
 * keeper reacts by the best rarity of the draw, the ball goes in, then the
 * cards come one by one. Skip at any time.
 */
export default function ShootGacha({ results, catalog, onClose }: { results: RevealItem[]; catalog: Map<string, Player> | null; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ShootEngine | null>(null);
  const [phase, setPhase] = useState<ShootPhase | 'loading' | 'reveal'>('loading');
  const [power, setPower] = useState(0);
  const [frozen, setFrozen] = useState(false);
  const [muted, setMuted] = useState(false);
  const rarity = bestRarity(results);

  useEffect(() => {
    document.body.classList.add('shoot-open');
    sound.duck(true);
    if (rarity === 'icon') preloadIconFont();
    const canvas = canvasRef.current!;
    let engine: ShootEngine | null = null;
    try {
      engine = new ShootEngine(canvas, rarity, {
        onPhase: (p) => setPhase(p),
        onFreeze: (on) => setFrozen(on),
        onPower: (p) => setPower(p),
        onGoal: () => setPhase('reveal'),
      });
      engineRef.current = engine;
      // development: browser tests drag the ball through this handle
      if (import.meta.env.DEV) {
        (window as unknown as { __fdShoot?: ShootEngine }).__fdShoot = engine;
        if (new URLSearchParams(window.location.search).get('fixed') === '1') engine.fixedStep = true;
      }
      setMuted(engine.audio.muted);
      // the stands sing from the start (the game's audio is already running after the tap on the gacha)
      engine.audio.start();
      engine.audio.chant(CHANT_AIM, 1.0);
      setPhase('aim');
    } catch (err) {
      // no WebGL: the cards are still shown
      console.warn('SHOOT GACHA: 3D is not available', err);
      setPhase('reveal');
    }
    const onResize = () => engine?.resize();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && engine?.skip();
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('shoot-open');
      sound.duck(false);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      engine?.dispose();
      engineRef.current = null;
    };
  }, [rarity]);

  const down = (e: React.PointerEvent) => {
    if (engineRef.current?.pointerDown(e.clientX, e.clientY)) (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => engineRef.current?.pointerMove(e.clientX, e.clientY);
  const up = () => engineRef.current?.pointerUp();
  const toggleSound = () => {
    const e = engineRef.current;
    const m = !muted;
    setMuted(m);
    e?.audio.setMuted(m);
  };

  return (
    <div className={`shoot rar-${rarity} ${frozen ? 'frozen' : ''}`} data-phase={phase} role="dialog" aria-label="SHOOT GACHA">
      <canvas ref={canvasRef} className="shoot-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      {phase !== 'reveal' && (
        <>
          <div className="shoot-top">
            <button className="shoot-btn" onClick={toggleSound} aria-label={muted ? '音を出す' : '音を消す'}>
              {muted ? '🔇' : '🔊'}
            </button>
            <div className="shoot-title">SHOOT!</div>
            <button
              className="shoot-btn skip"
              onClick={() => {
                // the tap is a user gesture: start the sound so the card reveal is heard too
                engineRef.current?.audio.start();
                engineRef.current?.skip();
              }}
            >
              スキップ
            </button>
          </div>
          {(phase === 'aim' || phase === 'loading') && (
            <div className="shoot-hint">
              <div className="hand" aria-hidden="true" />
              下に引っ張って、離すとシュート
              <small>画面の下半分のどこからでも引けます。向きで狙いが変わります（結果は決まっています）</small>
            </div>
          )}
          {phase === 'charging' && (
            <div className="shoot-power" aria-label={`パワー ${Math.round(power * 100)}%`}>
              <span style={{ width: `${Math.round(power * 100)}%` }} />
            </div>
          )}
          {frozen && (
            <div className="shoot-freeze">
              <IconTitle />
            </div>
          )}
        </>
      )}
      {phase === 'reveal' && <CardReveal items={results} catalog={catalog} audio={engineRef.current?.audio ?? null} onFinish={onClose} />}
    </div>
  );
}
