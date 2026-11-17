import * as THREE from 'three';
import { buildLeg, kitMaterials, type Leg } from './body';

/**
 * The player's own legs in first person (right-footed). Pulling the ball
 * back cocks the kicking leg; on release the body steps in, the plant foot
 * lands beside the ball, the kicking leg whips through and strikes the ball
 * with the instep, then follows through. The body position at the strike is
 * solved so that the boot really meets the ball.
 */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) ** 2;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** the timing of the kick after the release (seconds) */
export const KICK = { plant: 0.13, contact: 0.205, follow: 0.46, settle: 0.95 } as const;

interface LegPose {
  hip: number;
  knee: number;
  ankle: number;
  hipZ?: number;
}

export class Kicker {
  readonly group = new THREE.Group();
  readonly kick: Leg;
  readonly plant: Leg;
  /** where the hips are while aiming / at the strike */
  readonly aimPos = new THREE.Vector3(-0.2, 0.93, 11.72);
  readonly strikePos = new THREE.Vector3();
  private power = 0;
  private releasedAt = Infinity;

  constructor(scene: THREE.Scene, ball: THREE.Vector3, ballRadius: number) {
    const m = kitMaterials({ jersey: '#121418', sleeves: '#121418', shorts: '#121418', socks: '#121418', sockBand: '#e5ff00', boots: '#17191d', bootAccent: '#e5ff00', skin: '#d6a77f', hair: '#000' });
    // the group faces -Z (towards the goal): local +X is the player's left, so the right leg is at local -X
    this.group.rotation.y = Math.PI;
    this.kick = buildLeg(this.group, 1, m, [-0.1, 0, 0], true);
    this.plant = buildLeg(this.group, -1, m, [0.1, 0, 0], true);
    scene.add(this.group);
    // solve the strike position: pose the contact frame at the origin and move it so that the instep meets the ball
    this.group.position.set(0, 0, 0);
    this.poseLeg(this.kick, { hip: -0.32, knee: 0.22, ankle: 0.62 });
    this.poseLeg(this.plant, { hip: -0.08, knee: 0.32, ankle: -0.1 });
    this.group.updateMatrixWorld(true);
    const instep = new THREE.Vector3(0, -0.06, 0.1).applyMatrix4(this.kick.ankle.matrixWorld);
    const contact = new THREE.Vector3(ball.x + 0.02, ball.y - 0.02, ball.z + ballRadius + 0.02);
    this.strikePos.copy(contact).sub(instep);
    this.setAim(0);
  }

  private poseLeg(l: Leg, p: LegPose) {
    l.hip.rotation.set(p.hip, 0, p.hipZ ?? 0);
    l.knee.rotation.set(p.knee, 0, 0);
    l.ankle.rotation.set(p.ankle, 0, 0);
  }

  /** while pulling: p = 0..1 */
  setAim(p: number) {
    this.power = p;
    this.group.position.copy(this.aimPos);
    // a slight lean back as the leg cocks
    this.group.rotation.x = -0.05 * p;
    // at rest the right boot is just behind the ball; pulling swings it back and up
    this.poseLeg(this.kick, { hip: lerp(-0.26, 0.62, p), knee: lerp(0.18, 1.75, easeOut(p)), ankle: lerp(0.1, 0.45, p), hipZ: -0.04 + 0.06 * p });
    this.poseLeg(this.plant, { hip: lerp(0.02, -0.08, p), knee: lerp(0.1, 0.3, p), ankle: 0, hipZ: 0.06 });
  }

  release(t: number) {
    this.releasedAt = t;
  }

  /** the moment the boot meets the ball (simulation time) */
  get contactAt() {
    return this.releasedAt + KICK.contact;
  }

  update(t: number) {
    if (t < this.releasedAt) return;
    const k = t - this.releasedAt;
    const p = this.power;
    const windHip = lerp(0.62, 0.95, 0.4 + 0.6 * p);
    const windKnee = lerp(1.75, 2.15, p);
    // the body moves in over the plant foot, then carries on a little after the strike
    const run = clamp01(k / KICK.contact);
    const after = clamp01((k - KICK.contact) / (KICK.follow - KICK.contact));
    this.group.position.lerpVectors(this.aimPos, this.strikePos, easeInOut(run));
    this.group.position.z -= 0.22 * easeOut(after);
    this.group.position.y += Math.sin(Math.PI * run) * 0.04 - 0.05 * Math.sin(Math.PI * clamp01((k - KICK.plant) / 0.2));
    this.group.rotation.x = lerp(-0.05 * p, 0.06, run) - 0.1 * Math.sin(Math.PI * after);
    // plant foot: steps forward and lands beside the ball
    const step = clamp01(k / KICK.plant);
    // plant foot: steps forward and a little out, lands beside the ball
    this.poseLeg(this.plant, { hip: lerp(-0.08, -0.4, Math.sin((Math.PI / 2) * step)) + 0.36 * easeIn(clamp01((k - KICK.plant) / 0.25)), knee: lerp(0.3, 0.12, step) + 0.22 * Math.sin(Math.PI * clamp01((k - KICK.plant) / 0.3)), ankle: lerp(0, -0.12, step), hipZ: lerp(0.06, 0.16, step) });
    // kicking leg: back-lift to the plant, whip through to the strike, follow-through, settle
    if (k < KICK.plant) {
      const q = easeOut(k / KICK.plant);
      this.poseLeg(this.kick, { hip: lerp(lerp(-0.26, 0.62, p), windHip, q), knee: lerp(lerp(0.18, 1.75, p), windKnee, q), ankle: 0.5 });
    } else if (k < KICK.contact) {
      const q = (k - KICK.plant) / (KICK.contact - KICK.plant);
      // the thigh leads, the knee snaps straight late in the swing (natural kicking chain)
      this.poseLeg(this.kick, { hip: lerp(windHip, -0.32, easeIn(q) * 0.4 + q * 0.6), knee: lerp(windKnee, 0.22, easeIn(q)), ankle: lerp(0.5, 0.62, q) });
    } else if (k < KICK.follow) {
      const q = easeOut(after);
      this.poseLeg(this.kick, { hip: lerp(-0.32, -1.25 - 0.25 * p, q), knee: lerp(0.22, 0.08, q), ankle: lerp(0.62, 0.35, q) });
    } else {
      const q = easeInOut(clamp01((k - KICK.follow) / (KICK.settle - KICK.follow)));
      this.poseLeg(this.kick, { hip: lerp(-1.25 - 0.25 * p, -0.15, q), knee: lerp(0.08, 0.35, q), ankle: lerp(0.35, 0.05, q) });
    }
  }
}
