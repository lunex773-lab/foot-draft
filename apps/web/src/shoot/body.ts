import * as THREE from 'three';
import { fabricTexture } from './textures';

/**
 * An articulated human body built from capsules (no external model): joints
 * are Object3Ds, every limb hangs along its joint's -Y. Proportions of a
 * 1.85 m goalkeeper; angles in radians.
 */

export interface Kit {
  jersey: string;
  jerseyStripe?: string;
  sleeves: string;
  shorts: string;
  socks: string;
  sockBand?: string;
  boots: string;
  bootAccent: string;
  gloves?: string;
  skin: string;
  hair: string;
}

export interface Materials {
  jersey: THREE.Material;
  sleeves: THREE.Material;
  shorts: THREE.Material;
  socks: THREE.Material;
  band: THREE.Material;
  boots: THREE.Material;
  accent: THREE.Material;
  gloves: THREE.Material;
  skin: THREE.Material;
  hair: THREE.Material;
}

export function kitMaterials(k: Kit): Materials {
  const fabric = (c: string, stripe?: string) => new THREE.MeshStandardMaterial({ map: fabricTexture(c, stripe), roughness: 0.82, metalness: 0 });
  return {
    jersey: fabric(k.jersey, k.jerseyStripe),
    sleeves: fabric(k.sleeves),
    shorts: fabric(k.shorts),
    socks: fabric(k.socks),
    band: new THREE.MeshStandardMaterial({ color: k.sockBand ?? k.socks, roughness: 0.7 }),
    boots: new THREE.MeshStandardMaterial({ color: k.boots, roughness: 0.35, metalness: 0.15 }),
    accent: new THREE.MeshStandardMaterial({ color: k.bootAccent, roughness: 0.3, emissive: k.bootAccent, emissiveIntensity: 0.15 }),
    gloves: new THREE.MeshStandardMaterial({ color: k.gloves ?? '#f4f4f4', roughness: 0.55 }),
    skin: new THREE.MeshStandardMaterial({ color: k.skin, roughness: 0.62 }),
    hair: new THREE.MeshStandardMaterial({ color: k.hair, roughness: 0.9 }),
  };
}

const capsule = (r: number, len: number, mat: THREE.Material, rTop = r) => {
  // a capsule of the exact length, hanging from its joint (taper approximated by the mean radius)
  const rad = (r + rTop) / 2;
  const g = new THREE.CapsuleGeometry(rad, Math.max(0.001, len - 2 * rad), 6, 14);
  const m = new THREE.Mesh(g, mat);
  m.position.y = -len / 2;
  m.castShadow = true;
  return m;
};

/** a limb joint with a capsule hanging from it */
function limb(parent: THREE.Object3D, at: [number, number, number], r: number, len: number, mat: THREE.Material, rTop = r) {
  const joint = new THREE.Object3D();
  joint.position.set(...at);
  joint.add(capsule(r, len, mat, rTop));
  parent.add(joint);
  return joint;
}

function boot(parent: THREE.Object3D, m: Materials, len = 0.27) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), m.boots);
  body.scale.set(0.055, 0.05, len / 2);
  body.position.set(0, -0.035, len / 2 - 0.07);
  body.castShadow = true;
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, len * 0.95), m.accent);
  sole.position.set(0, -0.078, len / 2 - 0.07);
  const swoosh = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.012, len * 0.55), m.accent);
  swoosh.position.set(0, -0.03, len / 2 - 0.05);
  swoosh.rotation.x = 0.18;
  g.add(body, sole, swoosh);
  parent.add(g);
  return g;
}

export interface Leg {
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  ankle: THREE.Object3D;
  /** the boot (for contact with the ball) */
  foot: THREE.Object3D;
}

export function buildLeg(parent: THREE.Object3D, side: -1 | 1, m: Materials, hipAt: [number, number, number], firstPerson = false): Leg {
  const hip = new THREE.Object3D();
  hip.position.set(...hipAt);
  parent.add(hip);
  // shorts on the upper thigh, skin to the knee
  if (firstPerson) {
    // seen from above: an open shorts leg, no rounded top
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.092, 0.24, 18, 1, true), new THREE.MeshStandardMaterial({ map: (m.shorts as THREE.MeshStandardMaterial).map, roughness: 0.85, side: THREE.DoubleSide }));
    tube.position.y = -0.1;
    tube.castShadow = true;
    hip.add(tube);
    const thigh = capsule(0.072, 0.36, m.skin, 0.08);
    thigh.position.y -= 0.08;
    hip.add(thigh);
  } else {
    const shorts = capsule(0.09, 0.22, m.shorts, 0.1);
    hip.add(shorts);
    hip.add(capsule(0.072, 0.44, m.skin, 0.082));
  }
  const knee = new THREE.Object3D();
  knee.position.set(0, -0.45, 0);
  hip.add(knee);
  knee.add(capsule(0.05, 0.43, m.socks, 0.064));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.064, 0.04, 16), m.band);
  band.position.y = -0.05;
  knee.add(band);
  const ankle = new THREE.Object3D();
  ankle.position.set(0, -0.44, 0);
  knee.add(ankle);
  const foot = boot(ankle, m);
  void side;
  return { hip, knee, ankle, foot };
}

export interface Arm {
  shoulder: THREE.Object3D;
  elbow: THREE.Object3D;
  wrist: THREE.Object3D;
  glove: THREE.Object3D;
}

function buildArm(parent: THREE.Object3D, side: -1 | 1, m: Materials, at: [number, number, number]): Arm {
  const shoulder = limb(parent, at, 0.052, 0.3, m.sleeves, 0.06);
  const elbow = limb(shoulder, [0, -0.3, 0], 0.044, 0.26, m.sleeves, 0.05);
  const wrist = new THREE.Object3D();
  wrist.position.set(0, -0.27, 0);
  elbow.add(wrist);
  const glove = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.05), m.gloves);
  palm.position.y = -0.075;
  palm.castShadow = true;
  const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.04), m.gloves);
  fingers.position.y = -0.17;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), m.accent);
  cuff.position.y = -0.01;
  glove.add(palm, fingers, cuff);
  glove.position.x = side * 0.005;
  wrist.add(glove);
  return { shoulder, elbow, wrist, glove };
}

export interface Body {
  root: THREE.Group;
  pelvis: THREE.Object3D;
  spine: THREE.Object3D;
  chest: THREE.Object3D;
  neck: THREE.Object3D;
  armL: Arm;
  armR: Arm;
  legL: Leg;
  legR: Leg;
}

/** a whole goalkeeper body, facing +Z, the pelvis 0.98 m above its root */
export function buildBody(m: Materials): Body {
  const root = new THREE.Group();
  const pelvis = new THREE.Object3D();
  pelvis.position.y = 0.98;
  root.add(pelvis);
  const hips = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), m.shorts);
  hips.scale.set(0.17, 0.12, 0.12);
  hips.castShadow = true;
  pelvis.add(hips);
  const spine = new THREE.Object3D();
  spine.position.y = 0.05;
  pelvis.add(spine);
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 6, 16), m.jersey);
  belly.scale.set(0.15, 0.12, 0.11);
  belly.position.y = 0.12;
  belly.castShadow = true;
  spine.add(belly);
  const chest = new THREE.Object3D();
  chest.position.y = 0.24;
  spine.add(chest);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 6, 16), m.jersey);
  torso.scale.set(0.19, 0.12, 0.12);
  torso.position.y = 0.12;
  torso.castShadow = true;
  chest.add(torso);
  const neck = new THREE.Object3D();
  neck.position.y = 0.3;
  chest.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.09, 12), m.skin);
  neckMesh.position.y = 0.03;
  neck.add(neckMesh);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), m.skin);
  head.scale.set(0.92, 1.08, 1);
  head.position.y = 0.17;
  head.castShadow = true;
  neck.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hair);
  hair.position.set(0, 0.185, -0.008);
  hair.scale.set(0.95, 1.05, 1.02);
  neck.add(hair);
  // eyes and brows: a simple face so that the keeper does not look like a mannequin
  for (const x of [-0.035, 0.035]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.3 }));
    eye.position.set(x, 0.185, 0.095);
    neck.add(eye);
  }
  const armL = buildArm(chest, -1, m, [-0.22, 0.22, 0]);
  const armR = buildArm(chest, 1, m, [0.22, 0.22, 0]);
  const legL = buildLeg(pelvis, -1, m, [-0.1, -0.04, 0]);
  const legR = buildLeg(pelvis, 1, m, [0.1, -0.04, 0]);
  return { root, pelvis, spine, chest, neck, armL, armR, legL, legR };
}

/** world position of an object (helper) */
export function worldOf(o: THREE.Object3D, out = new THREE.Vector3()) {
  return o.getWorldPosition(out);
}
