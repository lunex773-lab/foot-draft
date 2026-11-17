import * as THREE from 'three';
import { GOAL } from './stadium';

/**
 * The goal net as a cloth (Verlet particles + distance constraints): the top
 * and back of the net are one sheet pinned to the crossbar, the side frames
 * and the ground. The ball pushes the particles, so the net bulges and swings
 * back naturally. The side nets are drawn but do not move.
 */
export class GoalNet {
  readonly object = new THREE.Group();
  private nx = 41;
  private ny = 24;
  private pos: Float32Array;
  private prev: Float32Array;
  private pinned: Uint8Array;
  private constraints: [number, number, number][] = [];
  private lines: THREE.LineSegments;

  constructor() {
    const { nx, ny } = this;
    const n = nx * ny;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);
    const W = GOAL.halfWidth;
    // the path from the crossbar back over the top, then down the back to the ground
    const a = new THREE.Vector2(0, GOAL.height); // (z, y)
    const b = new THREE.Vector2(-GOAL.topDepth, GOAL.height - 0.08);
    const c = new THREE.Vector2(-GOAL.depth, 0.02);
    const la = a.distanceTo(b);
    const lb = b.distanceTo(c);
    for (let j = 0; j < ny; j++) {
      const s = (j / (ny - 1)) * (la + lb);
      const p = s <= la ? a.clone().lerp(b, s / la) : b.clone().lerp(c, (s - la) / lb);
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = -W + (i / (nx - 1)) * W * 2;
        this.pos.set([x, p.y, p.x], k * 3);
        this.prev.set([x, p.y, p.x], k * 3);
        if (j === 0 || j === ny - 1 || i === 0 || i === nx - 1) this.pinned[k] = 1;
      }
    }
    const dist = (p: number, q: number) => Math.hypot(this.pos[p * 3] - this.pos[q * 3], this.pos[p * 3 + 1] - this.pos[q * 3 + 1], this.pos[p * 3 + 2] - this.pos[q * 3 + 2]);
    const segIndex: number[] = [];
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (i < nx - 1) {
          this.constraints.push([k, k + 1, dist(k, k + 1)]);
          segIndex.push(k, k + 1);
        }
        if (j < ny - 1) {
          this.constraints.push([k, k + nx, dist(k, k + nx)]);
          segIndex.push(k, k + nx);
        }
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setIndex(segIndex);
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xf4f6f8, transparent: true, opacity: 0.72 }));
    this.lines.frustumCulled = false;
    this.object.add(this.lines);
    this.object.add(this.sideNet(-W), this.sideNet(W));
  }

  /** a static side net (triangle-ish quad between post, top support, back support and ground) */
  private sideNet(x: number) {
    const pts: number[] = [];
    const rows = 14;
    const cols = 12;
    // bilinear over the quad: bottom edge goal line -> back on the ground, top edge crossbar -> rear support
    const at = (u: number, v: number) => {
      const bz = -GOAL.depth * u;
      const tz = -GOAL.topDepth * u;
      const ty = GOAL.height - 0.08 * u;
      return [x, ty * v, bz + (tz - bz) * v];
    };
    for (let i = 0; i <= rows; i++) {
      const v = i / rows;
      const p1 = at(0, v);
      const p2 = at(1, v);
      pts.push(...p1, ...p2);
    }
    for (let j = 0; j <= cols; j++) {
      const u = j / cols;
      const p1 = at(u, 0);
      const p2 = at(u, 1);
      pts.push(...p1, ...p2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe9edf0, transparent: true, opacity: 0.45 }));
  }

  /**
   * One step. `ball` pushes the particles out of its sphere; returns how deep
   * the ball is in the net (0 = no contact), used to slow the ball down.
   */
  step(dt: number, ball: THREE.Vector3 | null, radius: number): number {
    const { pos, prev, pinned } = this;
    const n = pos.length / 3;
    const damping = 0.985;
    const g = -2.2 * dt * dt;
    for (let k = 0; k < n; k++) {
      if (pinned[k]) continue;
      const i = k * 3;
      for (let a = 0; a < 3; a++) {
        const cur = pos[i + a];
        const v = (cur - prev[i + a]) * damping;
        prev[i + a] = cur;
        pos[i + a] = cur + v + (a === 1 ? g : 0);
      }
    }
    let contact = 0;
    for (let it = 0; it < 4; it++) {
      for (const [p, q, rest] of this.constraints) {
        const ip = p * 3;
        const iq = q * 3;
        const dx = pos[iq] - pos[ip];
        const dy = pos[iq + 1] - pos[ip + 1];
        const dz = pos[iq + 2] - pos[ip + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (d <= rest) continue; // a net does not push, it only pulls
        const diff = (d - rest) / d;
        const wp = pinned[p] ? 0 : pinned[q] ? 1 : 0.5;
        const wq = pinned[q] ? 0 : pinned[p] ? 1 : 0.5;
        pos[ip] += dx * diff * wp;
        pos[ip + 1] += dy * diff * wp;
        pos[ip + 2] += dz * diff * wp;
        pos[iq] -= dx * diff * wq;
        pos[iq + 1] -= dy * diff * wq;
        pos[iq + 2] -= dz * diff * wq;
      }
      if (ball) {
        const r = radius + 0.03;
        for (let k = 0; k < n; k++) {
          if (pinned[k]) continue;
          const i = k * 3;
          const dx = pos[i] - ball.x;
          const dy = pos[i + 1] - ball.y;
          const dz = pos[i + 2] - ball.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < r && d > 1e-6) {
            const push = (r - d) / d;
            pos[i] += dx * push;
            pos[i + 1] += dy * push;
            pos[i + 2] += dz * push;
            contact = Math.max(contact, r - d);
          }
        }
      }
    }
    (this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    return contact;
  }

  /** how far the net has been pushed back at x / y (for the ball: where the net stops it) */
  backAt(x: number, y: number): number {
    const i = Math.round(((x + GOAL.halfWidth) / (GOAL.halfWidth * 2)) * (this.nx - 1));
    let best = -GOAL.depth;
    for (let j = 0; j < this.ny; j++) {
      const k = j * this.nx + Math.max(0, Math.min(this.nx - 1, i));
      if (Math.abs(this.pos[k * 3 + 1] - y) < 0.2) best = Math.max(best, this.pos[k * 3 + 2]);
    }
    return best;
  }
}
