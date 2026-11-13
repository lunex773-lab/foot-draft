import type { InternalAttributes, Position, RoleId } from '../types';

/**
 * Play style (role) used by the chemistry system. The player database does
 * not contain play styles, so they are derived deterministically from the
 * primary position and the SIM attributes.
 */
export function deriveRole(primary: Position, a: InternalAttributes): RoleId {
  const avg = (...v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const passing = avg(a.shortPassing, a.longPassing, a.vision);
  const defending = avg(a.tackling, a.interception);
  const pace = avg(a.acceleration, a.sprintSpeed);
  switch (primary) {
    case 'GK':
      return avg(a.shortPassing, a.longPassing) >= 55 || a.acceleration >= 55 ? 'keeper_libero' : 'keeper_classic';
    case 'CB':
      if (a.sprintSpeed >= 72) return 'cover_cb';
      if (avg(a.shortPassing, a.longPassing) >= 66) return 'ball_playing_cb';
      return 'stopper';
    case 'LB':
    case 'RB':
      return avg(pace, a.stamina, a.dribbling) > defending + 4 ? 'wingback' : 'fullback';
    case 'LWB':
    case 'RWB':
      return 'wingback';
    case 'CDM':
      return passing > defending + 3 ? 'deep_playmaker' : 'anchor';
    case 'CM':
      return passing >= avg(a.tackling, a.interception, a.stamina) + 15 ? 'deep_playmaker' : 'box_to_box';
    case 'CAM':
      return avg(a.finishing, a.positioning) > avg(a.vision, a.shortPassing) - 6 ? 'shadow_striker' : 'advanced_playmaker';
    case 'LM':
    case 'RM':
      return avg(pace, a.dribbling) > avg(a.shortPassing, a.longPassing, a.stamina) + 3 ? 'winger' : 'wide_midfielder';
    case 'LW':
    case 'RW':
      return avg(a.finishing, a.shotAccuracy) >= avg(a.sprintSpeed, a.dribbling) - 9 ? 'inside_forward' : 'winger';
    case 'CF':
      return avg(a.vision, a.shortPassing) >= a.finishing - 6 ? 'false_nine' : 'complete_forward';
    case 'ST': {
      const aerial = avg(a.strength, a.jumping);
      if (aerial >= 72 && aerial >= pace) return 'target_man';
      if (avg(a.vision, a.shortPassing) >= a.finishing - 4) return 'false_nine';
      if (avg(a.finishing, a.positioning) >= avg(pace, a.dribbling, a.strength) + 1) return 'poacher';
      return 'complete_forward';
    }
  }
}
