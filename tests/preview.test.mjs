import assert from 'node:assert/strict';
import test from 'node:test';
import { timeBoardPreview } from '../dist/js/preview.js';

test('the opening look ends exactly at two seconds and starts play once', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  timeBoardPreview(value => events.push(value), () => events.push('play'));
  assert.deepEqual(events, [2]);
  context.mock.timers.tick(1999);
  assert.deepEqual(events, [2, 1]);
  context.mock.timers.tick(1);
  context.mock.timers.tick(5000);
  assert.deepEqual(events, [2, 1, 'play']);
});

test('leaving the preview cancels both callbacks', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const cancel = timeBoardPreview(value => events.push(value), () => events.push('play'));
  cancel();
  context.mock.timers.tick(8000);
  assert.deepEqual(events, [2]);
});

test('refreshing with 240 ms left preserves the opening deadline', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  timeBoardPreview(value => events.push(value), () => events.push('play'), 240);
  context.mock.timers.tick(239);
  assert.deepEqual(events, [1]);
  context.mock.timers.tick(1);
  assert.deepEqual(events, [1, 'play']);
});
