import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = { S0: 0x26e0c6, S1: 0xe9f3f2, S2: 0x7b74ff };
const CSS_COLORS = { S0: '#26e0c6', S1: '#e9f3f2', S2: '#7b74ff' };
const LABELS = { S0: 'S0 기준안', S1: 'S1 반경 1 km', S2: 'S2 투입 ~12:30' };
const R = 6371000, LAT0 = 35.1, LON0 = 129.3, COS = Math.cos(LAT0 * Math.PI / 180);
const toX = lon => (lon - LON0) * Math.PI / 180 * R * COS / 1000;   // km east
const toZ = lat => -(lat - LAT0) * Math.PI / 180 * R / 1000;        // km, -north
const EXAG = 4;                                                      // terrain height exaggeration
const $ = s => document.querySelector(s);

const state = { results: {}, frame: 0, playing: false, evalIdx: 0, config: null, executor: 'local', source: 'cache', view: '3d' };

// ---------- three.js scene ----------
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x05080a);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const fog3d = new THREE.Fog(0x05080a, 40, 90); scene.fog = fog3d;
const persp = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 400);
persp.position.set(-2, 20, 20);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
ortho.position.set(4, 60, -6); ortho.up.set(0, 0, -1);
let camera = persp;
const controls = new OrbitControls(persp, renderer.domElement);
controls.target.set(4, 0, 4); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 6; controls.maxDistance = 70;
scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x05080a, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(-20, 30, 10); scene.add(sun);

// sea
const sea = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x07161a, roughness: 0.6, metalness: 0.2 }));
sea.rotation.x = -Math.PI / 2; scene.add(sea);
const grid = new THREE.GridHelper(80, 40, 0x0f2a2e, 0x0b1e21); grid.position.y = 0.002; scene.add(grid);

// domain box (34.9–35.3, 129.0–129.4)
{
  const pts = [[129.0, 34.9], [129.4, 34.9], [129.4, 35.3], [129.0, 35.3], [129.0, 34.9]].map(([lo, la]) => new THREE.Vector3(toX(lo), 0.01, toZ(la)));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x1d4c50, dashSize: 0.4, gapSize: 0.4 }));
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
    c.setHSL(0.48, 0.08, land ? 0.09 + Math.min(m / 700, 1) * 0.16 : 0.02); colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false })));
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
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: COLORS[sid], size: sid === 'S1' ? 0.22 : 0.26, map: tex, transparent: true, depthWrite: false, blending: THREE.NormalBlending, opacity: sid === 'S1' ? 0.35 : 0.8 }));
  pts.visible = false; scene.add(pts); clouds[sid] = pts;
}

const exitGeo = new THREE.BufferGeometry(); exitGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6000 * 3), 3));
const exits = new THREE.Points(exitGeo, new THREE.PointsMaterial({ color: 0xf2b84b, size: 0.14, map: tex, transparent: true, opacity: 0.55, depthWrite: false }));
scene.add(exits);

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
  const mins = Math.round(f * 10), hh = 12 + Math.floor(mins / 60), mm = mins % 60;
  $('#clock').textContent = `${hh}:${String(mm).padStart(2, '0')}`;
  $('#scrub').value = Math.round(f);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  persp.aspect = innerWidth / innerHeight; persp.updateProjectionMatrix();
  const half = 15, asp = innerWidth / innerHeight;
  Object.assign(ortho, { left: -half * asp, right: half * asp, top: half, bottom: -half }); ortho.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

let last = performance.now();
function tick(now) {
  const dt = (now - last) / 1000; last = now;
  if (state.playing) {
    let f = state.frame + dt * 4;            // 4 frames (40 min) per second
    if (f >= 36) { f = 36; state.playing = false; $('#play').textContent = '▶'; }
    setFrame(f);
  }
  const ring = pin.getObjectByName('ring'); const s = 1 + (now / 1000 % 1.6) * 0.8; ring.scale.set(s, s, s); ring.material.opacity = 0.6 * (1 - (now / 1000 % 1.6) / 1.6);
  controls.update(); renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- controls ----------
$('#play').onclick = () => {
  if (state.frame >= 36) setFrame(0);
  state.playing = !state.playing; $('#play').textContent = state.playing ? '❚❚' : '▶';
};
$('#scrub').oninput = e => { state.playing = false; $('#play').textContent = '▶'; setFrame(+e.target.value); };
document.querySelectorAll('#viewseg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#viewseg button').forEach(x => x.classList.toggle('on', x === b));
  state.view = b.dataset.v; camera = state.view === '3d' ? persp : ortho; controls.enabled = state.view === '3d';
  scene.fog = state.view === '3d' ? fog3d : null;
  if (state.view === '2d') ortho.lookAt(4, 0, -6);
});
document.querySelectorAll('#evalseg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#evalseg button').forEach(x => x.classList.toggle('on', x === b));
  state.evalIdx = +b.dataset.i; state.playing = false; $('#play').textContent = '▶';
  setFrame([6, 18, 36][state.evalIdx]); renderCard();
});
$('#infobtn').onclick = () => $('#limitsDlg').showModal();

// ---------- data ----------
const pct = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

function renderCard() {
  const evAt = ['13:00', '15:00', '18:00'][state.evalIdx];
  const any = Object.values(state.results).find(r => r.evaluations);
  $('#cardsub').textContent = any ? `${evAt} · 입자 2,000개 중 · ${any.input_label}` : '계산 전';
  $('#kpis').innerHTML = ['S0', 'S1', 'S2'].map(sid => {
    const r = state.results[sid]; const e = r?.evaluations?.[state.evalIdx];
    const allOut = e && e.state_counts.ACTIVE === 0;
    const val = e ? (allOut ? '—' : pct(e.top_cell_fraction)) : '—';
    const st = r && !r.evaluations ? `<span class="st">${r.status}</span>` : (allOut ? `<span class="st">모두 해역 밖 · 미확인 ${pct(e.unresolved_fraction)}</span>` : '');
    return `<div class="k"><span class="lab"><i style="background:${CSS_COLORS[sid]}"></i>${LABELS[sid]}</span><b>${r && !r.evaluations ? '—' : val}</b>${st}</div>`;
  }).join('');
  $('#unres').textContent = ['S0', 'S1', 'S2'].map(sid => `${sid} ${pct(state.results[sid]?.evaluations?.[state.evalIdx]?.unresolved_fraction)}`).join(' · ');
  const rows = ['S0', 'S1', 'S2'].map(sid => {
    const r = state.results[sid]; const e = r?.evaluations?.[state.evalIdx]; const sc = r?.scenario || {};
    const n = e?.n || 2000, sc_ = e?.state_counts || {};
    return `<tr><td>${sid}</td><td>${sc.changed ?? '—'}</td><td>${e ? `${e.top_cell} · ${pct(e.top_cell_fraction)}` : '—'}</td><td>${e ? pct((sc_.OUT_OF_DOMAIN || 0) / n) : '—'}</td><td>${e ? pct((sc_.DATA_MISSING || 0) / n) : '—'}</td><td>${e ? pct((sc_.UNRELEASED || 0) / n) : '—'}</td><td>미검증</td></tr>`;
  }).join('');
  $('#detail').innerHTML = `<thead><tr><th>시나리오</th><th>바꾼 가정</th><th>가장 많은 칸 (1 km)</th><th>해역 밖</th><th>데이터 없음</th><th>미투입</th><th>좌초</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderRows(batch) {
  const items = batch?.items || {};
  $('#runrows').innerHTML = ['S0', 'S1', 'S2'].map(sid => {
    const it = items[sid]; const r = batch?.results?.[sid];
    let ph = '대기', cls = '';
    if (it) {
      ph = { queued: '대기', creating_sandbox: 'sandbox 생성 중', uploading: '올리는 중', running: '계산 중', done: '' }[it.phase] ?? it.phase;
      if (it.phase === 'done') {
        const ok = /^OK/.test(it.status); cls = ok ? 'ok' : (it.status === 'SETUP_BLOCKED' ? 'warn' : 'err');
        ph = ok ? `완료 ${it.wall_s}s` : it.status;
      }
    }
    const where = r ? (r.executor === 'daytona' ? `Daytona · ${r.sandbox_id || ''}` : '로컬 실행 (스폰서 실행 아님)') : '';
    const t = r?.executor_timings_s ? Object.entries(r.executor_timings_s).map(([k, v]) => `${k.replace('_s', '')} ${v}`).join(' · ') : (r?.timings_s ? `계산 ${r.timings_s.compute}s` : '');
    const retry = r && !/^OK/.test(r.status) && r.status !== 'SETUP_BLOCKED' ? ` <button class="btn" data-retry="${sid}">다시</button>` : '';
    return `<li><span class="d" style="background:${CSS_COLORS[sid]}"></span><span>${LABELS[sid]}</span><span class="ph ${cls}">${ph}${retry}</span>${where ? `<span class="sb">${where}${t ? ' · ' + t : ''}</span>` : ''}</li>`;
  }).join('');
  document.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => run([b.dataset.retry]));
}

function banner(text, kind) {
  const b = $('#banner'); if (!text) { b.hidden = true; return; }
  b.hidden = false; b.className = 'banner' + (kind === 'warn' ? ' warn' : ''); b.textContent = text;
}

async function run(scenarios = ['S0', 'S1', 'S2']) {
  $('#runbtn').disabled = true;
  const res = await fetch('/api/run', { method: 'POST', body: JSON.stringify({ scenarios, executor: state.executor, source: state.source }) });
  const j = await res.json();
  if (!j.batch_id) { banner(`${j.status}: ${j.error}`); $('#runbtn').disabled = false; return; }
  for (const s of scenarios) delete state.results[s];
  renderCard();
  let batch;
  do {
    await new Promise(r => setTimeout(r, 400));
    batch = await (await fetch(`/api/batch/${j.batch_id}`)).json();
    renderRows(batch);
  } while (Object.values(batch.items).some(it => it.phase !== 'done'));
  Object.assign(state.results, batch.results);
  renderCard(); setFrame(0); state.playing = true; $('#play').textContent = '❚❚';
  const prov = Object.values(batch.results).find(r => r.provenance)?.provenance?.current;
  if (prov) $('#prov').textContent = `해류: ${prov.provider} · 요청 ${prov.requested_point} → 반환 ${prov.returned_point} · 수신 시각 ${prov.received_at_label} · 탐침 시작 ${prov.probe_start} · sha256 ${prov.sha256.slice(0, 12)}…`;
  $('#runbtn').disabled = false;
}
$('#runbtn').onclick = () => run();
$('#executor').onchange = e => state.executor = e.target.value;

async function init() {
  await loadTerrain();
  const cfg = await (await fetch('/api/config')).json(); state.config = cfg;
  const dt = cfg.executors.daytona;
  $('#executor').innerHTML = `<option value="local">로컬 실행</option><option value="daytona" ${dt.available ? '' : 'disabled'}>Daytona sandbox${dt.available ? '' : ' (키 필요)'}</option>`;
  if (dt.available) { state.executor = 'daytona'; $('#executor').value = 'daytona'; }
  const cacheOk = Object.values(cfg.cache).every(c => c.status === 'OK');
  const forced = new URLSearchParams(location.search).get('source');
  state.source = forced === 'synthetic' || !cacheOk ? 'synthetic' : 'cache';
  $('#src-label').textContent = state.source === 'cache' ? '저장된 예보' : '합성 흐름 (UI 개발용)';
  if (!cacheOk) banner('저장된 예보 파일이 없거나 해시가 다릅니다 (SETUP_BLOCKED). 지금은 UI 개발용 합성 흐름으로만 보여 줍니다. 예보가 아닙니다.', 'warn');
  $('#rp-note').textContent = dt.available ? '시나리오마다 sandbox 하나에서 동시에 계산합니다.' : `Daytona 미연결: ${dt.reason}`;
  renderRows(null); renderCard(); setFrame(0);
}
init();
