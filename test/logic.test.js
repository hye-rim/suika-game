'use strict';
// 수박 게임 규칙·물리 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

function rng(seed) {                                   // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const run = (w, frames) => { const ev = []; for (let i = 0; i < frames; i++) ev.push(...L.stepWorld(w)); return ev; };
const speed = (b) => Math.hypot(b.x - b.px, b.y - b.py) / (L.STEP / L.SUBSTEPS);   // px/s
const inside = (b) => b.x - b.r >= L.LEFT - 1 && b.x + b.r <= L.RIGHT + 1 && b.y + b.r <= L.FLOOR + 1 && Number.isFinite(b.x) && Number.isFinite(b.y);

test('eleven fruits from cherry to watermelon, each bigger and worth more', () => {
  assert.strictEqual(L.FRUITS.length, 11);
  for (let t = 1; t < L.FRUITS.length; t++) {
    assert.ok(L.FRUITS[t].r > L.FRUITS[t - 1].r);
    assert.ok(L.SCORE[t] > L.SCORE[t - 1]);
  }
  assert.ok(L.FRUITS[10].r * 2 < L.RIGHT - L.LEFT, 'a watermelon fits in the box');
  const r = rng(1);
  for (let k = 0; k < 500; k++) { const t = L.randomFruit(r); assert.ok(t >= 0 && t < L.DROPPABLE); }
});

test('a dropped fruit falls, lands on the floor and comes to rest', () => {
  const w = { bodies: [L.makeFruit(4, 210, L.DROP_Y)] };
  run(w, 120);
  const b = w.bodies[0];
  assert.ok(Math.abs(b.y + b.r - L.FLOOR) < 0.5, 'on the floor');
  assert.ok(speed(b) < 1, 'still');
});

test('two of the same fruit merge into the next one and score it; different fruits do not', () => {
  for (let t = 0; t < 10; t++) {
    const w = { bodies: [L.makeFruit(t, 200, L.FLOOR - L.FRUITS[t].r)] };
    run(w, 30);
    w.bodies.push(L.makeFruit(t, 202, L.DROP_Y));
    const ev = run(w, 120);
    const merges = ev.filter((e) => e.type === 'merge');
    assert.strictEqual(merges.length, 1, 'fruit ' + t);
    assert.strictEqual(merges[0].t, t + 1);
    assert.strictEqual(merges[0].score, L.SCORE[t + 1]);
    assert.strictEqual(w.bodies.length, 1);
    assert.strictEqual(w.bodies[0].t, t + 1);
    run(w, 60);
    assert.strictEqual(w.bodies[0].r, L.FRUITS[t + 1].r, 'grown to full size');
  }
  const mix = { bodies: [L.makeFruit(2, 200, L.FLOOR - 25), L.makeFruit(3, 201, L.DROP_Y)] };
  assert.deepStrictEqual(run(mix, 120), []);
  assert.strictEqual(mix.bodies.length, 2);
});

test('two watermelons vanish with a bonus', () => {
  const w = { bodies: [L.makeFruit(10, 150, L.FLOOR - 100), L.makeFruit(10, 250, L.FLOOR - 100)] };
  w.bodies[1].x = w.bodies[1].px = 150 + 199;
  const ev = run(w, 30);
  assert.deepStrictEqual(ev.map((e) => [e.type, e.score]), [['melons', L.WATERMELON_PAIR]]);
  assert.strictEqual(w.bodies.length, 0);
});

test('hundreds of random drops: fruits stay in the box, merges keep the count right, the pile settles', () => {
  for (const seed of [1, 2, 3]) {
    const r = rng(seed);
    const w = { bodies: [] };
    let dropped = 0, merges = 0, melons = 0;
    for (let d = 0; d < 150; d++) {
      const t = L.randomFruit(r);
      w.bodies.push(L.makeFruit(t, L.LEFT + L.FRUITS[t].r + r() * (L.RIGHT - L.LEFT - 2 * L.FRUITS[t].r), L.DROP_Y));
      dropped++;
      for (const e of run(w, 30)) { if (e.type === 'merge') merges++; else melons++; }
      for (const b of w.bodies) assert.ok(inside(b), `seed ${seed} drop ${d}: fruit ${b.t} at ${b.x.toFixed(1)},${b.y.toFixed(1)}`);
      assert.strictEqual(w.bodies.length, dropped - merges - 2 * melons);
      if (L.aboveLine(w)) break;
    }
    // 쌓인 더미 안에서 합치기가 연쇄로 이어질 수 있으니, 합치기가 2초 동안 없을 때까지 기다린 뒤 본다
    for (let quiet = 0, t = 0; quiet < 120 && t < 60 * 30; t++) quiet = L.stepWorld(w).length ? 0 : quiet + 1;
    const moving = w.bodies.filter((b) => speed(b) > 20);
    assert.strictEqual(moving.length, 0, `seed ${seed}: the pile comes to rest (${moving.length} still moving)`);
    assert.ok(merges > 20);
  }
});

test('the danger line: a resting fruit above it counts, a falling one does not', () => {
  const w = { bodies: [L.makeFruit(0, 200, L.LINE_Y - 30)] };
  w.bodies[0].age = 2;
  assert.ok(L.aboveLine(w), 'a still fruit above the line');
  w.bodies[0].py = w.bodies[0].y - 5;
  assert.ok(!L.aboveLine(w), 'moving fast: just passing through');
  const fresh = { bodies: [L.makeFruit(0, 200, L.LINE_Y - 30)] };
  assert.ok(!L.aboveLine(fresh), 'just dropped');
});

test('stacking big fruits in one column eventually crosses the line', () => {
  const w = { bodies: [] };
  let crossed = false;
  for (let d = 0; d < 40 && !crossed; d++) {
    w.bodies.push(L.makeFruit(d % 2 ? 4 : 3, 210, L.DROP_Y));     // 한라봉·감을 번갈아 (합쳐지지 않게)
    run(w, 90);
    crossed = L.aboveLine(w);
  }
  assert.ok(crossed);
});
