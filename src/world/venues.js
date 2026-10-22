import * as THREE from 'three';
import { canvasTexture } from '../engine/utils.js';

// Sports venues in Sports City: basketball court, soccer stadium, baseball park.
// Each registers a mini-game zone in world.minigames.

const Y = 6.03;

function flat(world, w, d, x, z, rot, tex, y = Y, round = false) {
  // round fields use a disc with the same UV layout as the square, so they never hang past the flattened ground
  const geo = round ? new THREE.CircleGeometry(w / 2, 72) : new THREE.PlaneGeometry(w, d);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = rot;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  world.root.add(m);
  return m;
}

function solid(world, geo, mat, x, y, z, rotY = 0, collider = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.y = rotY;
  m.castShadow = m.receiveShadow = true;
  world.root.add(m);
  if (collider) {
    geo.computeBoundingBox();
    const s = geo.boundingBox.getSize(new THREE.Vector3());
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    world.physics.fixed(world.physics.R.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2), { kind: 'building' }, x, y, z, { x: q.x, y: q.y, z: q.z, w: q.w });
  }
  return m;
}

// Stepped bleachers along one side
function bleachers(world, x, z, len, rotY, color = 0x2f6bff, rows = 6) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const seat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
  const dir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
  for (let r = 0; r < rows; r++) {
    const h = 0.8 * (r + 1);
    const off = r * 1.2;
    solid(world, new THREE.BoxGeometry(len, h, 1.2), r % 2 ? mat : seat, x - dir.x * off, Y + h / 2, z - dir.z * off, rotY);
  }
  // crowd of little colorful people (instanced capsules) that cheer
  const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 0.5, 2, 6), new THREE.MeshStandardMaterial({ roughness: 0.7 }), rows * Math.floor(len / 0.9));
  const m4 = new THREE.Matrix4(); const c = new THREE.Color(); let i = 0;
  const side = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
  for (let r = 0; r < rows; r++) for (let k = 0; k < Math.floor(len / 0.9); k++) {
    if (Math.random() < 0.35) continue;
    const off = r * 1.2, s = -len / 2 + 0.45 + k * 0.9;
    m4.makeTranslation(x - dir.x * off + side.x * s, Y + 0.8 * (r + 1) + 0.45, z - dir.z * off + side.z * s);
    crowd.setMatrixAt(i, m4);
    crowd.setColorAt(i, c.setHSL(Math.random(), 0.75, 0.55));
    i++;
  }
  crowd.count = i;
  crowd.castShadow = true;
  world.root.add(crowd);
  world.crowds ??= [];
  world.crowds.push({ mesh: crowd, base: Array.from({ length: i }, (_, j) => { const m = new THREE.Matrix4(); crowd.getMatrixAt(j, m); return m; }) });
}

export function buildSportsVenues(world, p) {
  if (p.type === 'basketball') buildCourt(world, p);
  if (p.type === 'soccer') buildSoccer(world, p);
  if (p.type === 'baseball') buildBaseball(world, p);
}

// A net made of line strands. `verts` = [x, y, z, weight] (weight = how much that point can stretch when hit).
// Returns { mesh, base, w } so the mini-games can wobble it.
function strandNet(verts, pairs, color = 0xffffff, opacity = 0.85) {
  const pos = new Float32Array(pairs.length * 6);
  const w = new Float32Array(pairs.length * 2);
  pairs.forEach(([a, b], i) => {
    pos.set([verts[a][0], verts[a][1], verts[a][2], verts[b][0], verts[b][1], verts[b][2]], i * 6);
    w[i * 2] = verts[a][3]; w[i * 2 + 1] = verts[b][3];
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  mesh.frustumCulled = false;
  return { mesh, base: pos.slice(), w };
}

// Basketball court: hoops sit 1.6 m in from each baseline, rim 3.05 m up, 3-point arc 7 m around the rim.
const RIM_IN = 1.6, ARC = 7.0;
export const HOOP_SPOTS = [-70, -35, 0, 35, 70]; // degrees around the arc, 0 = straight out from the rim
function buildCourt(world, p) {
  const L = 28, W = 15;
  const PX = 1024 / (L + 2); // texture pixels per meter
  const tex = canvasTexture(1024, 560, (ctx, w, h) => {
    ctx.fillStyle = '#e07b39'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 24) { ctx.fillStyle = x % 48 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)'; ctx.fillRect(x, 0, 24, h); }
    ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 5;
    ctx.strokeRect(PX, PX, w - 2 * PX, h - 2 * PX);
    ctx.beginPath(); ctx.moveTo(w / 2, PX); ctx.lineTo(w / 2, h - PX); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 1.8 * PX, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff3d7f'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 1.7 * PX, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SPORTNITE', w / 2, h / 2 + 12);
    for (const sx of [0, 1]) {
      const base = sx ? w - PX : PX, dir = sx ? -1 : 1;
      const rimX = base + dir * RIM_IN * PX;
      // the paint (key) and free-throw circle
      const keyL = 5.8 * PX, keyW = 4.9 * PX;
      ctx.fillStyle = '#2f6bff'; ctx.fillRect(sx ? base - keyL : base, h / 2 - keyW / 2, keyL, keyW);
      ctx.strokeRect(sx ? base - keyL : base, h / 2 - keyW / 2, keyL, keyW);
      ctx.beginPath(); ctx.arc(base + dir * keyL, h / 2, 1.8 * PX, 0, Math.PI * 2); ctx.stroke();
      // 3-point line: straight in the corners, then the arc around the rim
      const cy = Math.sqrt(ARC * ARC - 6.6 * 6.6) * PX; // where the arc meets the corner lines (6.6 m from the rim sideways)
      ctx.beginPath();
      ctx.moveTo(base, h / 2 - 6.6 * PX); ctx.lineTo(rimX + dir * cy, h / 2 - 6.6 * PX);
      const a0 = Math.atan2(-6.6, dir * cy / PX), a1 = Math.atan2(6.6, dir * cy / PX);
      ctx.arc(rimX, h / 2, ARC * PX, a0, a1, sx === 0 ? false : true);
      ctx.lineTo(base, h / 2 + 6.6 * PX);
      ctx.stroke();
      // shooting spots for the 3-point contest
      ctx.fillStyle = '#ffd34d';
      for (const ang of HOOP_SPOTS) {
        const r = (ang * Math.PI) / 180, d = (ARC + 0.35) * PX;
        ctx.beginPath(); ctx.arc(rimX + dir * Math.cos(r) * d, h / 2 + Math.sin(r) * d, 9, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
  flat(world, L + 2, W + 2, p.x, p.z, 0, tex);
  const pole = new THREE.MeshStandardMaterial({ color: 0x333a44, metalness: 0.6, roughness: 0.4 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x2f6bff, roughness: 0.7 });
  const boardTex = canvasTexture(256, 150, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ff3d1f'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.lineWidth = 6; ctx.strokeRect(w / 2 - 42, h - 70, 84, 62);
  });
  const board = new THREE.MeshStandardMaterial({ map: boardTex, transparent: true, roughness: 0.15, metalness: 0.1 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xff5a1f, emissive: 0xff3300, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.35 });
  const hoops = [];
  for (const sx of [-1, 1]) {
    const rimX = p.x + sx * (L / 2 - RIM_IN);
    const rim = new THREE.Vector3(rimX, Y + 3.05, p.z);
    const boardX = rimX + sx * 0.405; // front face 0.38 m behind the rim center
    // pole outside the baseline + an arm out to the board
    solid(world, new THREE.CylinderGeometry(0.13, 0.17, 3.9, 12), pole, rimX + sx * 1.75, Y + 1.95, p.z);
    solid(world, new THREE.BoxGeometry(0.5, 1.6, 0.5), pad, rimX + sx * 1.75, Y + 0.8, p.z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 0.12), pole);
    arm.position.set(rimX + sx * 1.1, Y + 3.45, p.z); world.root.add(arm);
    const bm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.07, 1.83), board);
    bm.position.set(boardX, Y + 2.9 + 0.535, p.z); bm.castShadow = true; world.root.add(bm);
    const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.018, 8, 32), rimMat);
    rimMesh.rotation.x = Math.PI / 2; rimMesh.position.copy(rim); rimMesh.castShadow = true;
    world.root.add(rimMesh);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.12), rimMat);
    bracket.position.set(rimX + sx * 0.31, Y + 3.04, p.z); world.root.add(bracket);
    // net: 12 strands from the rim down to a narrower bottom ring, criss-crossed
    const N = 12, verts = [], pairs = [];
    const rows = [[0, 0.23, 0], [0.16, 0.2, 0.6], [0.3, 0.17, 0.9], [0.42, 0.14, 1]];
    rows.forEach(([dy, r, wt], ri) => { for (let k = 0; k < N; k++) { const a = ((k + ri * 0.5) / N) * Math.PI * 2; verts.push([rim.x + Math.cos(a) * r, rim.y - dy, rim.z + Math.sin(a) * r, wt]); } });
    for (let ri = 0; ri < rows.length - 1; ri++) for (let k = 0; k < N; k++) {
      pairs.push([ri * N + k, (ri + 1) * N + k]);
      pairs.push([ri * N + k, (ri + 1) * N + ((k - 1 + N) % N)]);
    }
    for (let k = 0; k < N; k++) pairs.push([3 * N + k, 3 * N + ((k + 1) % N)]);
    const net = strandNet(verts, pairs, 0xffffff, 0.9);
    world.root.add(net.mesh);
    hoops.push({ rim, sx, rimR: 0.23, board: { x: boardX - sx * 0.025, y0: Y + 2.9, y1: Y + 3.97, hz: 0.915 }, net });
  }
  bleachers(world, p.x, p.z - W / 2 - 3, L, 0, 0xff3d7f, 4);
  bleachers(world, p.x, p.z + W / 2 + 3, L, Math.PI, 0x2f6bff, 4);
  world.minigames.push({ type: 'hoops', name: 'Hoops', x: p.x, z: p.z, r: 10, hoops, arc: ARC, y: Y });
  world.lootSpots.push({ x: p.x + 3, y: Y + 0.2, z: p.z + 3, kind: 'floor', poi: p.name });
  world.lootSpots.push({ x: p.x - 3, y: Y + 0.2, z: p.z - 3, kind: 'floor', poi: p.name });
}

// Soccer stadium: full-size goals (7.32 x 2.44 m) with a net that bulges when the ball hits it.
const GOAL_W = 3.66, GOAL_H = 2.44;
function buildSoccer(world, p) {
  const L = 60, W = 38;
  const PX = 1200 / (L + 4);
  const tex = canvasTexture(1200, 760, (ctx, w, h) => {
    for (let x = 0; x < w; x += 60) { ctx.fillStyle = (x / 60) % 2 ? '#3fb34f' : '#36a347'; ctx.fillRect(x, 0, 60, h); }
    ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 5;
    ctx.strokeRect(2 * PX, 2 * PX, w - 4 * PX, h - 4 * PX);
    ctx.beginPath(); ctx.moveTo(w / 2, 2 * PX); ctx.lineTo(w / 2, h - 2 * PX); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 9.15 * PX * 0.6, 0, Math.PI * 2); ctx.stroke();
    for (const sx of [0, 1]) {
      const x0 = sx ? w - 2 * PX : 2 * PX, dir = sx ? -1 : 1;
      const box = 16.5 * 0.6 * PX, six = 5.5 * PX;
      ctx.strokeRect(sx ? x0 - box : x0, h / 2 - 20 * PX * 0.55, box, 40 * PX * 0.55);
      ctx.strokeRect(sx ? x0 - six : x0, h / 2 - 9 * PX * 0.6, six, 18 * PX * 0.6);
      // penalty spot 11 m out
      ctx.beginPath(); ctx.arc(x0 + dir * 11 * PX, h / 2, 5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    }
  });
  flat(world, L + 4, W + 4, p.x, p.z, 0, tex);
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const goals = [];
  for (const sx of [-1, 1]) {
    const gx = p.x + sx * (L / 2);
    for (const s of [-1, 1]) solid(world, new THREE.CylinderGeometry(0.06, 0.06, GOAL_H, 12), white, gx, Y + GOAL_H / 2, p.z + s * GOAL_W);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, GOAL_W * 2 + 0.12, 12), white);
    bar.rotation.x = Math.PI / 2; bar.position.set(gx, Y + GOAL_H, p.z); bar.castShadow = true; world.root.add(bar);
    // back frame
    for (const s of [-1, 1]) {
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, GOAL_H * 1.12, 6), white);
      back.position.set(gx + sx * 1.5, Y + GOAL_H / 2, p.z + s * GOAL_W); back.rotation.z = sx * 0.45; world.root.add(back);
    }
    // net: back panel slanting from the top (1 m deep) down to the ground (2 m deep), plus roof and sides
    const verts = [], pairs = [], NZ = 24, NY = 8;
    const idx = (iz, iy) => iz * (NY + 1) + iy;
    for (let iz = 0; iz <= NZ; iz++) for (let iy = 0; iy <= NY; iy++) {
      const z = p.z - GOAL_W + (iz / NZ) * GOAL_W * 2, t = iy / NY; // t = 0 ground .. 1 top
      const edge = Math.min(iz, NZ - iz, iy, NY - iy) / 3;
      verts.push([gx + sx * (2 - t), Y + t * GOAL_H, z, Math.min(1, edge)]);
    }
    for (let iz = 0; iz <= NZ; iz++) for (let iy = 0; iy <= NY; iy++) {
      if (iz < NZ) pairs.push([idx(iz, iy), idx(iz + 1, iy)]);
      if (iy < NY) pairs.push([idx(iz, iy), idx(iz, iy + 1)]);
    }
    const base = verts.length;
    for (let iz = 0; iz <= NZ; iz += 2) { // roof strands from the crossbar back to the top of the back panel
      verts.push([gx, Y + GOAL_H, p.z - GOAL_W + (iz / NZ) * GOAL_W * 2, 0]);
      pairs.push([verts.length - 1, idx(iz, NY)]);
    }
    for (const s of [0, NZ]) for (let iy = 0; iy <= NY; iy += 2) { // side strands
      verts.push([gx, Y + (iy / NY) * GOAL_H, p.z - GOAL_W + (s / NZ) * GOAL_W * 2, 0]);
      pairs.push([verts.length - 1, idx(s, iy)]);
    }
    void base;
    const net = strandNet(verts, pairs, 0xffffff, 0.7);
    world.root.add(net.mesh);
    goals.push({ x: gx, z: p.z, dir: sx, w: GOAL_W, h: GOAL_H, y: Y, net });
  }
  bleachers(world, p.x, p.z - W / 2 - 5, L, 0, 0x2f6bff, 7);
  bleachers(world, p.x, p.z + W / 2 + 5, L, Math.PI, 0xffc21f, 7);
  // big screen
  const screenTex = canvasTexture(512, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#7b2cff'); g.addColorStop(1, '#ff2c9c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SPORTNITE', w / 2, 110);
    ctx.font = 'bold 32px sans-serif'; ctx.fillText('GOAL STADIUM', w / 2, 170);
  });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshBasicMaterial({ map: screenTex }));
  scr.position.set(p.x, Y + 14, p.z - W / 2 - 14); world.root.add(scr);
  solid(world, new THREE.BoxGeometry(17, 9, 0.6), new THREE.MeshStandardMaterial({ color: 0x222222 }), p.x, Y + 14, p.z - W / 2 - 14.4);
  solid(world, new THREE.BoxGeometry(1, 10, 1), new THREE.MeshStandardMaterial({ color: 0x555555 }), p.x, Y + 5, p.z - W / 2 - 14.4);
  world.minigames.push({ type: 'penalty', name: 'Penalty Kicks', x: p.x + L / 2 - 11, z: p.z, r: 6, goal: goals[1], y: Y });
  world.lootSpots.push({ x: p.x, y: Y + 0.2, z: p.z, kind: 'chest', poi: p.name });
  world.lootSpots.push({ x: p.x - 20, y: Y + 0.2, z: p.z + 8, kind: 'floor', poi: p.name });
}

// Baseball park: home plate at the south end, outfield toward +z, pitcher's mound 17 m out,
// a 62 m (203 ft) outfield wall with foul poles.
const MOUND = 17, FENCE = 62, FENCE_H = 3.2;
function buildBaseball(world, p) {
  const R = 46;
  const PX = 1024 / (2 * R);
  const tex = canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#3fae4f'; ctx.fillRect(0, 0, w, h);
    const hx = w / 2, hy = h - 2.7 * PX;
    // mowed grass fan
    ctx.fillStyle = '#4cc25a';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.arc(hx, hy, w * 0.92, -Math.PI * 0.75, -Math.PI * 0.25); ctx.closePath(); ctx.fill();
    for (let k = 0; k < 12; k++) { ctx.strokeStyle = k % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'; ctx.lineWidth = 40; ctx.beginPath(); ctx.arc(hx, hy, 80 + k * 70, -Math.PI * 0.75, -Math.PI * 0.25); ctx.stroke(); }
    // warning track in front of the wall
    ctx.strokeStyle = '#b77a43'; ctx.lineWidth = 3 * PX;
    ctx.beginPath(); ctx.arc(hx, hy, (FENCE - 1.5) * PX, -Math.PI * 0.75, -Math.PI * 0.25); ctx.stroke();
    // dirt infield
    const base = 24 * PX / Math.SQRT2; // 24 m base paths
    ctx.fillStyle = '#c98a4b';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.arc(hx, hy, 29 * PX, -Math.PI * 0.75, -Math.PI * 0.25); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4cc25a';
    ctx.save(); ctx.translate(hx, hy - base); ctx.rotate(Math.PI / 4); ctx.fillRect(-base * 0.62, -base * 0.62, base * 1.24, base * 1.24); ctx.restore();
    // dirt circle around home
    ctx.fillStyle = '#c98a4b'; ctx.beginPath(); ctx.arc(hx, hy, 4 * PX, 0, Math.PI * 2); ctx.fill();
    // foul lines
    ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + 700, hy - 700); ctx.moveTo(hx, hy); ctx.lineTo(hx - 700, hy - 700); ctx.stroke();
    // batter's boxes
    ctx.lineWidth = 2;
    for (const s of [-1, 1]) ctx.strokeRect(hx + s * 0.75 * PX - 0.6 * PX, hy - 0.9 * PX, 1.2 * PX, 1.8 * PX);
    // bases
    ctx.fillStyle = '#f4f4f4';
    for (const [bx, by] of [[base, -base], [0, -2 * base], [-base, -base]]) { ctx.save(); ctx.translate(hx + bx, hy + by); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.restore(); }
  });
  // field faces +z toward the outfield (home plate at the south end)
  flat(world, 2 * R, 2 * R, p.x, p.z, Math.PI, tex, Y, true);
  const home = new THREE.Vector3(p.x, Y, p.z - R + 2.7);
  // home plate (pentagon, point toward the catcher)
  const plate = new THREE.Shape();
  plate.moveTo(-0.215, 0); plate.lineTo(0.215, 0); plate.lineTo(0.215, -0.215); plate.lineTo(0, -0.43); plate.lineTo(-0.215, -0.215); plate.closePath();
  const pm = new THREE.Mesh(new THREE.ShapeGeometry(plate), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -8 }));
  pm.rotation.x = -Math.PI / 2; pm.position.set(home.x, Y + 0.012, home.z + 0.2); pm.receiveShadow = true;
  world.root.add(pm);
  // pitcher's mound + rubber
  const mound = home.clone().add(new THREE.Vector3(0, 0, MOUND));
  solid(world, new THREE.CylinderGeometry(2.4, 2.8, 0.25, 32), new THREE.MeshStandardMaterial({ color: 0xc98a4b, roughness: 0.95 }), mound.x, Y + 0.125, mound.z);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  rubber.position.set(mound.x, Y + 0.27, mound.z); world.root.add(rubber);
  // outfield wall arc with distance signs and yellow foul poles
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1f8f3a, roughness: 0.6 });
  const signTex = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1f8f3a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 80px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(Math.round(FENCE * 3.28)), w / 2, 92);
  });
  const segs = 16;
  for (let i = 0; i <= segs; i++) {
    const th = -Math.PI / 4 + (i / segs) * (Math.PI / 2);
    solid(world, new THREE.BoxGeometry(6.4, FENCE_H, 0.5), wallMat, home.x + Math.sin(th) * (FENCE + 0.25), Y + FENCE_H / 2, home.z + Math.cos(th) * (FENCE + 0.25), th);
    if (i === 0 || i === segs / 2 || i === segs) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: signTex }));
      s.position.set(home.x + Math.sin(th) * (FENCE - 0.02), Y + FENCE_H - 0.9, home.z + Math.cos(th) * (FENCE - 0.02));
      s.rotation.y = th + Math.PI; world.root.add(s);
    }
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xffd400, emissive: 0x664400, emissiveIntensity: 0.4 });
  for (const s of [-1, 1]) {
    const th = s * Math.PI / 4;
    solid(world, new THREE.CylinderGeometry(0.12, 0.12, 12, 8), poleMat, home.x + Math.sin(th) * FENCE, Y + 6, home.z + Math.cos(th) * FENCE);
  }
  // backstop
  const fence = new THREE.MeshStandardMaterial({ color: 0x8899aa, wireframe: true });
  solid(world, new THREE.BoxGeometry(10, 5, 0.2, 10, 5, 1), fence, home.x, Y + 2.5, home.z - 6, 0);
  bleachers(world, home.x - 14, home.z - 6, 14, -Math.PI / 4 + Math.PI, 0xff3d3d, 5);
  bleachers(world, home.x + 14, home.z - 6, 14, Math.PI / 4 + Math.PI, 0xff3d3d, 5);
  world.minigames.push({ type: 'homerun', name: 'Home Run Derby', x: home.x, z: home.z + 0.8, r: 4, home, mound, wallDist: FENCE, wallH: FENCE_H, y: Y });
  world.lootSpots.push({ x: p.x, y: Y + 0.2, z: p.z + 5, kind: 'chest', poi: p.name });
  world.lootSpots.push({ x: home.x + 4, y: Y + 0.2, z: home.z + 2, kind: 'floor', poi: p.name });
}
