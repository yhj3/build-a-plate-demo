// Build-a-Plate: scene setup, interaction and panel logic. Nutrition rules live in rules.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { summarize, coachNotes, evaluateScenario } from './rules.js';

const $ = (id) => document.getElementById(id);

// ---------- Scene setup: renderer, camera, controls, lights, table, plate ----------
const canvas = $('scene');
const wrap = $('canvas-wrap');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2f0ea);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 4.5, 6);
camera.lookAt(0, 0.5, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI / 2.1;

scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8f7c, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(4, 8, 5); // upper-front-right
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const table = new THREE.Mesh(
  new THREE.BoxGeometry(8, 0.2, 5),
  new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.8 })
);
table.position.y = -0.1; // top surface at y = 0
table.receiveShadow = true;
scene.add(table);

const PLATE_CENTER = new THREE.Vector3(0, 0.04, 0.3);
const PLATE_TOP = 0.08;
const plate = new THREE.Mesh(
  new THREE.CylinderGeometry(1.0, 1.0, 0.08, 48),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
);
plate.position.copy(PLATE_CENTER);
plate.receiveShadow = true;
plate.castShadow = true;
scene.add(plate);

function resize() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Tiny tween helper: step(k) runs every frame with k from 0 to 1, then done() once.
const tweens = [];
function tween(ms, step, done) {
  const t0 = performance.now();
  tweens.push((now) => {
    const k = Math.min(1, (now - t0) / ms);
    step(k);
    if (k === 1 && done) done();
    return k === 1;
  });
}

renderer.setAnimationLoop(() => {
  const now = performance.now();
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i](now)) tweens.splice(i, 1);
  controls.update();
  renderer.render(scene, camera);
});

// ---------- Loading foods: one shelf mesh per entry in foods.json ----------
const [foods, scenarios] = await Promise.all([
  fetch('foods.json').then((r) => r.json()),
  fetch('scenarios.json').then((r) => r.json()),
]);
const shelfMeshes = [];
const plateItems = []; // { mesh, food }
const MAX_ITEMS = 12;

function makeGeometry(food) {
  const s = food.size;
  let geo;
  switch (food.shape) {
    case 'box':      geo = new THREE.BoxGeometry(s * 2, s * 2, s * 2); break;
    case 'cylinder': geo = new THREE.CylinderGeometry(s * 0.5, s * 0.5, s * 2, 24); break;
    case 'cone':     geo = food.lying ? new THREE.ConeGeometry(s * 0.45, s * 2.4, 24) : new THREE.ConeGeometry(s, s * 2, 24); break;
    case 'torus':    geo = new THREE.TorusGeometry(s * 0.65, s * 0.35, 16, 32).rotateX(Math.PI / 2); break;
    case 'wedge':    geo = new THREE.CylinderGeometry(s * 1.4, s * 1.4, s * 0.9, 3); break; // 3 radial segments = triangular slab
    default:         geo = new THREE.SphereGeometry(s, 24, 16);
  }
  if (food.lying) geo.rotateZ(-Math.PI / 2); // axis along x, tip pointing +x
  geo.computeBoundingBox();
  return geo;
}

// Each item owns its geometry and material so hover highlights never leak between meshes.
function makeMesh(food, kind) {
  const geo = makeGeometry(food);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: food.color, roughness: 0.7 }));
  if (food.scale) mesh.scale.fromArray(food.scale);
  mesh.castShadow = true;
  // rest = distance from the mesh origin down to its lowest point, so it sits on a surface.
  mesh.userData = { kind, food, rest: -geo.boundingBox.min.y * mesh.scale.y };
  return mesh;
}

foods.forEach((food, i) => {
  const mesh = makeMesh(food, 'shelf');
  const x = -3.2 + (6.4 / (foods.length - 1)) * i;
  mesh.position.set(x, mesh.userData.rest, -1.6);
  scene.add(mesh);
  shelfMeshes.push(mesh);
});

// ---------- Raycasting: click to add/remove, hover to highlight + tooltip ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tooltip = $('tooltip');
let downPos = null;
let hovered = null;
let lastMove = null;
let hoverPending = false;

function clickables() {
  return shelfMeshes.concat(plateItems.map((p) => p.mesh));
}

function pick(event) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((event.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(clickables(), false)[0];
  return hit ? hit.object : null;
}

function setHovered(mesh) {
  if (mesh === hovered) return;
  if (hovered) hovered.material.emissive.setHex(0x000000);
  hovered = mesh;
  if (hovered) hovered.material.emissive.setHex(0x333333);
  canvas.style.cursor = hovered ? 'pointer' : '';
  tooltip.hidden = !hovered;
  if (hovered) {
    const { food, kind } = hovered.userData;
    tooltip.textContent = `${food.label} · ${food.kcal} kcal · click to ${kind === 'shelf' ? 'add' : 'remove'}`;
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) downPos = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved >= 5) return; // an orbit drag, not a click
  const mesh = pick(e);
  if (!mesh) return;
  if (mesh.userData.kind === 'shelf') addToPlate(mesh);
  else removeFromPlate(mesh);
});

canvas.addEventListener('pointermove', (e) => {
  lastMove = e;
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    setHovered(pick(lastMove));
    if (hovered) {
      const r = wrap.getBoundingClientRect();
      tooltip.style.left = `${lastMove.clientX - r.left + 14}px`;
      tooltip.style.top = `${lastMove.clientY - r.top + 14}px`;
    }
  });
});
canvas.addEventListener('pointerleave', () => setHovered(null));

// Sample a few random spots inside the plate and keep the one farthest from existing items.
function spotOnPlate() {
  let best = null;
  let bestGap = -1;
  for (let i = 0; i < 12; i++) {
    const r = 0.7 * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const x = PLATE_CENTER.x + r * Math.cos(a);
    const z = PLATE_CENTER.z + r * Math.sin(a);
    const gap = plateItems.reduce((m, { mesh }) => Math.min(m, Math.hypot(mesh.position.x - x, mesh.position.z - z)), Infinity);
    if (gap > bestGap) { bestGap = gap; best = { x, z }; }
  }
  return best;
}

function addToPlate(source) {
  if (plateItems.length >= MAX_ITEMS) {
    showNote('Plate is full');
    return;
  }
  const food = source.userData.food;
  const mesh = makeMesh(food, 'plate');
  const { x, z } = spotOnPlate();
  const y = PLATE_TOP + mesh.userData.rest;
  mesh.position.set(x, y + 1.2, z);
  scene.add(mesh);
  plateItems.push({ mesh, food });
  tween(350, (k) => { mesh.position.y = y + 1.2 * (1 - k) ** 3; }); // drop in, ease-out
  updatePanel();
}

function removeFromPlate(mesh) {
  const i = plateItems.findIndex((p) => p.mesh === mesh);
  if (i === -1) return;
  if (hovered === mesh) setHovered(null);
  plateItems.splice(i, 1);
  const base = mesh.scale.clone();
  tween(180, (k) => { mesh.scale.copy(base).multiplyScalar(1 - k); }, () => disposeMesh(mesh)); // shrink away
  updatePanel();
}

function disposeMesh(mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
}

// ---------- Panel: totals, macro bars, item list ----------
let noteTimer = null;

function showNote(text) {
  $('note').textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { $('note').textContent = ''; }, 1500);
}

function currentSummary() {
  return summarize(plateItems.map((p) => p.food));
}

function updatePanel() {
  const s = currentSummary();
  $('calories').textContent = `Calories: ${Math.round(s.kcal)} kcal`;
  for (const k of ['protein', 'carbs', 'fat']) {
    const pct = Math.round(s.pct[k]);
    $(`bar-${k}`).style.width = `${pct}%`;
    $(`pct-${k}`).textContent = `${pct}%`;
  }
  const list = $('items');
  list.textContent = '';
  if (s.labels.size === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing yet';
    list.appendChild(li);
  }
  for (const [label, n] of s.labels) {
    const li = document.createElement('li');
    li.textContent = `${label} ×${n}`;
    li.title = 'Click to remove one';
    li.addEventListener('click', () => {
      const last = plateItems.findLast((p) => p.food.label === label);
      if (last) removeFromPlate(last.mesh);
    });
    list.appendChild(li);
  }
}

// ---------- Scenarios: task cards with checkable goals ----------
let scenario = scenarios[0];
const chips = $('scenarios');
scenarios.forEach((sc) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = sc.title;
  b.addEventListener('click', () => selectScenario(sc));
  chips.appendChild(b);
});

function selectScenario(sc) {
  scenario = sc;
  [...chips.children].forEach((b, i) => b.classList.toggle('active', scenarios[i] === sc));
  $('brief').textContent = sc.brief;
  $('feedback').textContent = '';
}

// ---------- Feedback: scenario goals (if any) + spec coach notes, on button press ----------
function renderFeedback() {
  const s = currentSummary();
  const box = $('feedback');
  box.textContent = '';
  const goals = evaluateScenario(s, scenario);
  if (goals.length) {
    const met = goals.filter((g) => g.met).length;
    const score = document.createElement('p');
    score.className = 'score';
    score.textContent = met === goals.length ? `All ${goals.length} goals met` : `${met} of ${goals.length} goals met`;
    const ul = document.createElement('ul');
    ul.className = 'goals';
    for (const g of goals) {
      const li = document.createElement('li');
      li.className = g.met ? 'met' : 'missed';
      li.textContent = `${g.label} (now ${g.actual})`;
      ul.appendChild(li);
    }
    box.append(score, ul);
  }
  const notes = document.createElement('p');
  notes.textContent = coachNotes(s).join(' ');
  box.appendChild(notes);
}

$('check').addEventListener('click', renderFeedback);

$('reset').addEventListener('click', () => {
  setHovered(null);
  for (const { mesh } of plateItems) disposeMesh(mesh);
  plateItems.length = 0;
  $('feedback').textContent = '';
  updatePanel();
});

selectScenario(scenario);
updatePanel();
