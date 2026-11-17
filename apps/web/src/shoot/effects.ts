import * as THREE from 'three';

/** additive glowing particles (trail behind the ball, bursts at the touch / in the net) */
function pointsMaterial(glow: THREE.Texture, size: number) {
  return new THREE.PointsMaterial({ size, map: glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
}

const rainbow = (t: number, out: THREE.Color) => out.setHSL(((t % 1) + 1) % 1, 1, 0.6);

export class Trail {
  readonly points: THREE.Points;
  private n = 70;
  private pos: Float32Array;
  private col: Float32Array;
  private age: Float32Array;
  private head = 0;
  color = new THREE.Color(0xffffff);
  rainbow = false;
  strength = 0.35;

  constructor(glow: THREE.Texture) {
    this.pos = new Float32Array(this.n * 3);
    this.col = new Float32Array(this.n * 3);
    this.age = new Float32Array(this.n).fill(99);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, pointsMaterial(glow, 0.42));
    this.points.frustumCulled = false;
  }

  emit(p: THREE.Vector3) {
    this.pos.set([p.x, p.y, p.z], this.head * 3);
    this.age[this.head] = 0;
    this.head = (this.head + 1) % this.n;
  }

  update(dt: number, t: number) {
    const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      const life = Math.max(0, 1 - this.age[i] / 0.45);
      if (this.rainbow) rainbow(t * 0.8 + i / this.n, c);
      else c.copy(this.color);
      const k = life * this.strength;
      this.col.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export class Burst {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private base: THREE.Color[] = [];
  private rainbow = false;

  constructor(glow: THREE.Texture, n = 180, size = 0.2) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, pointsMaterial(glow, size));
    this.points.frustumCulled = false;
  }

  /** spray of sparks from `at` (speed in m/s, `dir` biases the spray) */
  fire(at: THREE.Vector3, color: number, rainbowOn: boolean, speed = 4, dir = new THREE.Vector3(0, 0.6, 0.4)) {
    this.rainbow = rainbowOn;
    this.base = [];
    for (let i = 0; i < this.n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      v.addScaledVector(dir, speed * 0.5);
      this.vel.set([v.x, v.y, v.z], i * 3);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.life[i] = 0.6 + Math.random() * 0.9;
      this.base.push(new THREE.Color(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2));
    }
  }

  update(dt: number, t: number) {
    const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.col.set([0, 0, 0], i * 3);
        continue;
      }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 4.5 * dt;
      for (let a = 0; a < 3; a++) {
        this.vel[i * 3 + a] *= 1 - 1.6 * dt;
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      }
      if (this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.3;
      }
      const k = Math.min(1, this.life[i] * 1.4);
      if (this.rainbow) rainbow(t + i / 37, c);
      else c.copy(this.base[i] ?? c.set(0xffffff));
      this.col.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

/** rainbow rings around the ball while the time stands still (Icon) */
export class RainbowRings {
  readonly group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  constructor() {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.28 + i * 0.16, 0.31 + i * 0.16, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      this.rings.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
  }
  update(t: number, on: number, camera: THREE.Camera) {
    this.group.visible = on > 0;
    this.group.quaternion.copy(camera.quaternion);
    this.rings.forEach((r, i) => {
      const mat = r.material as THREE.MeshBasicMaterial;
      mat.color.setHSL((t * 0.7 + i * 0.18) % 1, 1, 0.6);
      mat.opacity = on * (0.85 - i * 0.15);
      const s = 1 + 0.15 * Math.sin(t * 6 + i);
      r.scale.set(s, s, s);
    });
  }
}
