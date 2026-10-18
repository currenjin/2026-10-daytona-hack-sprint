import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = { S0: 0x26e0c6, S1: 0xe9f3f2, S2: 0x7b74ff };
const CSS_COLORS = { S0: '#26e0c6', S1: '#e9f3f2', S2: '#7b74ff' };
const LABELS = { S0: '신고 시점', S1: '신고 기준 1 km 반경', S2: '늦게 빠진 경우 (12:30)' };
const R = 6371000, LAT0 = 35.1, LON0 = 129.3, COS = Math.cos(LAT0 * Math.PI / 180);
const toX = lon => (lon - LON0) * Math.PI / 180 * R * COS / 1000;   // km east
const toZ = lat => -(lat - LAT0) * Math.PI / 180 * R / 1000;        // km, -north
const EXAG = 4;                                                      // terrain height exaggeration
const $ = s => document.querySelector(s);

const INC = { A: { lat: 35.1, lon: 129.3 }, B: { lat: 35.0, lon: 129.2 }, C: { lat: 35.2, lon: 129.3 } };
const off = { x: 0, z: 0 };
const state = { incident: 'A', results: {}, rows: {}, focus: null, frame: 0, playing: false, evalIdx: 0, config: null, executor: 'local', source: 'cache', view: '3d' };

// ---------- three.js scene ----------
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x05080a);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const fog3d = new THREE.Fog(0x05080a, 200, 1400); scene.fog = fog3d;
const persp = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 3000);
persp.position.set(-6, 24, 18);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
ortho.position.set(2.2, 60, 0.4); ortho.up.set(0, 0, -1);
let camera = persp;
const controls = new OrbitControls(persp, renderer.domElement);
const CAM = (new URLSearchParams(location.search).get('cam') || '').split(',').map(Number);
controls.target.set(2.2, 0, -2.2);
if (CAM.length === 6) { persp.position.set(CAM[0], CAM[1], CAM[2]); controls.target.set(CAM[3], 0, CAM[4]); } controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 4; controls.maxDistance = 900;
scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x05080a, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(-20, 30, 10); scene.add(sun);

// sea
const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x07161a, roughness: 0.6, metalness: 0.2 }));
sea.rotation.x = -Math.PI / 2; sea.position.y = -0.02; scene.add(sea);
const grid = new THREE.GridHelper(40, 40, 0x123236, 0x0d2427); grid.position.y = 0.002; scene.add(grid);

// domain box (34.9–35.3, 129.0–129.4)
{
  const pts = [[129.0, 34.9], [129.4, 34.9], [129.4, 35.3], [129.0, 35.3], [129.0, 34.9]].map(([lo, la]) => new THREE.Vector3(toX(lo), 0.01, toZ(la)));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xb08a3e, dashSize: 0.5, gapSize: 0.35 }));
  line.computeLineDistances(); scene.add(line);
}

// terrain from Copernicus DEM heightmap
async function loadTerrain() {
  const meta = await (await fetch('assets/terrain.json')).json();
  $('#dem-attr').textContent = meta.attribution;
  const img = new Image(); img.src = 'assets/terrain.png'; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const [lo0, la0, lo1, la1] = meta.bbox_lon_lat;
  const w = toX(lo1) - toX(lo0), h = toZ(la0) - toZ(la1);
  const seg = 255;
  const geo = new THREE.PlaneGeometry(w, h, seg, seg); geo.rotateX(-Math.PI / 2);
  geo.translate((toX(lo0) + toX(lo1)) / 2, 0, (toZ(la0) + toZ(la1)) / 2);
  const pos = geo.attributes.position, colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const gx = i % (seg + 1), gy = Math.floor(i / (seg + 1));
    const ix = Math.round(gx / seg * (img.width - 1)), iy = Math.round(gy / seg * (img.height - 1));
    const o = (iy * img.width + ix) * 4, m = px[o] * 256 + px[o + 1], land = px[o + 2] > 0;
    pos.setY(i, land ? 0.05 + m / 1000 * EXAG : -0.3);
    c.setHSL(land ? 0.25 : 0.55, land ? 0.18 : 0.3, land ? 0.16 + Math.min(m / 700, 1) * 0.22 : 0.03); colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false })));
}

// whole-country land outline under the detailed Busan terrain
async function loadKorea() {
  const k = await (await fetch('assets/korea.json')).json();
  const mat = new THREE.MeshBasicMaterial({ color: 0x33443b, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const edge = new THREE.LineBasicMaterial({ color: 0x4e6b60 });
  for (const ring of k.polygons) {
    const shape = new THREE.Shape(ring.map(([lo, la]) => new THREE.Vector2(toX(lo), -toZ(la))));
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); m.position.y = 0.004; scene.add(m);
    const pts = ring.map(([lo, la]) => new THREE.Vector3(toX(lo), 0.0, toZ(la)));
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edge); ln.position.y = 0.006; scene.add(ln);
  }
}

// incident pin
const pin = new THREE.Group();
{
  const mat = new THREE.MeshBasicMaterial({ color: 0x26e0c6 });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 20), mat); cone.rotation.x = Math.PI; cone.position.y = 0.75;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 16), mat); ball.position.y = 1.25;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.52, 48), new THREE.MeshBasicMaterial({ color: 0x26e0c6, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.name = 'ring';
  pin.add(cone, ball, ring); scene.add(pin);
}

// particles
function dotTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv);
}
const tex = dotTexture();
const clouds = {};
for (const sid of ['S0', 'S1', 'S2']) {
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(2000 * 3), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: COLORS[sid], size: sid === 'S1' ? 0.3 : 0.34, map: tex, transparent: true, depthWrite: false, blending: THREE.NormalBlending, opacity: sid === 'S1' ? 0.35 : 0.8 }));
  pts.visible = false; pts.frustumCulled = false; scene.add(pts); clouds[sid] = pts;
}

const exitGeo = new THREE.BufferGeometry(); exitGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6000 * 3), 3));
const exits = new THREE.Points(exitGeo, new THREE.PointsMaterial({ color: 0xf2b84b, size: 0.32, map: tex, transparent: true, opacity: 0.85, depthWrite: false }));
exits.frustumCulled = false; scene.add(exits);

// top 1 km cell per scenario, centroid trails, place labels
const cellBoxes = {}, trails = {}, centroids = {};
for (const sid of ['S0', 'S1', 'S2']) {
  const sq = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => new THREE.Vector3(a, 0, -b))),
    new THREE.LineBasicMaterial({ color: COLORS[sid], transparent: true, opacity: 1 }));
  sq.position.y = 0.08 + { S0: 0.02, S1: 0.01, S2: 0.03 }[sid]; sq.visible = false; scene.add(sq); cellBoxes[sid] = sq;
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: COLORS[sid], transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  fill.rotation.x = -Math.PI / 2; fill.position.set(0.5, -0.02, -0.5); sq.add(fill);
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(37 * 3), 3));
  const tl = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: COLORS[sid], transparent: true, opacity: 0.9 }));
  tl.visible = false; tl.frustumCulled = false; scene.add(tl); trails[sid] = tl;
}
function computeCentroids(sid) {
  const r = state.results[sid]; if (!r?.frames) return;
  const pts = r.frames.map(F => {
    let sx = 0, sy = 0, n = 0;
    for (let k = 0; k < 2000; k++) if (F.s[k] === 'A') { sx += F.xy[2 * k]; sy += F.xy[2 * k + 1]; n++; }
    return n ? [sx / n / 1000, sy / n / 1000] : null;
  });
  centroids[sid] = pts;
  const arr = trails[sid].geometry.attributes.position.array; let last = [0, 0];
  pts.forEach((p, i) => { if (p) last = p; arr[i * 3] = last[0]; arr[i * 3 + 1] = 0.1; arr[i * 3 + 2] = -last[1]; });
  trails[sid].geometry.attributes.position.needsUpdate = true;
}
const PLACES = [['해운대', 35.1587, 129.1604], ['광안리', 35.1532, 129.1186], ['오륙도', 35.0917, 129.1278], ['기장', 35.2445, 129.2222], ['사고 지점', 35.1, 129.3075], ['시연 해역 경계 · 밖은 미확인', 35.22, 129.4]];
const labelLayer = document.createElement('div'); labelLayer.className = 'labels'; document.body.appendChild(labelLayer);
const placeEls = PLACES.map(([n]) => { const e = document.createElement('span'); e.textContent = n; labelLayer.appendChild(e); return e; });

const _v = new THREE.Vector3();
function placeLabels() {
  PLACES.forEach(([, la, lo], i) => {
    _v.set(toX(lo), 0.4, toZ(la)).project(camera);
    const e = placeEls[i], vis = _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05;
    e.style.display = vis ? '' : 'none';
    if (vis) e.style.transform = `translate(${(_v.x + 1) / 2 * innerWidth}px,${(1 - _v.y) / 2 * innerHeight}px) translate(0,-50%)`;
  });
}
function applyFocus() {
  for (const sid of ['S0', 'S1', 'S2']) {
    const on = !state.focus || state.focus === sid;
    clouds[sid].material.opacity = on ? (sid === 'S1' ? 0.45 : 0.85) : 0.06;
    cellBoxes[sid].material.opacity = on ? 1 : 0.15; cellBoxes[sid].children[0].material.opacity = on ? 0.16 : 0.02;
    trails[sid].material.opacity = on ? 0.9 : 0.12;
  }
}
function updateCells() {
  for (const sid of ['S0', 'S1', 'S2']) {
    const e = state.results[sid]?.evaluations?.[state.evalIdx];
    const box = cellBoxes[sid];
    if (!e || !e.top_cell || e.state_counts.ACTIVE === 0) { box.visible = false; continue; }
    const [i, j] = e.top_cell.split(',').map(Number);
    box.position.x = i + off.x; box.position.z = -j + off.z; box.visible = true;
  }
}

// particle density per 1 km cell (same floor rule as the table)
const HEAT_N = 400, heatMat = [], heat = new THREE.Group(); scene.add(heat);
const heatGeo = new THREE.PlaneGeometry(0.96, 0.96); heatGeo.rotateX(-Math.PI / 2);
for (let i = 0; i < HEAT_N; i++) {
  const m = new THREE.Mesh(heatGeo, new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
  m.visible = false; m.frustumCulled = false; m.renderOrder = 5; heat.add(m); heatMat.push(m);
}
function updateHeat(fi) {
  const counts = new Map(); let total = 0;
  for (const sid of ['S0', 'S1', 'S2']) {
    const r = state.results[sid]; if (!r?.frames) continue;
    if (state.focus && state.focus !== sid) continue;
    const F = r.frames[fi];
    for (let k = 0; k < 2000; k++) if (F.s[k] === 'A') {
      const key = Math.floor(F.xy[2 * k] / 1000) + ',' + Math.floor(F.xy[2 * k + 1] / 1000);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    total += 2000;
  }
  let i = 0; const max = Math.max(1, ...counts.values());
  for (const [key, c] of counts) {
    if (i >= HEAT_N) break;
    const [cx, cy] = key.split(',').map(Number), m = heatMat[i++];
    const t = c / max;
    m.position.set(cx + 0.5, 0.03, -(cy + 0.5)); m.visible = t > 0.02;
    m.material.opacity = 0.18 + 0.62 * t; m.material.color.setHSL(0.08 - 0.08 * t, 1, 0.55);
  }
  for (; i < HEAT_N; i++) heatMat[i].visible = false;
}

function setFrame(f) {
  state.frame = f;
  const i0 = Math.floor(f), i1 = Math.min(i0 + 1, 36), a = f - i0;
  for (const [sid, pts] of Object.entries(clouds)) {
    const r = state.results[sid];
    if (!r || !r.frames) { pts.visible = false; continue; }
    const A = r.frames[i0], B = r.frames[i1], arr = pts.geometry.attributes.position.array;
    for (let k = 0; k < 2000; k++) {
      const sa = A.s[k], sb = B.s[k];
      if (sa !== 'A' && sb !== 'A') { arr[k * 3 + 1] = -50; continue; }
      const x = sa === 'A' && sb === 'A' ? A.xy[2 * k] + (B.xy[2 * k] - A.xy[2 * k]) * a : (sb === 'A' ? B.xy[2 * k] : A.xy[2 * k]);
      const y = sa === 'A' && sb === 'A' ? A.xy[2 * k + 1] + (B.xy[2 * k + 1] - A.xy[2 * k + 1]) * a : (sb === 'A' ? B.xy[2 * k + 1] : A.xy[2 * k + 1]);
      arr[k * 3] = x / 1000; arr[k * 3 + 1] = 0.05; arr[k * 3 + 2] = -y / 1000;
    }
    pts.geometry.attributes.position.needsUpdate = true; pts.visible = true;
  }
  const ea = exitGeo.attributes.position.array; let n = 0;
  for (const sid of ['S0', 'S1', 'S2']) {
    const r = state.results[sid]; if (!r || !r.frames) continue;
    const F = r.frames[Math.round(f)];
    for (let k = 0; k < 2000; k++) if (F.s[k] === 'O') { ea[n * 3] = F.xy[2 * k] / 1000; ea[n * 3 + 1] = 0.05; ea[n * 3 + 2] = -F.xy[2 * k + 1] / 1000; n++; }
  }
  for (let k = n; k < 6000; k++) ea[k * 3 + 1] = -50;
  exitGeo.attributes.position.needsUpdate = true;
  for (const sid of ['S0', 'S1', 'S2']) {
    const tl = trails[sid]; tl.visible = !!centroids[sid];
    if (tl.visible) tl.geometry.setDrawRange(0, Math.floor(f) + 1);
  }
  updateHeat(Math.round(f));
  const mins = Math.round(f * 10), hh = 12 + Math.floor(mins / 60), mm = mins % 60;
  $('#clock').textContent = `${hh}:${String(mm).padStart(2, '0')}`;
  $('#scrub').value = Math.round(f);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  persp.aspect = innerWidth / innerHeight;
  // lift the scene so the drift sits above the result card
  // keep the drift in the open area left of the side panels
  const shiftX = 0;
  persp.setViewOffset(innerWidth, innerHeight, shiftX, 0, innerWidth, innerHeight); persp.updateProjectionMatrix();
  const half = 7.3, asp = innerWidth / innerHeight;
  const sh = 0;
  Object.assign(ortho, { left: -half * asp, right: half * asp, top: half + sh, bottom: -half + sh }); ortho.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

let last = performance.now();
const follow = new THREE.Vector3(2.2, 0, -2.2), _d = new THREE.Vector3();
let camMode = 'follow';
function followTarget(f) {
  let sx = 0, sz = 0, n = 0;
  for (const sid of ['S0', 'S1', 'S2']) {
    const r = state.results[sid]; if (!r?.frames) continue;
    if (state.focus && state.focus !== sid) continue;
    const F = r.frames[Math.round(f)];
    for (let k = 0; k < 2000; k += 10) if (F.s[k] === 'A' || F.s[k] === 'O') { sx += F.xy[2 * k]; sz += F.xy[2 * k + 1]; n++; }
  }
  if (!n) return;
  // keep the incident pin in view while the cloud is near it
  const cx = sx / n / 1000, cy = sz / n / 1000;
  follow.set(cx + off.x, 0, -cy + 0.3 + off.z);
}
function tick(now) {
  const dt = (now - last) / 1000; last = now;
  if (state.playing) {
    let f = state.frame + dt * 4;            // 4 frames (40 min) per second
    if (f >= 36) { f = 36; state.playing = false; $('#play').textContent = '▶'; }
    setFrame(f);
  }
  const ring = pin.getObjectByName('ring'); const s = 1 + (now / 1000 % 1.6) * 0.8; ring.scale.set(s, s, s); ring.material.opacity = 0.6 * (1 - (now / 1000 % 1.6) / 1.6);
  if (Object.keys(state.results).length) {
    if (camMode === 'follow') followTarget(state.frame); else follow.set(off.x, 0, off.z + 0.3);
    _d.copy(follow).sub(controls.target).multiplyScalar(0.12);
    controls.target.add(_d); persp.position.add(_d);
    ortho.position.x += (follow.x - ortho.position.x) * 0.12; ortho.position.z += (follow.z + 2.6 - ortho.position.z) * 0.12;
  }
  controls.update(); renderer.render(scene, camera); placeLabels();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- controls ----------
$('#play').onclick = () => {
  camMode = 'follow';
  if (state.frame >= 36) setFrame(0);
  state.playing = !state.playing; $('#play').textContent = state.playing ? '❚❚' : '▶';
};
$('#scrub').oninput = e => { state.playing = false; $('#play').textContent = '▶'; setFrame(+e.target.value); };
document.querySelectorAll('#viewseg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#viewseg button').forEach(x => x.classList.toggle('on', x === b));
  state.view = b.dataset.v; camera = state.view === '3d' ? persp : ortho; controls.enabled = state.view === '3d';
  scene.fog = state.view === '3d' ? fog3d : null;
  if (state.view === '2d') ortho.lookAt(2.2, 0, 0.4);
});
document.querySelectorAll('#evalseg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#evalseg button').forEach(x => x.classList.toggle('on', x === b));
  state.evalIdx = +b.dataset.i; state.playing = false; $('#play').textContent = '▶';
  setFrame([6, 18, 36][state.evalIdx]); renderCard();
});
$('#infobtn').onclick = () => $('#limitsDlg').showModal();
// click the incident pin to fly there; click the particles or density cells to follow the estimate
const ray = new THREE.Raycaster(); ray.params.Points.threshold = 0.4; let downAt = null;
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  if (ray.intersectObject(pin, true).length) { camMode = 'incident'; return; }
  const hits = ray.intersectObjects([...Object.values(clouds).filter(c => c.visible), ...heatMat.filter(m => m.visible), exits], false);
  if (hits.length) camMode = 'follow';
});
const cellCenter = key => {
  const [i, j] = key.split(',').map(Number);
  const c = INC[state.incident], cs = Math.cos(c.lat * Math.PI / 180);
  const lat = c.lat + (j + 0.5) * 1000 / R * 180 / Math.PI, lon = c.lon + (i + 0.5) * 1000 / (R * cs) * 180 / Math.PI;
  return `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E`;
};
function shareText() {
  const at = ['13:00', '15:00', '18:00'], L = [];
  L.push('[Golden Sea 상황 공유 · 시연용 가상 사고]');
  const rr = REPORTS.find(x => x.inc === state.incident);
  L.push(`신고 ${rr.when} · ${rr.what} · ${rr.pos} (${rr.ref}) · ${rr.time} 추정`);
  L.push('');
  for (let ei = 0; ei < 3; ei++) {
    L.push(`${at[ei]} KST 표류 경로 경우의 수가 가장 많이 모인 1 km 칸`);
    for (const sid of ['S0', 'S1', 'S2']) {
      const e = state.results[sid]?.evaluations?.[ei];
      if (!e) { L.push(`  ${LABELS[sid]}: 결과 없음`); continue; }
      L.push(e.state_counts.ACTIVE === 0 ? `  ${LABELS[sid]}: 모든 경로 해역 밖 · 미확인` : `  ${LABELS[sid]}: ${cellCenter(e.top_cell)} 중심 · ${(e.top_cell_fraction * 100).toFixed(1)}%`);
    }
  }
  L.push('');
  L.push('비율은 표류 경로 경우의 수 2,000가지 중 몫이며 발견·생존 확률이 아닙니다. 공식 수색 지시가 아니며 판단은 상황실이 합니다.');
  L.push('해류: 저장된 Open-Meteo 예보 · 계산: ' + (Object.values(state.results)[0]?.executor === 'daytona' ? 'Daytona sandbox' : '로컬'));
  return L.join('\n');
}
$('#sharebtn').onclick = () => { $('#sharetext').value = shareText(); $('#shareDlg').showModal(); };
$('#sharecopy').onclick = async () => { try { await navigator.clipboard.writeText($('#sharetext').value); $('#sharecopy').textContent = '복사됨'; } catch { $('#sharetext').select(); } setTimeout(() => $('#sharecopy').textContent = '복사', 1500); };

// ---------- data ----------
const pct = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

function renderCard() {
  const evAt = ['13:00', '15:00', '18:00'][state.evalIdx];
  const any = Object.values(state.results).find(r => r.evaluations);
  const where = any ? (any.executor === 'daytona' ? 'Daytona sandbox 실행' : '로컬 실행 (스폰서 실행 아님)') : '';
  $('#cardsub').textContent = any ? `${evAt} KST` : '';
  $('#kpis').innerHTML = ['S0', 'S1', 'S2'].map(sid => {
    const r = state.results[sid]; const e = r?.evaluations?.[state.evalIdx];
    const allOut = e && e.state_counts.ACTIVE === 0;
    const val = e ? (allOut ? '—' : pct(e.top_cell_fraction)) : '—';
    const c = e?.state_counts || {}, n = e?.n || 2000;
    const why = c.OUT_OF_DOMAIN === n ? '모두 해역 밖' : c.DATA_MISSING === n ? '모두 데이터 없음' : '계산 중인 경로 없음';
    const st = r && !r.evaluations ? `<span class="st">${r.status}</span>` : (allOut ? `<span class="st">${why} · 미확인 ${pct(e.unresolved_fraction)}</span>` : '');
    const cnt = e && !allOut ? `<span class="cnt">${Math.round(e.top_cell_fraction * n).toLocaleString()} / ${n.toLocaleString()}가지</span><span class="bar"><span style="width:${e.top_cell_fraction * 100}%;background:${CSS_COLORS[sid]}"></span></span>` : '';
    const cls = state.focus === sid ? ' on' : (state.focus ? ' dim' : '');
    return `<div class="k${cls}" data-sid="${sid}" role="button" tabindex="0" title="이 시나리오만 지도에서 보기"><span class="lab"><i style="background:${CSS_COLORS[sid]}"></i>${LABELS[sid]}</span><b>${r && !r.evaluations ? '—' : val}</b>${cnt}${st}</div>`;
  }).join('');
  const ev = ['S0', 'S1', 'S2'].map(sid => state.results[sid]?.evaluations?.[state.evalIdx]);
  let ins = '';
  if (ev.every(Boolean)) {
    if (ev.every(e => e.state_counts.ACTIVE === 0)) ins = '모든 입자가 해역 밖 · 미확인으로 남깁니다';
    else {
      const [a, b, c] = ev.map(e => e.top_cell_fraction * 100);
      const same = new Set(ev.map(e => e.top_cell)).size === 1;
      ins = `가정 하나에 ${a.toFixed(0)}% → ${b.toFixed(0)}%${same ? '' : ' · 최다 칸도 달라짐'}`;
    }
  }
  document.querySelectorAll('#kpis .k').forEach(k => k.onclick = () => {
    state.focus = state.focus === k.dataset.sid ? null : k.dataset.sid; applyFocus(); renderCard(); updateHeat(Math.round(state.frame));
  });
  updateCells();
  $('#unres').textContent = ['S0', 'S1', 'S2'].map(sid => {
    const e = state.results[sid]?.evaluations?.[state.evalIdx];
    return e ? `${LABELS[sid]} ${e.unresolved_count}/${e.n}` : `${LABELS[sid]} —`;
  }).join(' · ');
  const rows = ['S0', 'S1', 'S2'].map(sid => {
    const r = state.results[sid]; const e = r?.evaluations?.[state.evalIdx]; const sc = r?.scenario || {};
    const n = e?.n || 2000, sc_ = e?.state_counts || {};
    return `<tr><td>${LABELS[sid]}</td><td>${sc.changed ?? '—'}</td><td>${e ? `${e.top_cell} · ${pct(e.top_cell_fraction)}` : '—'}</td><td>${e ? pct((sc_.OUT_OF_DOMAIN || 0) / n) : '—'}</td><td>${e ? pct((sc_.DATA_MISSING || 0) / n) : '—'}</td><td>${e ? pct((sc_.UNRELEASED || 0) / n) : '—'}</td><td>미검증</td></tr>`;
  }).join('');
  $('#detail').innerHTML = `<thead><tr><th>시나리오</th><th>바꾼 가정</th><th>가장 많은 칸 (1 km)</th><th>해역 밖</th><th>데이터 없음</th><th>미투입</th><th>좌초</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderRows(batch) {
  for (const [sid, it] of Object.entries(batch?.items || {})) state.rows[sid] = { it, r: batch.results?.[sid] };
  $('#runrows').innerHTML = ['S0', 'S1', 'S2'].map(sid => {
    const it = state.rows[sid]?.it; const r = state.rows[sid]?.r;
    let ph = '대기', cls = '';
    if (it) {
      ph = { queued: '대기', creating_sandbox: 'sandbox 생성 중', uploading: '올리는 중', running: '계산 중', downloading: '받는 중', deleting: '지우는 중', done: '' }[it.phase] ?? it.phase;
      if (it.phase === 'done') {
        const ok = /^OK/.test(it.status); cls = ok ? 'ok' : (it.status === 'SETUP_BLOCKED' ? 'warn' : 'err');
        ph = ok ? `완료 ${it.wall_s}s` : it.status;
      }
    }
    const sbid = r?.sandbox_id || it?.info?.sandbox_id;
    const isDt = (r?.executor || state.executor) === 'daytona';
    const where = r ? (r.executor === 'daytona' ? `Daytona sandbox ${String(r.sandbox_id || '').slice(0, 8)}` : '로컬 실행 (스폰서 실행 아님)') : (sbid ? `Daytona sandbox ${String(sbid).slice(0, 8)}` : '');
    const tfull = r?.executor_timings_s ? Object.entries(r.executor_timings_s).map(([k, v]) => `${k.replace('_s', '')} ${v}s`).join(' · ') : (r?.timings_s ? `계산 ${r.timings_s.compute}s` : '');
    const t = '';
    const order = ['creating_sandbox', 'uploading', 'running', 'downloading', 'deleting'];
    const names = ['생성', '업로드', '계산', '다운로드', '삭제'];
    const cur = it ? (it.phase === 'done' ? 5 : order.indexOf(it.phase)) : -1;
    const stages = isDt && it ? `<span class="stages" title="${tfull}">${names.map((nm, i) => `<span class="${i < cur ? 'f' : i === cur ? 'c' : ''}">${nm}</span>`).join('')}</span>` : '';
    const retry = r && !/^OK/.test(r.status) && r.status !== 'SETUP_BLOCKED' ? ` <button class="btn" data-retry="${sid}">다시</button>` : '';
    return `<li><span class="d" style="background:${CSS_COLORS[sid]}"></span><span>${LABELS[sid]}</span><span class="ph ${cls}">${ph}${retry}</span>${stages}${where ? `<span class="sb" title="${r?.sandbox_id || ''} ${tfull}">${where}</span>` : ''}</li>`;
  }).join('');
  document.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => run([b.dataset.retry]));
  const rs = Object.values(state.rows).map(x => x.r).filter(Boolean);
  const ex = [...new Set(rs.map(r => r.executor === 'daytona' ? 'Daytona sandbox' : '로컬 실행 (스폰서 실행 아님)'))].join(' + ');
  $('#src-label').textContent = (state.source === 'cache' ? '저장된 예보' : '합성 흐름 (UI 개발용)') + (ex ? ` · ${ex}` : '');
}

function banner(text, kind) {
  const b = $('#banner'); if (!text) { b.hidden = true; return; }
  b.hidden = false; b.className = 'banner' + (kind === 'warn' ? ' warn' : ''); b.textContent = text;
}

async function run(scenarios = ['S0', 'S1', 'S2']) {
  $('#runbtn').disabled = true; $('#runpanel').classList.add('busy');
  $('#intro').classList.add('running');
  $('#intro-run').textContent = state.executor === 'daytona' ? 'Daytona sandbox 3개 동시 계산 중…' : '로컬 계산 중… (스폰서 실행 아님)';
  const res = await fetch('/api/run', { method: 'POST', body: JSON.stringify({ scenarios, executor: state.executor, source: state.source, incident: state.incident }) });
  const j = await res.json();
  if (!j.batch_id) { $('#runpanel').classList.remove('busy'); $('#intro').classList.remove('running'); banner(`${j.status === 'INPUT_ERROR' ? '입력 오류 · 새 계산을 만들지 않았습니다' : j.status}: ${j.error}`); $('#runbtn').disabled = false; return; }
  banner(null);
  for (const s of scenarios) delete state.results[s];
  renderCard();
  let batch;
  do {
    await new Promise(r => setTimeout(r, 400));
    batch = await (await fetch(`/api/batch/${j.batch_id}`)).json();
    renderRows(batch);
  } while (Object.values(batch.items).some(it => it.phase !== 'done'));
  Object.assign(state.results, batch.results);
  for (const sid of Object.keys(batch.results)) computeCentroids(sid);
  applyFocus();
  $('#runpanel').classList.remove('busy'); $('#intro').hidden = true; document.body.classList.add('started');
  renderCard(); setFrame(0); state.playing = true; $('#play').textContent = '❚❚';
  const prov = Object.values(batch.results).find(r => r.provenance)?.provenance?.current;
  if (prov) $('#prov').innerHTML = [
    `해류 출처: ${prov.provider} (${prov.file})`,
    `요청 위치 ${prov.requested_point.join(', ')} → 반환 위치 ${prov.returned_point.join(', ')} · 약 ${(prov.separation_m / 1000).toFixed(1)} km 차이`,
    `예보 기간 ${prov.time_span.join(' ~ ')} (Asia/Seoul) · 단위 ${Object.entries(prov.units).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `수신 시각 미확인 (${prov.received_at_label}) · 발표 시각 미확인 (${prov.publication_time_label}) · 탐침 시작 ${prov.probe_start}`,
    `sha256 ${prov.sha256}`,
    `요청 URL <a href="${prov.request_url}" target="_blank" rel="noopener">${prov.request_url.replace(/</g, '&lt;')}</a>`,
  ].map(x => `<div>${x}</div>`).join('');
  const dl = $('#dl'); dl.hidden = false; $('#sharebtn').hidden = false;
  dl.onclick = ev => {
    ev.preventDefault();
    const blob = new Blob([JSON.stringify({ golden_sea_export: 1, disclosures: state.config?.disclosures, results: state.results }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'golden-sea-results.json'; a.click();
  };
  $('#runbtn').disabled = false;
  if (state.config?.briefing?.available && Object.values(batch.results).some(r => r.evaluations)) {
    const bx = $('#brief'); bx.hidden = false; bx.innerHTML = '<em>Nosana 요약 생성 중…</em>';
    const br = await (await fetch(`/api/brief/${j.batch_id}`, { method: 'POST' })).json();
    bx.innerHTML = br.status === 'OK' ? `<em>${br.label} · ${br.model} · ${br.latency_s}s</em>${br.text.replace(/</g, '&lt;')}` : `<em>Nosana 요약 실패 · ${br.status}</em>`;
  }
}
$('#runbtn').onclick = () => run();
$('#intro-run').onclick = () => run();
const REPORTS = [
  { inc: 'A', when: '12:16', who: '선장 · 무선', what: '낚싯배 승선자 1명이 바다에 빠짐', pos: '35.1000° N, 129.3000° E', ref: '해운대 남동쪽 약 14 km', time: '12:00 ~ 12:15', err: '반경 250 m' },
  { inc: 'B', when: '12:18', who: '선원 · 휴대폰 122', what: '화물선 선원 1명이 갑판에서 보이지 않음', pos: '35.0000° N, 129.2000° E', ref: '오륙도 남남동쪽 약 12 km', time: '12:00 ~ 12:15', err: '반경 250 m' },
  { inc: 'C', when: '12:20', who: '레저보트 · 무선', what: '레저보트 동승자 1명이 파도에 휩쓸림', pos: '35.2000° N, 129.3000° E', ref: '기장 남동쪽 약 9 km', time: '12:00 ~ 12:15', err: '반경 250 m' },
];
let rIdx = 0;
function setIncident(id) {
  state.incident = id; const c = INC[id];
  off.x = toX(c.lon); off.z = toZ(c.lat);
  pin.position.set(off.x, 0, off.z);
  PLACES[4][1] = c.lat; PLACES[4][2] = c.lon + 0.0075;
  for (const o of [...Object.values(clouds), exits, heat, ...Object.values(trails)]) o.position.set(off.x, 0, off.z);
  state.results = {}; state.rows = {}; state.focus = null;
  for (const sid of ['S0', 'S1', 'S2']) { cellBoxes[sid].visible = false; delete centroids[sid]; }
  follow.set(off.x + 1.5, 0, off.z - 1.5);
  renderRows(null); renderCard(); setFrame(0);
}
$('#intro-fill').onclick = async () => {
  const r = REPORTS[rIdx % REPORTS.length], btn = $('#intro-fill');
  btn.disabled = true; setIncident(r.inc);
  $('#r-tag').textContent = `가상 신고 · ${r.when} 접수`;
  $('#cur-what').textContent = `${r.when} · ${r.what}`;
  $('#cur-meta').textContent = `${r.ref} · ${r.time}`;
  for (const [sel, val] of [['#f-when', r.when], ['#f-who', r.who], ['#f-what', r.what], ['#f-pos', `${r.pos} (${r.ref})`], ['#f-err', r.err], ['#f-time', r.time]]) {
    const el = $(sel); el.classList.remove('filled');
    for (let i = 1; i <= val.length; i++) { el.value = val.slice(0, i); await new Promise(res => setTimeout(res, 12)); }
    el.classList.add('filled');
  }
  $('#unverified').hidden = r.inc === 'A';
  rIdx++;
  $('#intro-run').disabled = false; btn.disabled = false;
};
$('#newreport').onclick = () => { $('#intro').hidden = false; $('#intro').classList.remove('running'); document.body.classList.remove('started'); $('#intro-run').textContent = '추정 위치 계산'; $('#intro-fill').click(); };
$('#executor').onchange = e => { state.executor = e.target.value; note(); };
function note() {
  const dt = state.config?.executors?.daytona;
  $('#rp-note').textContent = state.executor === 'daytona' ? '시나리오마다 sandbox 하나에서 동시에 계산합니다.'
    : (dt?.available ? '이 컴퓨터에서 계산합니다. 스폰서 실행이 아닙니다.' : `Daytona 미연결: ${dt?.reason}`);
}

async function init() {
  await loadTerrain(); loadKorea();
  const cfg = await (await fetch('/api/config')).json(); state.config = cfg;
  if (cfg.disclosures) $('#disc').innerHTML = cfg.disclosures.map(d => `<li>${d.ko}</li>`).join('');
  const dt = cfg.executors.daytona;
  $('#executor').innerHTML = `<option value="local">로컬 실행</option><option value="daytona" ${dt.available ? '' : 'disabled'}>Daytona sandbox${dt.available ? '' : ' (키 필요)'}</option>`;
  if (dt.available) { state.executor = 'daytona'; $('#executor').value = 'daytona'; }
  const cacheOk = Object.values(cfg.cache).every(c => c.status === 'OK');
  const forced = new URLSearchParams(location.search).get('source');
  state.source = forced === 'synthetic' || !cacheOk ? 'synthetic' : 'cache';
  $('#src-label').textContent = state.source === 'cache' ? '저장된 예보' : '합성 흐름 (UI 개발용)';
  if (!cacheOk) banner('저장된 예보 파일이 없거나 해시가 다릅니다 (SETUP_BLOCKED). 지금은 UI 개발용 합성 흐름으로만 보여 줍니다. 예보가 아닙니다.', 'warn');
  note();
  $('#intro-run').textContent = '추정 위치 계산';
  renderRows(null); renderCard(); setFrame(0);
}
init();
