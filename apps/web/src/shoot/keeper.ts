import * as THREE from 'three';
import { buildBody, kitMaterials, type Body } from './body';
import type { KeeperPlan } from './plan';

/**
 * The goalkeeper: a ready stance with small steps while the player aims,
 * then a dive whose timing and reach depend on the rarity (KeeperPlan).
 * The dive is solved so that the leading glove ends exactly `miss` metres
 * from the ball where it crosses the line (a touch for Epic, a near miss for
 * Legendary), and the keeper always lands on the grass afterwards.
 */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

export class Keeper {
  readonly body: Body;
  readonly aura: THREE.Sprite;
  private start = new THREE.Vector3(0, 0, 0.35);
  private finalRoot = new THREE.Vector3();
  private side = 1;
  private diveAt = Infinity;
  private crossAt = Infinity;
  private plan: KeeperPlan | null = null;
  /** the glove that leads the dive */
  lead: THREE.Object3D;

  constructor(scene: THREE.Scene, glow: THREE.Texture) {
    const m = kitMaterials({ jersey: '#ff7a1a', jerseyStripe: '#1a1a1a', sleeves: '#f06a10', shorts: '#16181c', socks: '#ff7a1a', sockBand: '#16181c', boots: '#121212', bootAccent: '#e5ff00', gloves: '#f2f4f5', skin: '#c99a76', hair: '#2a1d14' });
    this.body = buildBody(m);
    this.body.root.position.copy(this.start);
    scene.add(this.body.root);
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.aura.scale.set(3.2, 3.2, 1);
    this.body.pelvis.add(this.aura);
    this.lead = this.body.armR.glove;
    this.ready(0, 1);
  }

  /** knees bent, weight forward, arms out (c = how deep) */
  private ready(t: number, c: number) {
    const b = this.body;
    b.root.rotation.set(0, 0, 0);
    b.pelvis.position.y = 0.98 - 0.15 * c + Math.sin(t * 7) * 0.012 * c;
    b.spine.rotation.set(0.34 * c, 0, 0);
    b.chest.rotation.set(0.06 * c, 0, 0);
    b.neck.rotation.set(-0.32 * c, 0, 0);
    for (const [leg, s] of [
      [b.legL, -1],
      [b.legR, 1],
    ] as const) {
      leg.hip.rotation.set(-0.58 * c, 0, s * 0.17);
      leg.knee.rotation.set(1.02 * c, 0, 0);
      leg.ankle.rotation.set(-0.44 * c, 0, -s * 0.12);
    }
    for (const [arm, s] of [
      [b.armL, -1],
      [b.armR, 1],
    ] as const) {
      arm.shoulder.rotation.set(-0.55, 0, s * 0.62);
      arm.elbow.rotation.set(-0.95, 0, 0);
      arm.wrist.rotation.set(0, 0, 0);
    }
  }

  /** the dive pose: s = 0 (push-off) .. 1 (full stretch); d = direction (+1 = +x) */
  private stretch(s: number, d: number) {
    const b = this.body;
    const roll = 1.3 * s;
    b.root.rotation.set(0, d * 0.12 * s, -d * roll);
    b.pelvis.position.y = lerp(0.84, 0.98, s);
    b.spine.rotation.set(lerp(0.34, 0.06, s), 0, -d * 0.22 * s);
    b.chest.rotation.set(0, 0, -d * 0.08 * s);
    b.neck.rotation.set(lerp(-0.32, 0.05, s), 0, d * 0.3 * s);
    // both arms reach over the head towards the ball, the leading one a little further
    const up = Math.PI * 0.93;
    b.armR.shoulder.rotation.set(lerp(-0.55, -0.12, s), 0, lerp(0.62, up + (d > 0 ? 0.08 : -0.12), s));
    b.armL.shoulder.rotation.set(lerp(-0.55, -0.12, s), 0, -lerp(0.62, up + (d < 0 ? 0.08 : -0.12), s));
    b.armR.elbow.rotation.set(lerp(-0.95, -0.05, s), 0, 0);
    b.armL.elbow.rotation.set(lerp(-0.95, -0.05, s), 0, 0);
    // the push-off leg extends, the other one trails
    const push = d > 0 ? b.legL : b.legR;
    const trail = d > 0 ? b.legR : b.legL;
    push.hip.rotation.set(lerp(-0.58, 0.05, s), 0, -d * lerp(0.17, 0.05, s));
    push.knee.rotation.set(lerp(1.02, 0.12, s), 0, 0);
    trail.hip.rotation.set(lerp(-0.58, -0.35, s), 0, d * lerp(0.17, 0.4, s));
    trail.knee.rotation.set(lerp(1.02, 0.55, s), 0, 0);
    push.ankle.rotation.set(lerp(-0.44, 0.4, s), 0, 0);
    trail.ankle.rotation.set(lerp(-0.44, 0.2, s), 0, 0);
  }

  /** the keeper's plan for this shot: where the ball crosses the line and when */
  planDive(cross: THREE.Vector3, plan: KeeperPlan, kickAt: number, flight: number) {
    this.plan = plan;
    this.side = cross.x >= 0 ? 1 : -1;
    this.diveAt = kickAt + plan.reactAt;
    this.crossAt = kickAt + flight;
    this.start.copy(this.body.root.position);
    // the glove ends `miss` metres from the ball, on the keeper's side of it
    const towardKeeper = new THREE.Vector3(this.start.x - cross.x, 1.1 - cross.y, 0).normalize();
    const gloveTarget = cross.clone().addScaledVector(towardKeeper, plan.miss + 0.11);
    gloveTarget.z = 0.12;
    // solve the root position: pose the full stretch at the origin and measure the glove
    const b = this.body;
    b.root.position.set(0, 0, 0);
    this.stretch(1, this.side);
    b.root.updateMatrixWorld(true);
    this.lead = this.side > 0 ? b.armR.glove : b.armL.glove;
    const tip = new THREE.Vector3(0, -0.2, 0).applyMatrix4(this.lead.matrixWorld);
    this.finalRoot.copy(gloveTarget).sub(tip);
    b.root.position.copy(this.start);
    this.ready(0, 1);
  }

  /** where the leading fingertips are now (for the Epic touch) */
  fingertip(out = new THREE.Vector3()) {
    this.body.root.updateMatrixWorld(true);
    return out.set(0, -0.2, 0).applyMatrix4(this.lead.matrixWorld);
  }

  update(t: number) {
    const b = this.body;
    const p = this.plan;
    if (!p || t < this.diveAt) {
      // small steps and bounces while waiting
      const sway = Math.sin(t * 1.3) * 0.28 + Math.sin(t * 2.9) * 0.06;
      b.root.position.set(this.start.x * 0 + sway, 0, 0.35);
      if (p) b.root.position.copy(this.start);
      this.ready(t, 1);
      this.aura.material.opacity = 0;
      return;
    }
    const d = this.side;
    const load = 0.09; // the short dip before the push-off
    const flyTime = Math.max(0.12, this.crossAt - this.diveAt - load);
    const k = t - this.diveAt;
    if (k < load) {
      // load: the keeper sinks a little and steps towards the ball
      const q = k / load;
      this.ready(t, 1 + 0.25 * q);
      b.root.position.set(this.start.x + d * 0.12 * q, 0, this.start.z);
    } else if (t <= this.crossAt) {
      // flight to the stretch, the glove reaching its target as the ball passes
      const q = clamp01((k - load) / flyTime);
      const e = easeOut(q);
      this.stretch(easeInOut(Math.min(1, q * 1.15)), d);
      const from = new THREE.Vector3(this.start.x + d * 0.12, 0, this.start.z);
      b.root.position.lerpVectors(from, this.finalRoot, e);
      b.root.position.y += Math.sin(Math.PI * Math.min(1, q)) * 0.18;
    } else {
      // after the ball: the keeper keeps flying a little and falls onto the grass
      const q = clamp01((t - this.crossAt) / 0.55);
      this.stretch(1, d);
      const roll = lerp(1.3, 1.52, q);
      b.root.rotation.z = -d * roll;
      b.root.position.copy(this.finalRoot);
      b.root.position.x += d * 0.35 * easeOut(q);
      b.root.position.y = Math.max(0, lerp(this.finalRoot.y, -0.04, q * q));
      // arms relax when he lands
      const relax = clamp01((q - 0.6) / 0.4);
      b.armR.elbow.rotation.x = lerp(-0.05, -0.6, relax);
      b.armL.elbow.rotation.x = lerp(-0.05, -0.6, relax);
    }
    // the rarity glows around the keeper during the dive (not for Common)
    const glowOn = p.color !== 0xe8f0ff;
    this.aura.material.color.setHex(p.rainbow ? new THREE.Color().setHSL((t * 0.6) % 1, 1, 0.6).getHex() : p.color);
    this.aura.material.opacity = glowOn ? Math.min(0.85, (t - this.diveAt) * 3) * (t > this.crossAt + 0.6 ? Math.max(0, 1 - (t - this.crossAt - 0.6) * 2) : 1) : 0;
  }
}
