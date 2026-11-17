import type { Rarity } from '@fd/shared';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShootAudio } from './audio';
import { Burst, RainbowRings, Trail } from './effects';
import { Keeper } from './keeper';
import { KICK, Kicker } from './kicker';
import { GoalNet } from './net';
import { aimFromDrag, flightTime, keeperPlan, type Aim, type KeeperPlan } from './plan';
import { PENALTY_Z, buildStadium, type Stadium } from './stadium';
import { ballTexture, glowTexture } from './textures';

/**
 * SHOOT GACHA engine (spec "SHOOT GACHA"): a first-person penalty in 3D.
 * The rarity is the server's result; the drag only changes the motion.
 */

export type ShootPhase = 'aim' | 'charging' | 'shot' | 'goal';

export interface ShootEvents {
  onPhase?(p: ShootPhase): void;
  /** the time stands still (Icon) */
  onFreeze?(on: boolean): void;
  /** the ball is in the net and the card can come */
  onGoal(): void;
  /** the drag: power 0..1 for the gauge */
  onPower?(power: number): void;
}

const BALL_R = 0.11;
const G = new THREE.Vector3(0, -9.81, 0);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** lenses: wide while looking down at the ball, tighter when watching the goal (tall phones get wider ones) */
function lens(aspect: number) {
  if (aspect < 0.6) return { aim: 92, watch: 62 };
  if (aspect < 1) return { aim: 80, watch: 56 };
  return { aim: 60, watch: 42 };
}

/** a drag can start anywhere below this fraction of the screen height (under the goal) */
const DRAG_AREA_TOP = 0.36;

export class ShootEngine {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private stadium: Stadium;
  private net: GoalNet;
  private keeper: Keeper;
  private kicker: Kicker;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private trail: Trail;
  private burst: Burst;
  private touchBurst: Burst;
  private rings: RainbowRings;
  private goalLight: THREE.PointLight;
  private guide: THREE.Line;
  private marker: THREE.Sprite;
  private plan: KeeperPlan;
  readonly audio = new ShootAudio();

  private phase: ShootPhase = 'aim';
  private raf = 0;
  private lastReal = 0;
  private sim = 0;
  private frozenUntil = 0;
  /** how far down a full-power pull is (px), set when the drag starts */
  private pullRange = 200;
  private freezeDone = false;
  private dragFrom: { x: number; y: number } | null = null;
  private aim: Aim = { power: 0, target: { x: 2, y: 1 } };
  private releaseAt = Infinity;
  private kickAt = Infinity;
  private flight = 0.4;
  private p0 = new THREE.Vector3(0, BALL_R, PENALTY_Z);
  private v0 = new THREE.Vector3();
  private curve = 0;
  private crossed = false;
  private vel = new THREE.Vector3();
  private spin = new THREE.Vector3();
  private touched = false;
  private netHitAt = Infinity;
  private goalSent = false;
  private shake = 0;
  private disposed = false;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  /** development: every frame advances the time by 1/60 s (browser tests on slow software rendering) */
  fixedStep = false;
  /** frames drawn so far */
  frame = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private rarity: Rarity,
    private events: ShootEvents,
  ) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 400);
    this.stadium = buildStadium(this.scene, this.renderer);
    const glow = glowTexture();
    this.net = new GoalNet();
    this.scene.add(this.net.object);
    this.keeper = new Keeper(this.scene, glow);
    this.kicker = new Kicker(this.scene, this.p0, BALL_R);
    this.plan = keeperPlan(rarity);

    // the ball and its contact shadow
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 28), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.42, metalness: 0.02 }));
    this.ball.castShadow = true;
    this.ball.position.copy(this.p0);
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);

    this.trail = new Trail(glow);
    this.trail.color.setHex(this.plan.color);
    this.trail.rainbow = this.plan.rainbow;
    this.trail.strength = rarity === 'common' ? 0.18 : 0.6;
    this.burst = new Burst(glow, 260, 0.22);
    this.touchBurst = new Burst(glow, 90, 0.14);
    this.rings = new RainbowRings();
    this.scene.add(this.trail.points, this.burst.points, this.touchBurst.points, this.rings.group);
    this.goalLight = new THREE.PointLight(this.plan.color, 0, 14, 2);
    this.goalLight.position.set(0, 1.4, -0.8);
    this.scene.add(this.goalLight);

    // the aiming guide: a dotted arc from the ball and a marker in the goal
    this.guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, () => new THREE.Vector3())), new THREE.LineDashedMaterial({ color: 0xe5ff00, dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0.9, toneMapped: false }));
    this.guide.visible = false;
    this.guide.frustumCulled = false;
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xe5ff00, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.marker.scale.set(0.9, 0.9, 1);
    this.marker.visible = false;
    this.scene.add(this.guide, this.marker);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    this.placeCamera(0, 0);
    this.lastReal = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(Math.max(128, w / 2), Math.max(128, h / 2));
    this.camera.aspect = w / h;
    this.camera.fov = lens(this.camera.aspect).aim;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------- input

  /** client pixel position of the ball */
  ballOnScreen() {
    const v = this.ball.position.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /**
   * spec 2-1: the drag starts on the ball, or anywhere on the lower part of the
   * screen below the goal (easier for fingers than hitting the ball exactly)
   */
  pointerDown(x: number, y: number): boolean {
    if (this.phase !== 'aim') return false;
    const b = this.ballOnScreen();
    const r = this.canvas.getBoundingClientRect();
    const onBall = Math.hypot(x - b.x, y - b.y) <= Math.max(70, r.height * 0.11);
    const lower = y >= r.top + r.height * DRAG_AREA_TOP;
    if (!onBall && !lower) return false;
    this.audio.start();
    this.dragFrom = { x, y };
    // full power before the finger reaches the bottom edge, wherever the drag starts
    this.pullRange = Math.max(r.height * 0.1, Math.min(r.height * 0.26, r.bottom - y - 16));
    this.setPhase('charging');
    return true;
  }

  pointerMove(x: number, y: number) {
    if (this.phase !== 'charging' || !this.dragFrom) return;
    const r = this.canvas.getBoundingClientRect();
    this.aim = aimFromDrag(x - this.dragFrom.x, y - this.dragFrom.y, r.height, this.pullRange);
    this.events.onPower?.(this.aim.power);
  }

  /** spec 2-4..6: release = kick; a tiny pull is cancelled */
  pointerUp() {
    if (this.phase !== 'charging') return;
    this.dragFrom = null;
    if (this.aim.power < 0.12) {
      this.aim.power = 0;
      this.events.onPower?.(0);
      this.setPhase('aim');
      return;
    }
    this.releaseAt = this.sim;
    this.kicker.release(this.sim);
    this.kickAt = this.kicker.contactAt;
    this.flight = flightTime(this.aim.power);
    const target = new THREE.Vector3(this.aim.target.x, this.aim.target.y, 0);
    this.v0 = target.clone().sub(this.p0).addScaledVector(G, -0.5 * this.flight * this.flight).divideScalar(this.flight);
    // a slight curl: the ball bends towards its side of the goal
    this.curve = -Math.sign(target.x) * (0.25 + 0.35 * this.aim.power);
    this.spin.set(-18 - 22 * this.aim.power, 0, Math.sign(target.x) * 9);
    this.keeper.planDive(target, this.plan, this.kickAt, this.flight);
    this.setPhase('shot');
  }

  /** spec: the animation can be skipped at any time */
  skip() {
    if (!this.goalSent) {
      this.goalSent = true;
      this.events.onGoal();
    }
  }

  private setPhase(p: ShootPhase) {
    this.phase = p;
    this.events.onPhase?.(p);
  }

  // -------------------------------------------------------------- frame

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const realDt = this.fixedStep ? 1 / 60 : Math.min(0.05, (now - this.lastReal) / 1000);
    this.lastReal = now;
    this.frame++;
    let dt = realDt * this.timeScale();
    // Icon: the time stands still for a moment
    if (this.clockMs() < this.frozenUntil) dt = 0;
    else if (this.frozenUntil && !this.freezeDone) {
      this.freezeDone = true;
      this.events.onFreeze?.(false);
    }
    this.sim += dt;
    this.step(dt, realDt, now / 1000);
    this.render(realDt, now / 1000);
  };

  /** the clock for the Icon freeze (real ms; frames in the fixed-step test mode) */
  private clockMs(): number {
    return this.fixedStep ? (this.frame * 1000) / 60 : performance.now();
  }

  /** slow motion around the moment the ball passes the keeper (Epic and above) */
  private timeScale(): number {
    const s = this.plan.slowmo;
    if (!s || this.phase !== 'shot') return 1;
    const crossAt = this.kickAt + this.flight;
    const k = this.sim - crossAt;
    if (k < s.from - 0.06 || k > s.to + 0.12) return 1;
    if (k < s.from) return lerp(1, s.scale, (k - (s.from - 0.06)) / 0.06);
    if (k > s.to) return lerp(s.scale, 1, (k - s.to) / 0.12);
    return s.scale;
  }

  private step(dt: number, realDt: number, realT: number) {
    const t = this.sim;
    this.stadium.update(realT);
    if (this.phase === 'charging' || this.phase === 'aim') this.kicker.setAim(this.phase === 'charging' ? this.aim.power : 0);
    else this.kicker.update(t);
    this.keeper.update(t);

    // the plant foot lands
    if (this.releaseAt + KICK.plant <= t && this.releaseAt + KICK.plant > t - dt) this.audio.plant();

    // ---------------------------------------------------------------- ball
    if (t >= this.kickAt) {
      const k = t - this.kickAt;
      if (k - dt < 0) {
        this.audio.kick(this.aim.power);
        this.shake = 0.06 + 0.06 * this.aim.power;
      }
      if (!this.crossed && k < this.flight) {
        // the planned flight: exactly through the target on the goal line
        const p = this.p0.clone().addScaledVector(this.v0, k).addScaledVector(G, 0.5 * k * k);
        p.x += this.curve * Math.sin((Math.PI * k) / this.flight);
        this.ball.position.copy(p);
      } else {
        if (!this.crossed) {
          this.crossed = true;
          const kf = this.flight;
          this.vel.copy(this.v0).addScaledVector(G, kf);
          this.vel.x += ((this.curve * Math.PI) / this.flight) * Math.cos(Math.PI);
          this.ball.position.set(this.aimTarget().x, this.aimTarget().y, 0);
          if (this.plan.touch && !this.touched) {
            // Epic: the fingertips touch the ball, it lifts a little and still goes in
            this.touched = true;
            this.vel.y += 1.6;
            this.vel.x += Math.sign(this.aim.target.x) * 0.9;
            this.touchBurst.fire(this.keeper.fingertip(), this.plan.color, false, 3, new THREE.Vector3(0, 0.3, 0.8));
            this.audio.sting('epic');
          }
        }
        this.vel.addScaledVector(G, dt);
        this.ball.position.addScaledVector(this.vel, dt);
        const contact = this.net.step(dt, this.ball.position, BALL_R);
        if (contact > 0.005) {
          // the net catches the ball
          this.vel.multiplyScalar(Math.exp(-dt * 42));
          if (this.netHitAt === Infinity) {
            this.netHitAt = t;
            this.audio.net();
            this.audio.roar();
            this.burst.fire(this.ball.position, this.plan.color, this.plan.rainbow, this.rarity === 'common' ? 2.5 : 5);
            this.shake = Math.max(this.shake, 0.05);
          }
        }
        if (this.ball.position.y < BALL_R) {
          this.ball.position.y = BALL_R;
          this.vel.y = Math.abs(this.vel.y) * 0.35;
          this.vel.x *= 0.8;
          this.vel.z *= 0.8;
        }
        this.ball.position.z = Math.max(this.ball.position.z, -2.7);
      }
      // the ball spins (slower in the net)
      const spinScale = this.netHitAt < Infinity ? 0.3 : 1;
      this.ball.rotation.x += this.spin.x * dt * spinScale;
      this.ball.rotation.z += this.spin.z * dt * spinScale;
      if (this.netHitAt === Infinity) this.trail.emit(this.ball.position);
    }
    if (!this.crossed || this.netHitAt === Infinity) this.net.step(dt, t >= this.kickAt ? this.ball.position : null, BALL_R);

    // Icon: freeze just before the ball passes the keeper
    if (this.plan.freeze && !this.frozenUntil && this.phase === 'shot' && t >= this.kickAt + this.flight - 0.07) {
      this.frozenUntil = this.clockMs() + this.plan.freeze * 1000;
      this.events.onFreeze?.(true);
      this.audio.hush();
    }
    // the keeper's reaction sting (Rare and above), the goal
    if (this.phase === 'shot' && this.netHitAt < Infinity && !this.goalSent) {
      this.setPhase('goal');
      if (this.rarity !== 'common' && this.rarity !== 'epic') this.audio.sting(this.rarity);
      if (this.rarity === 'common') this.audio.sting('common');
    }
    // the card reveal starts a moment after the ball hits the net (animation time);
    // as a safety net it also starts if the net contact was never detected
    const stuck = this.phase === 'shot' && t > this.kickAt + this.flight + 3;
    if (((this.phase === 'goal' && t >= this.netHitAt + 1.1) || stuck) && !this.goalSent) {
      this.goalSent = true;
      this.events.onGoal();
    }
    this.trail.update(dt, realT);
    this.burst.update(dt, realT);
    this.touchBurst.update(dt, realT);
    const frozen = this.clockMs() < this.frozenUntil ? 1 : 0;
    this.rings.group.position.copy(this.ball.position);
    this.rings.update(realT, frozen, this.camera);
    this.ballShadow.position.set(this.ball.position.x, 0.006, this.ball.position.z);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.45 * Math.max(0, 1 - this.ball.position.y / 2.5);
    this.ballShadow.scale.setScalar(1 + this.ball.position.y * 0.6);
    // the goal light flashes in the rarity colour
    const sinceNet = t - this.netHitAt;
    this.goalLight.intensity = sinceNet >= 0 ? Math.max(0, (this.rarity === 'common' ? 8 : 30) * (1 - sinceNet / 1.4)) : 0;
    if (this.plan.rainbow) this.goalLight.color.setHSL((realT * 0.8) % 1, 1, 0.6);
    this.shake = Math.max(0, this.shake - realDt * 0.25);
    this.placeCamera(t, realDt);
    this.updateGuide();
  }

  private aimTarget() {
    return this.aim.target;
  }

  /**
   * First person: the eyes are over the kicker's hips, looking down at the
   * ball and the right boot while aiming; after the strike the player looks
   * up and follows the ball to the goal (a tighter lens), and for the near
   * miss (Epic and above) the view closes in on the ball and the keeper.
   */
  private placeCamera(t: number, realDt: number) {
    const body = this.kicker.group.position;
    const L = lens(this.camera.aspect);
    const pull = this.phase === 'charging' ? this.aim.power : 0;
    const eye = new THREE.Vector3(body.x - 0.1, body.y + 0.72, body.z + 0.14 + pull * 0.08);
    // looking down about 26 degrees (a little more while the leg cocks)
    const down = 0.45 + pull * 0.08;
    let look = eye.clone().add(new THREE.Vector3(0.12, -Math.tan(down) * 5, -5));
    let fov = L.aim;
    if (t >= this.releaseAt) {
      const k = clamp01((t - this.kickAt + 0.02) / 0.5);
      const e = smooth(k);
      const watch = new THREE.Vector3(this.aim.target.x * 0.4, 1.15, 0);
      look = look.clone().lerp(watch, e);
      eye.y += 0.1 * e;
      fov = lerp(L.aim, L.watch, e);
      const crossAt = this.kickAt + this.flight;
      const near = this.plan.slowmo ? Math.exp(-(((t - crossAt) / 0.2) ** 2)) : 0;
      if (near > 0.01) {
        look.lerp(new THREE.Vector3(this.aim.target.x * 0.85, this.aim.target.y, 0), near * 0.65);
        fov = lerp(fov, L.watch * 0.6, near);
      }
    }
    // a soft breathing sway while aiming, a shake on the strike / the goal
    const sway = this.phase === 'aim' ? Math.sin(performance.now() / 900) * 0.008 : 0;
    eye.x += sway + (Math.random() - 0.5) * this.shake;
    eye.y += (Math.random() - 0.5) * this.shake;
    const a = realDt > 0 ? 1 - Math.exp(-realDt * 16) : 1;
    if (this.camPos.lengthSq() === 0) {
      this.camPos.copy(eye);
      this.camLook.copy(look);
    }
    this.camPos.lerp(eye, a);
    this.camLook.lerp(look, a);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = lerp(this.camera.fov, fov, a);
      this.camera.updateProjectionMatrix();
    }
  }

  /** the dotted arc and the target while pulling (spec: Monster-Strike-like pull and release) */
  private updateGuide() {
    const on = this.phase === 'charging' && this.aim.power > 0.02;
    this.guide.visible = on;
    this.marker.visible = on;
    if (!on) return;
    const tFlight = flightTime(this.aim.power);
    const target = new THREE.Vector3(this.aim.target.x, this.aim.target.y, 0);
    const v = target.clone().sub(this.p0).addScaledVector(G, -0.5 * tFlight * tFlight).divideScalar(tFlight);
    const curve = -Math.sign(target.x) * (0.25 + 0.35 * this.aim.power);
    const pos = this.guide.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = (i / (pos.count - 1)) * tFlight;
      const p = this.p0.clone().addScaledVector(v, k).addScaledVector(G, 0.5 * k * k);
      p.x += curve * Math.sin((Math.PI * k) / tFlight);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    this.guide.computeLineDistances();
    const mat = this.guide.material as THREE.LineDashedMaterial;
    mat.opacity = 0.35 + this.aim.power * 0.6;
    this.marker.position.copy(target);
    const s = 0.6 + this.aim.power * 0.5;
    this.marker.scale.set(s, s, 1);
  }

  private render(realDt: number, realT: number) {
    // Icon: the screen goes dark while the time stands still
    const frozen = this.clockMs() < this.frozenUntil;
    const exposure = frozen ? 0.32 : 1.05;
    this.renderer.toneMappingExposure = lerp(this.renderer.toneMappingExposure, exposure, 1 - Math.exp(-realDt * 10));
    this.bloom.strength = this.phase === 'goal' ? (this.rarity === 'common' ? 0.6 : 0.95) : frozen ? 1.2 : 0.55;
    void realT;
    this.composer.render();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.audio.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
  }
}
