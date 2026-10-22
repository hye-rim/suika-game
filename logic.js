'use strict';

// 수박 게임: 규칙·물리만 모아 둔 파일 (그리기·입력·소리 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 같은 과일 둘이 닿으면 한 단계 큰 과일이 된다 (체리 → … → 수박). 수박 둘은 사라지며 보너스
// - 과일 윗부분이 선 위에 머물면(떨어지는 중이 아니면) 경고, 2.5초 넘게 이어지면 끝 — 판정은 game.js 가 시간을 세고 여기 aboveLine 을 쓴다
const LOGIC_SUIKA = (() => {
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
// 튕김: 작은 과일일수록 통통, 큰 과일은 묵직하게. 부딪히는 속도가 BOUNCE_MIN 을 넘을 때만 튕겨서
// 쌓여서 눌려 있는 과일은 떨리지 않는다. 한 번 튀고 나면 속도가 문턱 아래로 떨어져 금방 멈춘다.
const BOUNCE_MIN = 0.5;              // 서브스텝당 px (= 300px/s)
const bounceOf = (t) => 0.3 - t * 0.025;   // 체리 0.3 → 수박 0.05
// 합쳐진 과일이 살짝 뛰어오르는 속도 (px/s). 역시 작을수록 높게.
const mergeHopOf = (t) => 300 - t * 25;    // 딸기 275 → 수박 50

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
    // 이번 서브스텝에 벽·바닥에 부딪혀 튕길 속도 (한 번 정해지면 이후 겹침 풀기에서도 유지)
    b.vIn = vy + g; b.vxIn = vx;
    b.bounceX = b.bounceY = 0;
    b.ang += vx / b.r;
  }

  const merges = [], hits = [];
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

        // 세게 부딪히면 기억해 뒀다가 겹침을 다 푼 뒤 튕겨낸다. 합쳐지는 중(calm)엔 튕기지 않는다.
        if (pass === 0 && a.calm <= 0 && b.calm <= 0) {
          const rn0 = ((b.x - b.px) - (a.x - a.px)) * nx + ((b.y - b.py) - (a.y - a.py)) * ny;
          if (rn0 < -BOUNCE_MIN) hits.push({ a, b, nx, ny, sep: -rn0 * bounceOf(Math.min(a.t, b.t)) });
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
      // 단, 이번 서브스텝에 세게 부딪힌 경우엔 들어온 속도의 일부를 반대로 돌려준다 (튕김).
      if (b.x - b.r < LEFT) {
        if (!b.bounceX && -b.vxIn > BOUNCE_MIN) b.bounceX = -b.vxIn * bounceOf(b.t);
        b.x = LEFT + b.r; b.px = b.x - b.bounceX;
      }
      if (b.x + b.r > RIGHT) {
        if (!b.bounceX && b.vxIn > BOUNCE_MIN) b.bounceX = -b.vxIn * bounceOf(b.t);
        b.x = RIGHT - b.r; b.px = b.x - b.bounceX;
      }
      if (b.y + b.r > FLOOR) {
        if (!b.bounceY && b.vIn > BOUNCE_MIN) b.bounceY = -b.vIn * bounceOf(b.t);
        // 위로 뜨던 중이면(합쳐져 뛰어오르며 커지는 과일) 그 속도는 살린다
        const up = Math.min(0, b.y - b.py);
        b.y = FLOOR - b.r;
        b.py = b.y - (b.bounceY || up);
        b.px += (b.x - b.px) * FLOOR_FRICTION;
      }
    }
  }

  // 부딪힌 두 과일이 서로 멀어지는 속도가 최소 sep 이 되게 한다 (무거운 쪽은 조금만 움직인다)
  for (const { a, b, nx, ny, sep } of hits) {
    if (a.dead || b.dead) continue;
    const rn = ((b.x - b.px) - (a.x - a.px)) * nx + ((b.y - b.py) - (a.y - a.py)) * ny;
    const k = sep - rn;
    if (k <= 0) continue;
    const ma = b.m / (a.m + b.m), mb = a.m / (a.m + b.m);
    a.px += nx * k * ma; a.py += ny * k * ma;
    b.px -= nx * k * mb; b.py -= ny * k * mb;
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
    // 떨어지던 속도를 그대로 이어받으면 새 과일이 더미에 부딪혀 튄다. 옆으로는 조금만 남긴다.
    f.px = x - ((a.x - a.px) + (b.x - b.px)) / 2 * MERGE_KEEP_V;
    // 위아래로는 떨어지던 속도 대신 살짝 뛰어오르게 한다
    f.py = y + mergeHopOf(f.t) * h;
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

// 과일 윗부분이 선 위에 멈춰 있는가 (막 떨어뜨린 과일과 아직 움직이는 과일은 빼고)
const aboveLine = (world) => world.bodies.some((b) => b.age > 1.2 && b.y - b.r < LINE_Y && Math.abs(b.y - b.py) < 1.5);
const randomFruit = (rand = Math.random) => Math.floor(rand() * DROPPABLE);

return { W, H, LEFT, RIGHT, FLOOR, BOX_TOP, LINE_Y, DROP_Y, FRUITS, SCORE, WATERMELON_PAIR, DROPPABLE, STEP, SUBSTEPS, makeFruit, stepWorld, aboveLine, randomFruit };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_SUIKA;
