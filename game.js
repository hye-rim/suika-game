'use strict';

// ---------- Board ----------
const W = 420, H = 700;
const LEFT = 20, RIGHT = 400;       // 통 안쪽 벽
const FLOOR = 640;                  // 통 바닥
const BOX_TOP = 120;                // 통 윗부분 (그림용)
const LINE_Y = 150;                 // 과일 윗부분이 이 선 위에 오래 머물면 게임 오버
const DROP_Y = 72;                  // 떨어뜨리기 전 과일이 매달린 높이

// 체리 → 수박. score 는 그 과일이 만들어질 때 얻는 점수
const FRUITS = [
  { name: '체리', r: 14, color: '#e8203a', dark: '#9c0a1f', light: '#ff7a8c' },
  { name: '딸기', r: 19, color: '#ff4d5e', dark: '#b8182a', light: '#ff9aa4' },
  { name: '포도', r: 25, color: '#9b59d0', dark: '#5e2a8c', light: '#cfa3f0' },
  { name: '한라봉', r: 29, color: '#ffa42b', dark: '#c46a00', light: '#ffd28a' },
  { name: '감', r: 36, color: '#ff7a1a', dark: '#b84a00', light: '#ffb77a' },
  { name: '사과', r: 44, color: '#e53935', dark: '#9a1512', light: '#ff8a80' },
  { name: '배', r: 52, color: '#f2dc6b', dark: '#b89a20', light: '#fff3b8' },
  { name: '복숭아', r: 62, color: '#ffb0bd', dark: '#e0708a', light: '#ffe0e6' },
  { name: '파인애플', r: 72, color: '#ffd23f', dark: '#c49400', light: '#fff09a' },
  { name: '멜론', r: 86, color: '#9ad25a', dark: '#4f8a1c', light: '#d6f5a8' },
  { name: '수박', r: 100, color: '#2e9e44', dark: '#135e25', light: '#7fd98d' },
];
const SCORE = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55];
const WATERMELON_PAIR = 100;         // 수박 두 개가 만나면 사라지며 보너스
const DROPPABLE = 5;                 // 체리~감 중에서 무작위로 나온다

// ---------- Physics ----------
// Verlet 적분 + 겹침 풀기. 한 프레임(1/60초)을 잘게 나눠 여러 번 계산해야 쌓인 과일이 안정적이다.
const STEP = 1 / 60;
const SUBSTEPS = 10;
const GRAVITY = 2400;                // px/s²
const MAX_V = 4;                     // 서브스텝당 최대 이동 (합쳐질 때 튕겨나가는 힘 제한)
const DAMP = 0.999;
const FRICTION = 0.08;               // 과일끼리 미끄러짐 줄이기
const FLOOR_FRICTION = 0.04;
// 합쳐질 때 튕김 줄이기: 새 과일은 GROW_FRAMES 동안 천천히 커지고, 그동안 밀려난 거리는
// 대부분(SOFT) 속도로 바뀌지 않게 한다. 이 '얌전함'은 새 과일에서 바깥쪽으로 CALM_DEPTH 겹까지 퍼진다.
// 작은 과일이 큰 과일 사이에 끼어 두 다리 건너 밀려도 튀어나가지 않게 하기 위해서다.
// 안쪽 겹으로는 되돌아가지 않아 시간이 지나면 반드시 풀린다 (서로 계속 옮기면 더미 전체가 물렁해진다).
const GROW_FRAMES = 15;
const CALM_TIME = 0.4;
const CALM_DEPTH = 3;
const SOFT = 0.95;
const MERGE_KEEP_V = 0.3;

let nextId = 1;
function makeFruit(t, x, y) {
  const r = FRUITS[t].r;
  return { id: nextId++, t, x, y, px: x, py: y, r, rTarget: r, m: r * r, ang: 0, age: 0, calm: 0, calmDepth: 0, dead: false };
}

function spreadCalm(from, to) {
  if (from.calm <= 0 || from.calmDepth >= CALM_DEPTH) return;
  if (to.calm > 0 && to.calmDepth <= from.calmDepth + 1) return;
  to.calm = from.calm;          // 남은 시간을 물려받으니 함께 끝난다
  to.calmDepth = from.calmDepth + 1;
}

// 한 서브스텝. 합쳐진 결과(새 과일, 점수)는 events 에 담아 돌려준다.
function substep(world, h, events) {
  const bodies = world.bodies;
  const g = GRAVITY * h * h;
  for (const b of bodies) {
    let vx = (b.x - b.px) * DAMP, vy = (b.y - b.py) * DAMP;
    const sp = Math.hypot(vx, vy);
    if (sp > MAX_V) { vx *= MAX_V / sp; vy *= MAX_V / sp; }
    b.px = b.x; b.py = b.y;
    b.x += vx;
    b.y += vy + g;
    b.ang += vx / b.r;
  }

  const merges = [];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.r + b.r;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.0001;
        const nx = dx / d, ny = dy / d;

        if (a.t === b.t && a.r === a.rTarget && b.r === b.rTarget) {
          a.dead = b.dead = true;
          merges.push([a, b]);
          continue;
        }

        const overlap = (min - d) * 0.8;
        const ma = b.m / (a.m + b.m), mb = a.m / (a.m + b.m);
        a.x -= nx * overlap * ma; a.y -= ny * overlap * ma;
        b.x += nx * overlap * mb; b.y += ny * overlap * mb;
        if (a.calm > 0 || b.calm > 0) {
          // 자리만 비켜주고 튕겨나가지는 않게: 이전 위치도 같이 옮겨 속도로 남는 몫을 줄인다
          const k = overlap * SOFT;
          a.px -= nx * k * ma; a.py -= ny * k * ma;
          b.px += nx * k * mb; b.py += ny * k * mb;
          spreadCalm(a, b);
          spreadCalm(b, a);
        }

        // 접선 방향 상대 속도를 조금 줄여 굴러다니지 않고 자리를 잡게 한다
        const rvx = (b.x - b.px) - (a.x - a.px), rvy = (b.y - b.py) - (a.y - a.py);
        const rn = rvx * nx + rvy * ny;
        const tx = (rvx - rn * nx) * FRICTION, ty = (rvy - rn * ny) * FRICTION;
        a.px -= tx * ma; a.py -= ty * ma;
        b.px += tx * mb; b.py += ty * mb;
      }
    }
    for (const b of bodies) {
      // 벽·바닥을 파고들었으면 되돌리고 그 축의 속도를 0으로. 이전 위치(px/py)를 남겨두면
      // 되돌린 거리가 그대로 반대 방향 속도가 되어, 위에서 눌린 과일이 바닥에서 튀어 오른다.
      if (b.x - b.r < LEFT) { b.x = LEFT + b.r; b.px = b.x; }
      if (b.x + b.r > RIGHT) { b.x = RIGHT - b.r; b.px = b.x; }
      if (b.y + b.r > FLOOR) {
        b.y = FLOOR - b.r;
        b.py = b.y;
        b.px += (b.x - b.px) * FLOOR_FRICTION;
      }
    }
  }

  for (const [a, b] of merges) {
    const x = (a.x * a.m + b.x * b.m) / (a.m + b.m);
    const y = (a.y * a.m + b.y * b.m) / (a.m + b.m);
    if (a.t === FRUITS.length - 1) {
      events.push({ type: 'melons', x, y, score: WATERMELON_PAIR });
      continue;
    }
    const f = makeFruit(a.t + 1, x, y);
    // 작은 크기에서 커지면서 주변을 밀어낸다 (한 번에 커지면 폭발하듯 튕긴다)
    f.r = FRUITS[a.t].r;
    // 떨어지던 속도를 그대로 이어받으면 새 과일이 더미에 부딪혀 튄다. 조금만 남긴다.
    f.px = x - ((a.x - a.px) + (b.x - b.px)) / 2 * MERGE_KEEP_V;
    f.py = y - ((a.y - a.py) + (b.y - b.py)) / 2 * MERGE_KEEP_V;
    f.age = 1;   // 합쳐진 과일은 바로 게임 오버 판정 대상
    f.calm = CALM_TIME;
    f.calmDepth = 0;
    bodies.push(f);
    events.push({ type: 'merge', t: f.t, x, y, score: SCORE[f.t] });
  }
  if (merges.length) world.bodies = bodies.filter((b) => !b.dead);
}

function stepWorld(world) {
  const events = [];
  const h = STEP / SUBSTEPS;
  for (const b of world.bodies) {
    b.age += STEP;
    if (b.calm > 0) b.calm = Math.max(0, b.calm - STEP);
    if (b.r !== b.rTarget) b.r = Math.min(b.rTarget, b.r + (b.rTarget - FRUITS[Math.max(0, b.t - 1)].r) / GROW_FRAMES);
    b.m = b.r * b.r;
  }
  for (let s = 0; s < SUBSTEPS; s++) substep(world, h, events);
  return events;
}

if (typeof document === 'undefined') {
  module.exports = { W, H, LEFT, RIGHT, FLOOR, LINE_Y, DROP_Y, FRUITS, SCORE, makeFruit, stepWorld };
} else {
// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('nextCanvas');
const nctx = nextCanvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const hudH = 58;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - hudH) / H);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = cssW + 'px';
}
addEventListener('resize', fit);

// ---------- Storage ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- Sound ----------
let audio = null;
let muted = store.get('suikaMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const sfx = {
  drop: () => tone(300, 0.08, 'triangle', 0.08, -120),
  // 큰 과일일수록 낮고 묵직한 소리
  merge: (t) => tone(900 - t * 60, 0.14, 'sine', 0.14, 260),
  melon: () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'square', 0.06), i * 90)),
  warn: () => tone(220, 0.1, 'square', 0.05),
  over: () => [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.1), i * 180)),
};

// ---------- Game state ----------
let state = 'title';          // title | play | paused | over
let world = { bodies: [] };
let score = 0;
let best = Number(store.get('suikaBest')) || 0;
let current = 0, next = 0;    // 들고 있는 과일, 다음 과일
let aimX = W / 2;
let cooldown = 0;             // 떨어뜨린 뒤 다음 과일이 나올 때까지
let danger = 0;               // 선을 넘은 채로 지난 시간
let biggest = 0;              // 이번 판에서 만든 가장 큰 과일
let particles = [];
let texts = [];
let keys = {};

const randomFruit = () => Math.floor(Math.random() * DROPPABLE);
const DANGER_LIMIT = 2.5;

function startGame() {
  world = { bodies: [] };
  score = 0;
  current = randomFruit();
  next = randomFruit();
  aimX = W / 2;
  cooldown = 0;
  danger = 0;
  biggest = 0;
  particles = [];
  texts = [];
  state = 'play';
  hideOverlay();
  updateHud();
}

function clampAim() {
  const r = FRUITS[current].r;
  aimX = Math.min(RIGHT - r, Math.max(LEFT + r, aimX));
}

function drop() {
  if (state !== 'play' || cooldown > 0) return;
  clampAim();
  // 좌우로 약간 흔들어 똑같은 자리에 탑처럼 쌓이지 않게 한다
  world.bodies.push(makeFruit(current, aimX + (Math.random() - 0.5) * 0.02, DROP_Y));
  sfx.drop();
  current = next;
  next = randomFruit();
  cooldown = 0.5;
  updateHud();
}

function addScore(n) {
  score += n;
  if (score > best) { best = score; store.set('suikaBest', String(best)); }
  updateHud();
}

function burst(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.6 + Math.random() * 0.3, r: 2 + Math.random() * 3, color });
  }
}

function update(dt) {
  // 파티클·글자는 멈춤 없이 흘러가게
  for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; }
  particles = particles.filter((p) => p.life > 0);
  for (const t of texts) { t.t += dt; t.y -= 30 * dt; }
  texts = texts.filter((t) => t.t < 1);
  if (state !== 'play') return;

  if (keys.ArrowLeft || keys.KeyA) aimX -= 320 * dt;
  if (keys.ArrowRight || keys.KeyD) aimX += 320 * dt;
  clampAim();
  cooldown = Math.max(0, cooldown - dt);

  for (const e of stepWorld(world)) {
    if (e.type === 'merge') {
      addScore(e.score);
      sfx.merge(e.t);
      burst(e.x, e.y, FRUITS[e.t].color, 8 + e.t * 2, 120 + e.t * 20);
      texts.push({ text: `+${e.score}`, x: e.x, y: e.y - FRUITS[e.t].r, t: 0, big: e.t >= 8 });
      if (e.t > biggest) biggest = e.t;
      if (e.t === FRUITS.length - 1) texts.push({ text: '🍉 수박 완성!', x: W / 2, y: 260, t: -0.5, big: true });
    } else if (e.type === 'melons') {
      addScore(e.score);
      sfx.melon();
      burst(e.x, e.y, FRUITS[10].color, 60, 400);
      texts.push({ text: `수박 두 개! +${e.score}`, x: W / 2, y: 260, t: -0.5, big: true });
    }
  }

  // 과일 윗부분이 선 위에 머물면 경고, 계속되면 게임 오버
  const over = world.bodies.some((b) => b.age > 1.2 && b.y - b.r < LINE_Y && Math.abs(b.y - b.py) < 1.5);
  if (over) {
    const before = Math.floor(danger * 2);
    danger += dt;
    if (Math.floor(danger * 2) !== before) sfx.warn();
    if (danger > DANGER_LIMIT) gameOver();
  } else {
    danger = Math.max(0, danger - dt * 2);
  }
}

function gameOver() {
  state = 'over';
  sfx.over();
  const f = FRUITS[biggest];
  setTimeout(() => {
    showOverlay(`
      <h2>게임 오버</h2>
      <div class="big">${score.toLocaleString()}</div>
      <p>${score >= best && score > 0 ? '🏆 최고 기록!' : `최고 기록 ${best.toLocaleString()}`}<br>가장 큰 과일: <b>${f.name}</b></p>
      <button id="startBtn">다시 하기</button>`);
  }, 700);
}

// ---------- Draw ----------
function drawFruit(c, t, x, y, r, ang = 0) {
  const f = FRUITS[t];
  c.save();
  c.translate(x, y);
  c.rotate(ang);

  // 몸통
  const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, f.light);
  g.addColorStop(0.55, f.color);
  g.addColorStop(1, f.dark);
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();

  // 과일마다 무늬
  c.save();
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.clip();
  if (t === 10) {                       // 수박 줄무늬
    c.strokeStyle = f.dark;
    c.lineWidth = r * 0.12;
    for (let k = -2; k <= 2; k++) {
      c.beginPath();
      c.moveTo(k * r * 0.38, -r);
      c.bezierCurveTo(k * r * 0.38 + r * 0.15, -r * 0.3, k * r * 0.38 - r * 0.15, r * 0.3, k * r * 0.38, r);
      c.stroke();
    }
  } else if (t === 9) {                 // 멜론 그물
    c.strokeStyle = 'rgba(240,255,220,.55)';
    c.lineWidth = 1.5;
    for (let k = -4; k <= 4; k++) {
      c.beginPath(); c.moveTo(k * r * 0.25 - r, -r); c.lineTo(k * r * 0.25 + r, r); c.stroke();
      c.beginPath(); c.moveTo(k * r * 0.25 + r, -r); c.lineTo(k * r * 0.25 - r, r); c.stroke();
    }
  } else if (t === 8) {                 // 파인애플 격자
    c.strokeStyle = 'rgba(160,100,0,.45)';
    c.lineWidth = 2;
    for (let k = -4; k <= 4; k++) {
      c.beginPath(); c.moveTo(k * r * 0.3 - r, -r); c.lineTo(k * r * 0.3 + r, r); c.stroke();
      c.beginPath(); c.moveTo(k * r * 0.3 + r, -r); c.lineTo(k * r * 0.3 - r, r); c.stroke();
    }
  } else if (t === 1) {                 // 딸기 씨
    c.fillStyle = '#ffe98a';
    for (let k = 0; k < 10; k++) {
      const a = k * 2.4, d = r * (0.3 + (k % 3) * 0.2);
      c.beginPath(); c.ellipse(Math.cos(a) * d, Math.sin(a) * d + r * 0.1, 1.4, 2.2, a, 0, Math.PI * 2); c.fill();
    }
  } else if (t === 3 || t === 4) {      // 한라봉·감 껍질 점
    c.fillStyle = 'rgba(255,255,255,.18)';
    for (let k = 0; k < 14; k++) {
      const a = k * 2.1, d = r * (0.2 + (k % 4) * 0.2);
      c.beginPath(); c.arc(Math.cos(a) * d, Math.sin(a) * d, 1.3, 0, Math.PI * 2); c.fill();
    }
  } else if (t === 7) {                 // 복숭아 골
    c.strokeStyle = 'rgba(220,90,120,.35)';
    c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(r * 0.1, -r); c.quadraticCurveTo(-r * 0.3, 0, r * 0.1, r); c.stroke();
  }
  c.restore();

  // 꼭지·잎
  c.fillStyle = '#3f8a2a';
  c.strokeStyle = '#6b3e12';
  c.lineWidth = Math.max(1.5, r * 0.08);
  if (t === 0) {
    c.beginPath(); c.moveTo(0, -r * 0.9); c.quadraticCurveTo(r * 0.3, -r * 1.6, r * 0.8, -r * 1.7); c.stroke();
  } else if (t === 8) {
    c.fillStyle = '#4caf50';
    for (let k = -2; k <= 2; k++) {
      c.beginPath();
      c.moveTo(k * r * 0.12 - r * 0.08, -r * 0.9);
      c.lineTo(k * r * 0.2, -r * 1.35 + Math.abs(k) * r * 0.08);
      c.lineTo(k * r * 0.12 + r * 0.08, -r * 0.9);
      c.fill();
    }
  } else if (t !== 9 && t !== 10 && t !== 2) {
    c.beginPath(); c.ellipse(r * 0.22, -r * 0.95, r * 0.22, r * 0.1, -0.5, 0, Math.PI * 2); c.fill();
  }

  // 반짝임
  c.fillStyle = 'rgba(255,255,255,.45)';
  c.beginPath(); c.ellipse(-r * 0.38, -r * 0.42, r * 0.2, r * 0.12, -0.7, 0, Math.PI * 2); c.fill();

  // 얼굴
  if (r >= 12) {
    const ey = r * 0.02, ex = r * 0.28, er = Math.max(1.6, r * 0.075);
    c.fillStyle = '#2a1405';
    c.beginPath(); c.arc(-ex, ey, er, 0, Math.PI * 2); c.arc(ex, ey, er, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#2a1405';
    c.lineWidth = Math.max(1.2, r * 0.05);
    c.beginPath(); c.arc(0, ey + r * 0.12, r * 0.14, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    c.fillStyle = 'rgba(255,120,140,.35)';
    c.beginPath(); c.arc(-ex * 1.45, ey + r * 0.18, r * 0.1, 0, Math.PI * 2); c.arc(ex * 1.45, ey + r * 0.18, r * 0.1, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  // 통
  ctx.fillStyle = 'rgba(255,248,232,.92)';
  roundRect(LEFT - 12, BOX_TOP, RIGHT - LEFT + 24, FLOOR - BOX_TOP + 12, 16);
  ctx.fill();
  ctx.fillStyle = '#ffe7b0';
  ctx.fillRect(LEFT, BOX_TOP + 4, RIGHT - LEFT, FLOOR - BOX_TOP - 4);
  ctx.strokeStyle = '#c47a2c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(LEFT - 2, BOX_TOP);
  ctx.lineTo(LEFT - 2, FLOOR + 2);
  ctx.lineTo(RIGHT + 2, FLOOR + 2);
  ctx.lineTo(RIGHT + 2, BOX_TOP);
  ctx.stroke();

  // 위험선: 넘칠 기미가 보이면 깜빡인다
  const near = world.bodies.some((b) => b.age > 1.2 && b.y - b.r < LINE_Y + 40);
  const blink = danger > 0 ? (Math.sin(performance.now() / 80) > 0 ? 1 : 0.35) : near ? 0.8 : 0.35;
  ctx.strokeStyle = `rgba(230,50,40,${blink})`;
  ctx.lineWidth = danger > 0 ? 3 : 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.moveTo(LEFT, LINE_Y); ctx.lineTo(RIGHT, LINE_Y); ctx.stroke();
  ctx.setLineDash([]);

  // 조준선과 들고 있는 과일
  if (state === 'play' || state === 'paused') {
    const r = FRUITS[current].r;
    ctx.strokeStyle = 'rgba(154,90,28,.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(aimX, DROP_Y + r); ctx.lineTo(aimX, FLOOR); ctx.stroke();
    ctx.setLineDash([]);
    if (cooldown <= 0) drawFruit(ctx, current, aimX, DROP_Y, r);
    else { ctx.globalAlpha = 0.35; drawFruit(ctx, current, aimX, DROP_Y, r); ctx.globalAlpha = 1; }
  }

  // 과일들
  for (const b of world.bodies) drawFruit(ctx, b.t, b.x, b.y, b.r, b.ang);

  // 파티클
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 점수 글자
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of texts) {
    if (t.t < 0) continue;
    ctx.globalAlpha = Math.min(1, (1 - t.t) * 3);
    ctx.font = `900 ${t.big ? 26 : 16}px sans-serif`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.big ? '#e2542a' : '#7a4a1c';
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;

  // 진화 순서
  const slot = (RIGHT - LEFT) / FRUITS.length;
  const sy = FLOOR + 38;
  for (let i = 0; i < FRUITS.length; i++) {
    const cx = LEFT + slot * (i + 0.5);
    const rr = 6 + i * 0.9;
    ctx.globalAlpha = i <= biggest || state === 'title' ? 1 : 0.35;
    drawFruit(ctx, i, cx, sy, rr);
  }
  ctx.globalAlpha = 1;

  // 넘치기 직전 카운트다운
  if (state === 'play' && danger > 0.5) {
    const n = Math.ceil(DANGER_LIMIT - danger);
    ctx.font = '900 44px sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(n, W / 2, LINE_Y + 50);
    ctx.fillStyle = '#e63228';
    ctx.fillText(n, W / 2, LINE_Y + 50);
  }
}

function drawNext() {
  nctx.clearRect(0, 0, 72, 72);
  const r = FRUITS[next].r;
  const s = Math.min(1, 30 / r);
  nctx.save();
  nctx.translate(36, 38);
  nctx.scale(s * 1, s * 1);
  drawFruit(nctx, next, 0, 0, r);
  nctx.restore();
}

function updateHud() {
  $('score').textContent = score.toLocaleString();
  $('best').textContent = best.toLocaleString();
  drawNext();
}

// ---------- Loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state === 'play') {
    // 물리는 1/60초 고정 간격으로 (화면 주사율과 상관없이 같은 움직임)
    acc += dt;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
  } else {
    acc = 0;
    update(dt);
  }
  draw();
  requestAnimationFrame(frame);
}

// ---------- Overlay ----------
function showOverlay(html) {
  const o = $('overlay');
  o.innerHTML = html;
  o.classList.remove('hidden');
  const btn = $('startBtn');
  if (btn) btn.onclick = onOverlayButton;
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

function onOverlayButton() {
  if (state === 'paused') resume();
  else startGame();
}

function pause() {
  if (state !== 'play') return;
  state = 'paused';
  keys = {};
  showOverlay(`<h2>일시정지</h2><p>점수 ${score.toLocaleString()}</p><button id="startBtn">계속하기</button>`);
}
function resume() {
  if (state !== 'paused') return;
  state = 'play';
  hideOverlay();
}

// ---------- Input ----------
function toLocalX(e) {
  const rect = canvas.getBoundingClientRect();
  return (e.clientX - rect.left) * (W / rect.width);
}

let touching = false;
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  aimX = toLocalX(e);
  clampAim();
  if (e.pointerType === 'mouse') { drop(); return; }
  // 손가락은 누른 채 좌우로 옮기다가 떼면 떨어뜨린다
  touching = true;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener('pointermove', (e) => {
  if (state !== 'play') return;
  if (e.pointerType !== 'mouse' && !touching) return;
  aimX = toLocalX(e);
  clampAim();
});
canvas.addEventListener('pointerup', () => {
  if (!touching) return;
  touching = false;
  drop();
});
canvas.addEventListener('pointercancel', () => { touching = false; });

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'Enter') {
    if (state === 'play') drop();
    else if (!$('overlay').classList.contains('hidden')) onOverlayButton();
  }
  if (e.code === 'KeyP' || e.code === 'Escape') state === 'paused' ? resume() : pause();
  if (e.code === 'KeyM') toggleMute();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { keys = {}; pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('suikaMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

next = randomFruit();
updateHud();
fit();
requestAnimationFrame(frame);
}
