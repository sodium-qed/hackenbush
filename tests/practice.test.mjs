import test from 'node:test';
import assert from 'node:assert/strict';
import { practiceSunflower as flower } from '../dist/js/practice.js';
import { findRegions } from '../dist/js/regions.js';
import { cutEdge, initialEdges } from '../dist/js/rules.js';

test('each practice petal opens independently around a single, grounded seed disk', () => {
  const regions = findRegions(flower);
  const petals = regions.filter(region => region.material === 'petal');
  assert.equal(petals.length, 11);
  assert.equal(regions.filter(region => region.material === 'seeds').length, 1);
  assert.equal(regions.filter(region => region.material === 'leaf').length, 2);
  const live = initialEdges(flower);
  assert.equal(live.length, flower.edges.length);
  for (const petal of petals) {
    assert.equal(petal.ids.length, 3);
    const edge = petal.boundary.find(step => step.edge.part === 'petal').edge;
    const cut = cutEdge(flower, live, edge.id, 'green');
    assert.deepEqual(cut.fallen, []);
    assert.deepEqual(regions.filter(region => region.ids.some(id => !cut.live.includes(id))), [petal]);
  }
});

test('cutting the sunflower stem drops the head while the leaf stays rooted', () => {
  const live = initialEdges(flower);
  const cut = cutEdge(flower, live, 'stem', 'green');
  const head = flower.edges.filter(edge => ['petal', 'flower center'].includes(edge.part));
  assert.deepEqual(new Set(cut.fallen), new Set(head.map(edge => edge.id)));
  assert.deepEqual(new Set(cut.live), new Set(['root', 'leaf-upper', 'leaf-lower', 'leaf-vein']));
  assert.deepEqual(cutEdge(flower, cut.live, 'root', 'green').live, []);
  assert.deepEqual(initialEdges(flower), live);
});
