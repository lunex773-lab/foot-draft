import * as THREE from 'three';
import { crowdTexture, glowTexture, grassBump, grassTexture, ledTexture, skyTexture } from './textures';

/**
 * The stadium at night, in metres. The goal line is z = 0 (goal centred on
 * x = 0, 7.32 m x 2.44 m), the penalty spot is at z = 11 and the kicker
 * looks towards -z.
 */
export const GOAL = { halfWidth: 3.66, height: 2.44, post: 0.06, depth: 2.0, topDepth: 1.1 } as const;
export const PENALTY_Z = 11;

const LINE = new THREE.MeshStandardMaterial({ color: 0xf2f2ec, roughness: 0.8 });

function line(scene: THREE.Object3D, x: number, z: number, w: number, d: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), LINE);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.004, z);
  m.receiveShadow = true;
  scene.add(m);
}

function arc(scene: THREE.Object3D, cx: number, cz: number, radius: number, from: number, to: number) {
  const g = new THREE.RingGeometry(radius - 0.06, radius + 0.06, 64, 1, from, to - from);
  const m = new THREE.Mesh(g, LINE);
  m.rotation.x = -Math.PI / 2;
  m.position.set(cx, 0.004, cz);
  scene.add(m);
}

export interface Stadium {
  floodlights: THREE.Sprite[];
  ledMaterials: THREE.MeshBasicMaterial[];
  update(t: number): void;
}

export function buildStadium(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Stadium {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0x0b1220, 45, 140);

  // ------------------------------------------------------------ pitch
  const grass = grassTexture(aniso);
  grass.repeat.set(6, 9);
  grass.rotation = Math.PI / 2;
  const bump = grassBump();
  bump.repeat.set(30, 45);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(90, 130), new THREE.MeshStandardMaterial({ map: grass, bumpMap: bump, bumpScale: 0.6, roughness: 0.95, metalness: 0 }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0, 30);
  pitch.receiveShadow = true;
  scene.add(pitch);

  // lines: goal line, 6-yard box, 18-yard box, penalty spot, the arc
  line(scene, 0, 0, 68, 0.12);
  line(scene, 0, 5.5, 18.32, 0.12);
  line(scene, -9.16, 2.75, 0.12, 5.5);
  line(scene, 9.16, 2.75, 0.12, 5.5);
  line(scene, 0, 16.5, 40.32, 0.12);
  line(scene, -20.16, 8.25, 0.12, 16.5);
  line(scene, 20.16, 8.25, 0.12, 16.5);
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), LINE);
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(0, 0.005, 11);
  scene.add(spot);
  arc(scene, 0, 11, 9.15, Math.PI * 0.205 + Math.PI, Math.PI * 1.795);

  // ------------------------------------------------------------ goal frame
  const post = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 });
  const r = GOAL.post;
  for (const x of [-GOAL.halfWidth, GOAL.halfWidth]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL.height + r, 20), post);
    p.position.set(x, (GOAL.height + r) / 2, 0);
    p.castShadow = true;
    scene.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL.halfWidth * 2 + r * 2, 20), post);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, GOAL.height, 0);
  bar.castShadow = true;
  scene.add(bar);
  // rear supports (thin, grey)
  const support = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.6, metalness: 0.4 });
  for (const x of [-GOAL.halfWidth, GOAL.halfWidth]) {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, GOAL.topDepth, 8), support);
    top.rotation.x = Math.PI / 2;
    top.position.set(x, GOAL.height - 0.05, -GOAL.topDepth / 2);
    scene.add(top);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, Math.hypot(GOAL.depth - GOAL.topDepth, GOAL.height), 8), support);
    back.position.set(x, GOAL.height / 2, -(GOAL.topDepth + GOAL.depth) / 2);
    back.rotation.x = Math.atan2(GOAL.depth - GOAL.topDepth, GOAL.height);
    scene.add(back);
  }

  // ------------------------------------------------------------ LED boards
  const ledMaterials: THREE.MeshBasicMaterial[] = [];
  const led = (z: number, x: number, w: number, rotY: number) => {
    const tex = ledTexture('FOOTBALL DRAFT', '#e5ff00');
    tex.repeat.set(Math.round(w / 9), 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    ledMaterials.push(mat);
    const board = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 0.12), [new THREE.MeshStandardMaterial({ color: 0x0b0d10 }), new THREE.MeshStandardMaterial({ color: 0x0b0d10 }), new THREE.MeshStandardMaterial({ color: 0x0b0d10 }), new THREE.MeshStandardMaterial({ color: 0x0b0d10 }), mat, new THREE.MeshStandardMaterial({ color: 0x0b0d10 })]);
    board.position.set(x, 0.45, z);
    board.rotation.y = rotY;
    scene.add(board);
  };
  led(-5.5, 0, 46, 0);
  led(10, -30, 40, Math.PI / 2);
  led(10, 30, 40, -Math.PI / 2);

  // ------------------------------------------------------------ stands
  const palettes = [
    ['#e5ff00', '#101010', '#f4f4f4'],
    ['#1d4ed8', '#f4f4f4', '#101010'],
    ['#b91c1c', '#f4f4f4', '#101010'],
  ];
  const stand = (cx: number, cz: number, width: number, rotY: number, seed: number, palette: string[]) => {
    const group = new THREE.Group();
    const tiers = 14;
    const crowd = crowdTexture(seed, palette);
    crowd.repeat.set(width / 30, 1);
    const crowdMat = new THREE.MeshStandardMaterial({ map: crowd, color: 0xa8a8a8, roughness: 1, emissive: 0xffffff, emissiveMap: crowd, emissiveIntensity: 0.08 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 1 });
    for (let i = 0; i < tiers; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(width, 0.6, 1.1), concrete);
      step.position.set(0, 1.1 + i * 0.62, -i * 1.05);
      group.add(step);
    }
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, Math.hypot(tiers * 1.05, tiers * 0.62)), crowdMat);
    face.position.set(0, 1.4 + (tiers * 0.62) / 2, -(tiers * 1.05) / 2 + 0.45);
    face.rotation.x = -Math.atan2(tiers * 0.62, tiers * 1.05) + 0.02;
    group.add(face);
    // roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 4, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.8, metalness: 0.3 }));
    roof.position.set(0, 1.4 + tiers * 0.62 + 6, -tiers * 0.6);
    group.add(roof);
    group.position.set(cx, 0, cz);
    group.rotation.y = rotY;
    scene.add(group);
  };
  stand(0, -9, 78, 0, 101, palettes[0]);
  stand(-36, 14, 60, Math.PI / 2, 202, palettes[1]);
  stand(36, 14, 60, -Math.PI / 2, 303, palettes[2]);

  // ------------------------------------------------------------ floodlights
  const glow = glowTexture();
  const floodlights: THREE.Sprite[] = [];
  const tower = (x: number, z: number) => {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 36, 8), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7, metalness: 0.5 }));
    mast.position.set(x, 18, z);
    scene.add(mast);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xfafcff, toneMapped: false }));
    panel.position.set(x, 37, z);
    panel.lookAt(0, 0, 8);
    scene.add(panel);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xdfeaff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }));
    s.position.set(x, 37, z);
    s.scale.set(26, 26, 1);
    scene.add(s);
    floodlights.push(s);
  };
  tower(-34, -14);
  tower(34, -14);
  tower(-38, 40);
  tower(38, 40);

  // ------------------------------------------------------------ lights
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x203018, 0.55));
  const key = new THREE.DirectionalLight(0xf3f6ff, 2.6);
  key.position.set(-14, 30, -8);
  key.target.position.set(0, 0, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 10;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 1.1);
  fill.position.set(16, 26, 30);
  scene.add(fill);
  // the floodlights behind the kicker light the player's own legs and the ball
  const back = new THREE.DirectionalLight(0xfff4e6, 1.3);
  back.position.set(-6, 14, 30);
  back.target.position.set(0, 0, 11);
  // its shadow shows the player's own leg cocking on the grass in front of the ball
  back.castShadow = true;
  back.shadow.mapSize.set(1024, 1024);
  back.shadow.camera.left = -2.5;
  back.shadow.camera.right = 2.5;
  back.shadow.camera.top = 2.5;
  back.shadow.camera.bottom = -2.5;
  back.shadow.camera.near = 5;
  back.shadow.camera.far = 30;
  back.shadow.bias = -0.0006;
  back.shadow.normalBias = 0.02;
  scene.add(back, back.target);

  return {
    floodlights,
    ledMaterials,
    update(t: number) {
      // the LED boards scroll slowly
      for (const m of ledMaterials) if (m.map) m.map.offset.x = (t * 0.02) % 1;
    },
  };
}
