import type { RoleId, TraitId } from '@fd/shared';
import type { ReactNode } from 'react';

/** Line icons drawn in a ±10 box centred at the origin. */
type GlyphFn = (c: string) => ReactNode;

const s = (c: string, w = 1.6) => ({ fill: 'none', stroke: c, strokeWidth: w, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

const G: Record<string, GlyphFn> = {
  crosshair: (c) => (
    <g {...s(c)}>
      <circle r={6.5} />
      <path d="M0 -10 V-4 M0 4 V10 M-10 0 H-4 M4 0 H10" />
      <circle r={1.2} fill={c} />
    </g>
  ),
  crossArrows: (c) => (
    <g {...s(c)}>
      <path d="M-8 7 L7 -8 M2 -8 H7 V-3 M-8 -7 L-2 -1 M2 3 L8 9 M8 4 V9 H3" />
      <circle cx={-7} cy={8} r={1.2} fill={c} />
    </g>
  ),
  chevrons: (c) => (
    <g {...s(c, 2)}>
      <path d="M-8 -7 L-1 0 L-8 7 M0 -7 L7 0 L0 7" />
    </g>
  ),
  wall: (c) => (
    <g {...s(c, 1.4)}>
      <rect x={-9} y={-7} width={18} height={14} rx={1} />
      <path d="M-9 -2.3 H9 M-9 2.3 H9 M-3 -7 V-2.3 M4 -7 V-2.3 M0 -2.3 V2.3 M-6 -2.3 V2.3 M6 -2.3 V2.3 M-3 2.3 V7 M4 2.3 V7" />
    </g>
  ),
  aerial: (c) => (
    <g {...s(c)}>
      <circle cx={0} cy={-6} r={3.2} />
      <path d="M-7 9 C-7 2 -4 -1 0 -1 C4 -1 7 2 7 9" />
      <path d="M-9 -9 L-6 -7 M9 -9 L6 -7" />
    </g>
  ),
  press: (c) => (
    <g {...s(c)}>
      <path d="M-9 -9 L-3 -3 M-3 -7 V-3 H-7 M9 -9 L3 -3 M3 -7 V-3 H7 M-9 9 L-3 3 M-3 7 V3 H-7 M9 9 L3 3 M3 7 V3 H7" />
    </g>
  ),
  clock: (c) => (
    <g {...s(c)}>
      <circle r={8} />
      <path d="M0 -5 V0 L4 3" />
      <path d="M-3 -11 H3" />
    </g>
  ),
  glove: (c) => (
    <g {...s(c, 1.4)}>
      <path d="M-6 9 V-1 C-6 -3 -8 -4 -8 -6 C-8 -8 -6 -8 -5 -6 L-4 -4 V-8 C-4 -10 -1 -10 -1 -8 V-5 V-9 C-1 -11 2 -11 2 -9 V-5 V-8 C2 -10 5 -10 5 -8 V-4 V-6 C5 -8 8 -8 8 -6 V3 C8 6 6 9 3 9 Z" />
    </g>
  ),
  gloveArrow: (c) => (
    <g>
      <g transform="translate(-2 1) scale(0.8)">{G.glove(c)}</g>
      <g {...s(c, 1.6)}>
        <path d="M4 -9 H10 M7 -12 L10 -9 L7 -6" />
      </g>
    </g>
  ),
  swirl: (c) => (
    <g {...s(c)}>
      <path d="M8 2 C8 7 3 9 -1 8 C-6 7 -9 2 -8 -3 C-7 -7 -2 -9 2 -8 C6 -7 7 -2 4 1 C1 4 -3 3 -3 -1 C-3 -3 -1 -4 1 -3" />
    </g>
  ),
  heart: (c) => (
    <g {...s(c)}>
      <path d="M0 8 C-9 2 -9 -4 -6 -7 C-3 -9 -1 -7 0 -5 C1 -7 3 -9 6 -7 C9 -4 9 2 0 8 Z" />
      <path d="M-6 0 H-3 L-1 -3 L1 3 L3 0 H6" />
    </g>
  ),
  cornerFlag: (c) => (
    <g {...s(c)}>
      <path d="M-5 9 V-9 L6 -5 L-5 -1" />
      <path d="M-9 9 H9" />
      <path d="M2 9 A7 7 0 0 1 9 2" />
    </g>
  ),
  armband: (c) => (
    <g {...s(c)}>
      <rect x={-9} y={-6} width={18} height={12} rx={2} />
      <path d="M3 -2.5 C1 -4 -3 -3.5 -3 0 C-3 3.5 1 4 3 2.5" />
    </g>
  ),
  gloveUp: (c) => (
    <g>
      <g transform="translate(0 2) scale(0.78)">{G.glove(c)}</g>
      <g {...s(c, 1.6)}>
        <path d="M-9 -2 V-10 M-12 -7 L-9 -10 L-6 -7" />
      </g>
    </g>
  ),
  shield: (c) => (
    <g {...s(c)}>
      <path d="M0 -9 L8 -6 V0 C8 5 4 8 0 10 C-4 8 -8 5 -8 0 V-6 Z" />
    </g>
  ),
  shieldArrow: (c) => (
    <g {...s(c)}>
      <path d="M0 -9 L8 -6 V0 C8 5 4 8 0 10 C-4 8 -8 5 -8 0 V-6 Z" />
      <path d="M0 5 V-4 M-3 -1 L0 -4 L3 -1" />
    </g>
  ),
  shieldBolt: (c) => (
    <g {...s(c)}>
      <path d="M0 -9 L8 -6 V0 C8 5 4 8 0 10 C-4 8 -8 5 -8 0 V-6 Z" />
      <path d="M1 -5 L-3 1 H1 L-1 6" />
    </g>
  ),
  wing: (c) => (
    <g {...s(c)}>
      <path d="M-9 6 C-4 6 4 2 9 -8 C3 -6 -3 -4 -8 0 M-6 3 C-2 2 3 -1 6 -5" />
    </g>
  ),
  anchor: (c) => (
    <g {...s(c)}>
      <circle cx={0} cy={-7} r={2.2} />
      <path d="M0 -5 V9 M-4 -2 H4 M-8 2 C-8 7 -4 9 0 9 C4 9 8 7 8 2" />
    </g>
  ),
  radar: (c) => (
    <g {...s(c)}>
      <circle r={8} />
      <circle r={4} />
      <path d="M0 0 L6 -6" />
    </g>
  ),
  loop: (c) => (
    <g {...s(c)}>
      <path d="M-6 -3 C-6 -8 6 -8 6 -3 M6 3 C6 8 -6 8 -6 3" />
      <path d="M3 -5 L6 -2 L9 -5 M-3 5 L-6 2 L-9 5" />
    </g>
  ),
  key: (c) => (
    <g {...s(c)}>
      <circle cx={-4} cy={-4} r={4} />
      <path d="M-1 -1 L8 8 M5 5 L3 7 M7 7 L5 9" />
    </g>
  ),
  ghost: (c) => (
    <g {...s(c)}>
      <circle r={7} strokeDasharray="2.5 2.2" />
      <circle r={2} fill={c} />
    </g>
  ),
  sideArrows: (c) => (
    <g {...s(c)}>
      <path d="M-9 0 H9 M-6 -3 L-9 0 L-6 3 M6 -3 L9 0 L6 3" />
      <path d="M-3 -7 H3 M-3 7 H3" />
    </g>
  ),
  curve: (c) => (
    <g {...s(c)}>
      <path d="M-8 8 C-8 -2 -2 -6 6 -6 M2 -9 L6 -6 L2 -3" />
    </g>
  ),
  target: (c) => (
    <g {...s(c)}>
      <circle r={8} />
      <circle r={4.5} />
      <circle r={1.3} fill={c} />
    </g>
  ),
  tower: (c) => (
    <g {...s(c, 1.4)}>
      <path d="M-5 9 V-5 H-7 V-9 H-3 V-7 H-1 V-9 H1 V-7 H3 V-9 H7 V-5 H5 V9 Z" />
    </g>
  ),
  nine: (c) => (
    <g {...s(c)}>
      <circle cx={0} cy={-3} r={4} />
      <path d="M4 -3 C4 4 2 7 -3 8" />
    </g>
  ),
  star: (c) => (
    <g {...s(c, 1.4)}>
      <path d="M0 -9 L2.6 -3 L9 -3 L4 1.4 L6 8 L0 4 L-6 8 L-4 1.4 L-9 -3 L-2.6 -3 Z" />
    </g>
  ),
};

export const TRAIT_GLYPH: Record<TraitId, string> = {
  sniper: 'crosshair',
  playmaker: 'crossArrows',
  speedster: 'chevrons',
  wall: 'wall',
  aerial_king: 'aerial',
  pressing_machine: 'press',
  clutch: 'clock',
  sweeper_keeper: 'gloveArrow',
  trickster: 'swirl',
  engine: 'heart',
  set_piece: 'cornerFlag',
  leader: 'armband',
  shot_stopper: 'glove',
  commanding: 'gloveUp',
};

export const ROLE_GLYPH: Record<RoleId, string> = {
  keeper_classic: 'glove',
  keeper_libero: 'gloveArrow',
  stopper: 'shield',
  ball_playing_cb: 'shieldArrow',
  cover_cb: 'shieldBolt',
  fullback: 'shield',
  wingback: 'wing',
  anchor: 'anchor',
  deep_playmaker: 'radar',
  box_to_box: 'loop',
  advanced_playmaker: 'key',
  shadow_striker: 'ghost',
  wide_midfielder: 'sideArrows',
  winger: 'wing',
  inside_forward: 'curve',
  poacher: 'target',
  target_man: 'tower',
  false_nine: 'nine',
  complete_forward: 'star',
};

export function Glyph({ name, color }: { name: string; color: string }) {
  const fn = G[name] ?? G.star;
  return <>{fn(color)}</>;
}

/** Standalone icon (for lists / legends). */
export function GlyphIcon({ name, color = 'currentColor', size = 18 }: { name: string; color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      <Glyph name={name} color={color} />
    </svg>
  );
}
