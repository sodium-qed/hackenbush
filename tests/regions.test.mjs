import assert from 'node:assert/strict';
import test from 'node:test';
import { generateBoard } from '../dist/js/generator.js';
import { contourPath, findRegions } from '../dist/js/regions.js';

test('an enclosed lens hanging inside a glazed pane keeps its own two curved boundaries', () => {
  const points = [[0,0], [80,0], [80,80], [0,80], [40,24], [48,57]];
  const nodes = points.map(([x,y], i) => ({ id: `n${i}`, x, y }));
  const edges = [[0,1], [1,2], [2,3], [3,0]].map(([a,b], i) => ({
    id: 'pane' + i, a: 'n' + a, b: 'n' + b, part: 'glass roof',
  }));
  edges.push({ id: 'chain', a: 'n0', b: 'n4', part: 'planter chain' },
    { id: 'out', a: 'n4', b: 'n5', part: 'leaf', control: { x: 61, y: 39 } },
    { id: 'back', a: 'n4', b: 'n5', part: 'leaf', control: { x: 31, y: 50 } });
  const regions = findRegions({ nodes, edges });
  const pane = regions.find(region => region.material === 'glass');
  const leaf = regions.find(region => region.material === 'leaf');
  assert.equal(regions.length, 2);
  assert.deepEqual(new Set(pane.ids), new Set(['pane0', 'pane1', 'pane2', 'pane3']));
  assert.deepEqual(new Set(leaf.ids), new Set(['out', 'back']));
  assert.equal(pane.area, 6400);
  assert.match(contourPath(leaf.boundary), /Q61,39/);
  assert.match(contourPath(leaf.boundary), /Q31,50/);
  assert.equal(contourPath(leaf.boundary).match(/Q/g).length, 2);
});

test('legacy glasshouse fixtures and water-lily stamens stay independent of the pigment around them', () => {
  const board = generateBoard('A5FCDE', 'redblue', 'expert', 4);
  const regions = findRegions(board);
  for (const [kind, count] of [['glass',4], ['lily',3], ['pad',1], ['seeds',1], ['petal',4], ['silk',5]]) {
    assert.equal(regions.filter(region => region.material === kind).length, count, kind);
  }
  assert.ok(regions.every(region => region.boundary.every(({ edge }) =>
    !['planter chain', 'trailing plant', 'stamen', 'anchor silk', 'landmark stem'].includes(edge.part))));
  for (const region of regions) {
    assert.equal(region.ids.length, new Set(region.ids).size);
    assert.ok(region.boundary.every((segment, i, all) => segment.to === all[(i + 1) % all.length].from));
  }
});

test('the same petal edge metadata yields separate sunflower and water-lily pigments in procedural worlds', () => {
  const seen = new Set();
  for (const seed of ['000001', '00000A', '00000D', 'A35D7E']) {
    const board = generateBoard(seed, 'green', 'expert', 5);
    const regions = findRegions(board);
    assert.equal(regions.filter(region => region.material === 'seeds').length, board.world.flowers);
    for (const region of regions) {
      if (!region.boundary.some(({ edge }) => edge.part === 'petal')) continue;
      const expected = region.boundary[0].edge.feature === 'lily' ? 'lily' : 'petal';
      assert.equal(region.material, expected);
      seen.add(expected);
    }
  }
  assert.deepEqual([...seen].sort(), ['lily', 'petal']);
});
