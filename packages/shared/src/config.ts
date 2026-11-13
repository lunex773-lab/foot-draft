/**
 * Game configuration.
 *
 * Values marked "provisional" are the agreed initial values from
 * docs/02-decisions.md and are expected to be tuned after beta tests.
 */
export const GAME_CONFIG = {
  maxPlayers: 4,
  /** picks per player (11 starters + 3 subs) */
  picksPerPlayer: 14,
  startersCount: 11,
  benchCount: 3,
  /** provisional: seconds per pick (spec 3-4) */
  pickSeconds: 8,
  /** allowed values for private rooms */
  pickSecondsOptions: [5, 8, 10, 15] as readonly number[],
  /** provisional: candidate pool per draft */
  pool: { GK: 12, DF: 24, MF: 24, FW: 12, FREE: 12 },
  /** provisional: max goalkeepers one player can draft */
  maxGkPerTeam: 3,
  /** provisional: lineup editing seconds right after the draft */
  lineupSecondsFirst: 60,
  /** provisional: lineup editing seconds between matchdays */
  lineupSecondsBetween: 30,
  /** confirmed: playback length of one match (90 min) */
  matchPlaybackSeconds: 60,
  /** seconds to show standings after a matchday before the next phase */
  standingsSeconds: 6,
  /** delay before a CPU makes its pick (UX only) */
  cpuPickDelayMs: 1200,
  /** number of player cards (player database v1) */
  catalogSize: 300,
} as const;

/** v1 = generated 240 cards (retired), v2 = FOOTBALL DRAFT 300 Player Database v1 */
export const CATALOG_VERSION = 2;

/** Bump whenever the simulation logic changes (stored with every match, spec 6-4). */
export const SIM_VERSION = '0.2.0';
