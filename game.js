'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 수박 게임: 화면·입력·소리. 과일·물리·합치기는 logic.js (LOGIC_SUIKA) 에 있다.
const L = LOGIC_SUIKA;
const { W, H, LEFT, RIGHT, FLOOR, BOX_TOP, LINE_Y, DROP_Y, FRUITS, STEP, makeFruit, stepWorld } = L;

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
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
let dropped = 0;              // 이번 판에서 떨어뜨린 과일 수
let particles = [];
let texts = [];
let keys = {};

const randomFruit = () => L.randomFruit();
const DANGER_LIMIT = 2.5;
const GUIDE_DROPS = 4;        // 처음 몇 개만 조준선을 보여주고, 그다음부터는 감으로

function startGame() {
  world = { bodies: [] };
  score = 0;
  current = randomFruit();
  next = randomFruit();
  aimX = W / 2;
  cooldown = 0;
  danger = 0;
  biggest = 0;
  dropped = 0;
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
  dropped++;
  sfx.drop();
  tutorialSignal('drop');
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
  const over = L.aboveLine(world);
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
      <h2 class="inked">게임 오버</h2>
      <div class="big inked">${score.toLocaleString()}</div>
      <p>${score >= best && score > 0 ? '🏆 최고 기록!' : `최고 기록 ${best.toLocaleString()}`}<br>가장 큰 과일: <b>${f.name}</b></p>
      <button id="startBtn">다시 하기</button>`);
  }, 700);
}

// ---------- Draw ----------
const INK = '#2b1d52';
function drawFruit(c, t, x, y, r0, ang = 0) {
  const f = FRUITS[t];
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  if (t === 1) { drawStrawberry(c, r0); c.restore(); return; }

  // 진한 테두리 (물리 반지름 r0 까지), 그 안쪽에 몸통
  const lw = Math.max(1.5, r0 * 0.08);
  c.fillStyle = INK;
  c.beginPath();
  c.arc(0, 0, r0, 0, Math.PI * 2);
  c.fill();
  const r = r0 - lw;
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
  c.strokeStyle = INK;
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
  c.fillStyle = 'rgba(255,255,255,.6)';
  c.beginPath(); c.ellipse(-r * 0.38, -r * 0.42, r * 0.2, r * 0.12, -0.7, 0, Math.PI * 2); c.fill();

  drawFace(c, r, r * 0.02);
  c.restore();
}

// 눈 두 개, 웃는 입, 볼터치 (작으면 생략)
function drawFace(c, r, ey) {
  if (r < 12) return;
  const ex = r * 0.28, er = Math.max(1.6, r * 0.075);
  c.fillStyle = INK;
  c.beginPath(); c.arc(-ex, ey, er, 0, Math.PI * 2); c.arc(ex, ey, er, 0, Math.PI * 2); c.fill();
  c.strokeStyle = INK;
  c.lineWidth = Math.max(1.2, r * 0.05);
  c.beginPath(); c.arc(0, ey + r * 0.12, r * 0.14, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  c.fillStyle = 'rgba(255,120,140,.35)';
  c.beginPath(); c.arc(-ex * 1.45, ey + r * 0.18, r * 0.1, 0, Math.PI * 2); c.arc(ex * 1.45, ey + r * 0.18, r * 0.1, 0, Math.PI * 2); c.fill();
}

// 딸기: 동그라미 대신 위가 넓고 아래가 뾰족한 딸기 모양 + 초록 꼭지 + 씨.
// 물리 원(반지름 r0) 안에 들어가게 그려서 부딪히는 크기는 그대로다.
function drawStrawberry(c, r0) {
  const shape = (k) => {
    const r = r0 * k;
    c.beginPath();
    c.moveTo(0, r * 0.98);                                              // 아래 뾰족한 끝
    c.bezierCurveTo(-r * 0.5, r * 0.8, -r * 0.98, r * 0.2, -r * 0.92, -r * 0.3);
    c.bezierCurveTo(-r * 0.86, -r * 0.82, -r * 0.35, -r * 0.9, 0, -r * 0.78);   // 넓고 둥근 윗부분
    c.bezierCurveTo(r * 0.35, -r * 0.9, r * 0.86, -r * 0.82, r * 0.92, -r * 0.3);
    c.bezierCurveTo(r * 0.98, r * 0.2, r * 0.5, r * 0.8, 0, r * 0.98);
    c.closePath();
  };
  const lw = Math.max(1.5, r0 * 0.08);
  // 몸통: 테두리 → 빨강 그라디언트
  shape(1); c.fillStyle = INK; c.fill();
  shape(1 - lw / r0 * 1.15);
  const g = c.createLinearGradient(-r0 * 0.5, -r0 * 0.8, r0 * 0.4, r0);
  g.addColorStop(0, '#ff8a9a'); g.addColorStop(0.45, '#ff3b57'); g.addColorStop(1, '#c4102f');
  c.fillStyle = g; c.fill();
  // 씨: 엇갈린 줄로 촘촘히, 몸통 안쪽에만
  c.save();
  c.clip();
  const sd = Math.max(1, r0 * 0.07);
  for (let row = 0; row < 5; row++) {
    const y = -r0 * 0.38 + row * r0 * 0.28;
    const n = 4 - Math.floor(row / 2);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * r0 * 0.36 + (row % 2 ? r0 * 0.1 : 0);
      c.fillStyle = 'rgba(120,10,30,.35)';
      c.beginPath(); c.ellipse(x + sd * 0.25, y + sd * 0.3, sd * 0.7, sd, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffe27a';
      c.beginPath(); c.ellipse(x, y, sd * 0.55, sd * 0.85, 0, 0, Math.PI * 2); c.fill();
    }
  }
  // 윗부분 광택
  c.fillStyle = 'rgba(255,255,255,.55)';
  c.beginPath(); c.ellipse(-r0 * 0.42, -r0 * 0.4, r0 * 0.18, r0 * 0.1, -0.6, 0, Math.PI * 2); c.fill();
  c.restore();
  // 초록 꼭지: 어깨 위로 늘어진 잎 5장 + 꼭지 줄기
  const ly = -r0 * 0.7;
  c.lineWidth = Math.max(1.2, r0 * 0.07);
  c.strokeStyle = INK;
  c.lineJoin = 'round';
  const leaves = [-0.95, -0.5, 0, 0.5, 0.95];                           // 잎 방향 (0 = 바로 아래)
  for (const k of leaves) {
    const a = Math.PI / 2 + k * 1.25;                                   // 아래쪽 반원으로 펼침
    const len = r0 * (Math.abs(k) > 0.7 ? 0.5 : 0.42);
    const tipX = Math.cos(a) * len, tipY = ly + Math.sin(a) * len * 0.62;
    const nx = -Math.sin(a) * r0 * 0.13, ny = Math.cos(a) * r0 * 0.13;   // 잎 폭 방향
    c.beginPath();
    c.moveTo(0, ly);
    c.quadraticCurveTo(tipX * 0.5 + nx, (ly + tipY) / 2 + ny, tipX, tipY);
    c.quadraticCurveTo(tipX * 0.5 - nx, (ly + tipY) / 2 - ny, 0, ly);
    c.closePath();
    c.fillStyle = '#5fd36e'; c.fill(); c.stroke();
  }
  c.fillStyle = '#2f9e44';
  c.beginPath(); c.ellipse(0, ly, r0 * 0.15, r0 * 0.1, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(0, ly - r0 * 0.06); c.quadraticCurveTo(r0 * 0.02, ly - r0 * 0.3, r0 * 0.14, ly - r0 * 0.38);
  c.lineWidth = Math.max(1.5, r0 * 0.1); c.lineCap = 'round'; c.strokeStyle = INK; c.stroke();
  c.lineWidth = Math.max(0.8, r0 * 0.05); c.strokeStyle = '#5fd36e'; c.stroke();
  c.lineCap = 'butt';
  // 얼굴은 몸통 가운데보다 살짝 아래
  drawFace(c, r0 * 0.85, r0 * 0.12);
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

function label(text, x, y, size, fill = '#fff') {
  ctx.font = `${size}px "Jua", "Apple SD Gothic Neo", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.22); ctx.strokeStyle = INK; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  // 유리병: 아래로 떨어진 진한 그림자 + 테두리, 안쪽은 밝은 크림색에 물방울 무늬
  const jx = LEFT - 10, jy = BOX_TOP - 6, jw = RIGHT - LEFT + 20, jh = FLOOR - BOX_TOP + 16;
  ctx.fillStyle = INK; roundRect(jx, jy + 9, jw, jh, 26); ctx.fill();
  const g = ctx.createLinearGradient(0, jy, 0, jy + jh);
  g.addColorStop(0, '#fffaf0'); g.addColorStop(1, '#ffe4b8');
  ctx.fillStyle = g; roundRect(jx, jy, jw, jh, 26); ctx.fill();
  ctx.save();
  roundRect(jx, jy, jw, jh, 26); ctx.clip();
  ctx.fillStyle = 'rgba(255,164,43,.1)';
  for (let y = jy; y < jy + jh; y += 26)
    for (let x = jx + ((y / 26) % 2 ? 13 : 0); x < jx + jw; x += 26) { ctx.beginPath(); ctx.arc(x + 6, y + 6, 3.5, 0, Math.PI * 2); ctx.fill(); }
  // 왼쪽 유리 반사
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  roundRect(jx + 8, jy + 30, 7, jh - 70, 4); ctx.fill();
  ctx.restore();
  ctx.lineWidth = 4; ctx.strokeStyle = INK; roundRect(jx, jy, jw, jh, 26); ctx.stroke();
  // 병 입구 테
  ctx.fillStyle = '#ffd23f'; roundRect(jx - 6, jy - 10, jw + 12, 18, 9); ctx.fill();
  ctx.lineWidth = 3; ctx.stroke();

  // 위험선: 넘칠 기미가 보이면 깜빡인다
  const near = world.bodies.some((b) => b.age > 1.2 && b.y - b.r < LINE_Y + 40);
  const blink = danger > 0 ? (Math.sin(performance.now() / 80) > 0 ? 1 : 0.4) : near ? 0.9 : 0.5;
  ctx.save();
  ctx.globalAlpha = blink;
  ctx.setLineDash([12, 9]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = danger > 0 ? 7 : 5;
  ctx.beginPath(); ctx.moveTo(LEFT + 4, LINE_Y); ctx.lineTo(RIGHT - 4, LINE_Y); ctx.stroke();
  ctx.strokeStyle = '#ff5fa2'; ctx.lineWidth = danger > 0 ? 4 : 2.5;
  ctx.beginPath(); ctx.moveTo(LEFT + 4, LINE_Y); ctx.lineTo(RIGHT - 4, LINE_Y); ctx.stroke();
  ctx.restore();

  // 조준선과 들고 있는 과일
  if (state === 'play' || state === 'paused') {
    const r = FRUITS[current].r;
    if (dropped < GUIDE_DROPS) {
      ctx.save();
      ctx.setLineDash([2, 9]);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(43,29,82,.45)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(aimX, DROP_Y + r + 4); ctx.lineTo(aimX, FLOOR); ctx.stroke();
      ctx.restore();
    }
    if (cooldown <= 0) drawFruit(ctx, current, aimX, DROP_Y, r);
    else { ctx.globalAlpha = 0.4; drawFruit(ctx, current, aimX, DROP_Y, r); ctx.globalAlpha = 1; }
  }

  // 과일들
  for (const b of world.bodies) drawFruit(ctx, b.t, b.x, b.y, b.r, b.ang);

  // 파티클: 테두리 두른 방울
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(p.x, p.y + 1, p.r + 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 점수 글자
  for (const t of texts) {
    if (t.t < 0) continue;
    ctx.globalAlpha = Math.min(1, (1 - t.t) * 3);
    label(t.text, t.x, t.y, t.big ? 30 : 19, t.big ? '#ffd23f' : '#fff');
  }
  ctx.globalAlpha = 1;

  // 진화 순서: 병 아래 흰 알약
  const sx0 = LEFT - 4, sw = RIGHT - LEFT + 8, sy = FLOOR + 40;
  ctx.fillStyle = INK; roundRect(sx0, sy - 17, sw, 36, 18); ctx.fill();
  ctx.fillStyle = '#ffffff'; roundRect(sx0, sy - 21, sw, 36, 18); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; roundRect(sx0, sy - 21, sw, 36, 18); ctx.stroke();
  const slot = (RIGHT - LEFT) / FRUITS.length;
  for (let i = 0; i < FRUITS.length; i++) {
    const cx = LEFT + slot * (i + 0.5);
    const rr = 6 + i * 0.75;
    ctx.globalAlpha = i <= biggest || state === 'title' ? 1 : 0.3;
    drawFruit(ctx, i, cx, sy - 3, rr);
  }
  ctx.globalAlpha = 1;

  // 넘치기 직전 카운트다운
  if (state === 'play' && danger > 0.5) {
    label(`${Math.ceil(DANGER_LIMIT - danger)}`, W / 2, LINE_Y + 56, 52, '#ff5fa2');
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
  showOverlay(`<h2 class="inked">일시정지</h2><p>점수 ${score.toLocaleString()}</p><button id="startBtn">계속하기</button>`);
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
// 아이폰 등에서는 브라우저가 터치를 스크롤·제스처로 가져가면 pointerup 대신 pointercancel 을 보낸다.
// 예전엔 취소되면 그냥 버려서, 손을 뗐는데도 발사가 안 돼 '탭이 안 먹는' 것처럼 느껴졌다.
// → 취소돼도 뗀 것으로 치고, 혹시 포인터 이벤트가 빠져도 touchend 로 한 번 더 처리한다 (두 번 불려도 한 번만 발사).
// 캔버스 위 터치는 스크롤·확대로 쓰지 말라고 브라우저에 알린다.
function releaseTouch() {
  if (!touching) return;
  touching = false;
  drop();
}
canvas.addEventListener('pointerup', releaseTouch);
canvas.addEventListener('pointercancel', releaseTouch);
canvas.addEventListener('touchend', releaseTouch, { passive: true });
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

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
