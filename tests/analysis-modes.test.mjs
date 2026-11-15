import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { analysisModes, intersectProof, recentCache } from '../dist/js/analysis-modes.js';
import { cachedDailyWinner, dailyOpening } from '../dist/js/daily.js';
import { generateBoard } from '../dist/js/generator.js';
import { initialEdges } from '../dist/js/rules.js';

function startWorker(t) {
  // Use the shipped worker entry and structured-clone boundary. Node provides
  // the thread; this adapter supplies the two browser worker event methods.
  const url = new URL('../dist/js/analysis-worker.js', import.meta.url);
  const source = `
    import { parentPort } from 'node:worker_threads';
    globalThis.self = { postMessage: data => parentPort.postMessage(data) };
    await import(${JSON.stringify(url.href)});
    parentPort.on('message', data => self.onmessage({ data }));
  `;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(source)));
  t.after(() => worker.terminate());
  return worker;
}

function request(worker, id, board, position, onUpdate) {
  return new Promise((resolve, reject) => {
    const updates = [];
    function finish(error) {
      worker.off('message', handler);
      worker.off('error', fail);
      if (error) reject(error);
      else resolve(updates);
    }
    function fail(error) { finish(error); }
    function handler(event) {
      if (event.id !== id) return;
      if (event.type === 'error') finish(new Error('Worker analysis failed.'));
      if (event.type === 'done' || event.type === 'cancelled') finish();
      if (event.type === 'update') {
        updates.push(event);
        onUpdate?.(event);
      }
    }
    worker.on('message', handler);
    worker.once('error', fail);
    worker.postMessage({ type: 'start', id, board, variant: position.variant || 'redblue', positions: [position] });
  });
}

function compare(a, b) {
  const [p, q = 1n] = a.split('/').map(BigInt);
  const [r, s = 1n] = b.split('/').map(BigInt);
  return p * s - r * q;
}

test('serialized certificates intersect exact dyadics and retain strict endpoints and winners', () => {
  const d = 2n ** 85n;
  const lo = (d + 1n) + '/' + d;
  const previous = { kind: 'redblue', exact: false, lower: lo, upper: '6', lowerOpen: true, upperOpen: false,
    winner: 'blue', nimber: 0 };
  const fresh = { ...previous, lower: '1', upper: '2', lowerOpen: false, upperOpen: true, winner: null, nodes: 5 };
  const combined = intersectProof(previous, fresh, 'red');
  assert.deepEqual(combined, { ...fresh, lower: lo, lowerOpen: true, winner: 'blue' });
  assert.equal(intersectProof(combined, { ...combined, upperOpen: false }, 'red').upperOpen, true);
  assert.throws(() => intersectProof(previous, { ...fresh, upper: '1' }, 'red'), /Disjoint/);
  assert.throws(() => intersectProof(previous, { ...fresh, exact: true, number: lo }, 'red'), /outside/);
  const fixed = intersectProof({ ...previous, lower: '0', lowerOpen: false, winner: null },
    { ...fresh, lower: '-2', upper: '0', upperOpen: false }, 'red');
  assert.equal(fixed.exact, true);
  assert.equal(fixed.number, '0');
  assert.equal(fixed.winner, 'blue');
});

test('bounded result caches evict the least recently used entry', () => {
  const cache = recentCache(2);
  cache.set('first', 1);
  cache.set('second', 2);
  assert.equal(cache.get('first'), 1);
  cache.set('third', 3);
  assert.equal(cache.get('second'), undefined);
  assert.equal(cache.get('first'), 1);
  assert.equal(cache.get('third'), 3);
});

test('the daily opening proof only matches the same ground, colors, turn and seed', () => {
  const seed = 'DAILY-04-16-2026';
  const { variant, firstSide, humanSide } = dailyOpening(seed);
  const board = generateBoard(seed, variant, 'expert', 7);
  assert.equal(cachedDailyWinner(seed, board, variant, firstSide), humanSide);
  assert.equal(cachedDailyWinner(seed, board, variant, firstSide === 'blue' ? 'red' : 'blue'), null);
  assert.equal(cachedDailyWinner('DAILY-04-17-2026', board, variant, firstSide), null);
  const forged = structuredClone(board);
  forged.edges[0].color = forged.edges[0].color === 'blue' ? 'red' : 'blue';
  assert.equal(cachedDailyWinner(seed, forged, variant, firstSide), null);
  const moved = structuredClone(board);
  moved.nodes[0].ground = !moved.nodes[0].ground;
  assert.equal(cachedDailyWinner(seed, moved, variant, firstSide), null);
});

test('Quick streams the structural certificate, enforces its caps and reuses completed proof and cut work', {timeout: 12000}, async t => {
  const worker = startWorker(t);
  const board = generateBoard('A35D7E', 'redblue', 'expert', 5);
  const position = { key: 'map/blue', index: 0, live: initialEdges(board), side: 'blue', mode: 'quick', assessCuts: true };
  const updates = await request(worker, 1, board, position);
  assert.ok(updates.length >= 2);
  const first = updates[0].result, last = updates.at(-1);
  assert.equal(first.exact, false);
  assert.equal(first.nodes, 0);
  assert.equal(last.phase, 'finished');
  assert.ok(['time-limit', 'node-limit', 'exact'].includes(last.reason));
  assert.ok(last.result.nodes <= analysisModes.quick.nodeLimit);
  if (last.reason === 'time-limit') assert.ok(last.result.durationMs >= analysisModes.quick.budgetMs);
  if (last.reason === 'node-limit') assert.equal(last.result.nodes, analysisModes.quick.nodeLimit);
  assert.ok(last.difficulty.effort.nodes <= analysisModes.quick.cuts.nodeLimit);
  for (let i = 1; i < updates.length; i++) {
    const before = updates[i - 1].result, after = updates[i].result;
    assert.ok(after.nodes >= before.nodes);
    assert.ok(after.durationMs >= before.durationMs);
    if (before.lower !== undefined) {
      assert.ok(compare(after.number ?? after.lower, before.lower) >= 0n);
      assert.ok(compare(after.number ?? after.upper, before.upper) <= 0n);
    }
    if (before.winner) assert.equal(after.winner, before.winner);
  }
  const again = await request(worker, 2, board, { ...position, cached: last });
  assert.equal(again.length, 1);
  assert.deepEqual(again[0].result, last.result);
  assert.deepEqual(again[0].difficulty, last.difficulty);
});

test('Research can stop between slices and an exact position can replace it on the same worker', {timeout: 12000}, async t => {
  const worker = startWorker(t);
  const board = generateBoard('A35D7E', 'redblue', 'expert', 5);
  const position = { key: 'hard', index: 0, live: initialEdges(board), side: 'blue', mode: 'research', assessCuts: false };
  const events = [];
  worker.on('message', data => events.push(data));
  let requested = false;
  const before = await request(worker, 10, board, position, event => {
    if (!requested && event.phase === 'searching') {
      requested = true;
      worker.postMessage({ type: 'cancel', id: 10 });
    }
  });
  assert.ok(requested);
  assert.ok(before.some(event => event.result.lower !== undefined));
  const other = { key: 'empty', index: 3, live: [], side: 'red', mode: 'deep', assessCuts: true };
  const replacement = await request(worker, 11, board, other);
  assert.equal(replacement.at(-1).result.number, '0');
  assert.equal(replacement.at(-1).result.winner, 'blue');
  assert.equal(replacement.at(-1).difficulty.legalMoves, 0);
  const cancelledAt = events.findIndex(event => event.id === 10 && event.type === 'cancelled');
  assert.ok(cancelledAt >= 0);
  assert.ok(events.slice(cancelledAt + 1).every(event => event.id !== 10));
});
