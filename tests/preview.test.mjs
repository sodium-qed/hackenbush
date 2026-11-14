import assert from 'node:assert/strict';
import test from 'node:test';
import { timeBoardPreview } from '../dist/js/preview.js';

test('the preview covers the board at two seconds and only once', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  timeBoardPreview(value => events.push(value), () => events.push('covered'));
  assert.deepEqual(events, [2]);
  context.mock.timers.tick(1999);
  assert.deepEqual(events, [2, 1]);
  context.mock.timers.tick(1);
  context.mock.timers.tick(5000);
  assert.deepEqual(events, [2, 1, 'covered']);
});

test('leaving the preview cancels both callbacks', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const cancel = timeBoardPreview(value => events.push(value), () => events.push('covered'));
  cancel();
  context.mock.timers.tick(8000);
  assert.deepEqual(events, [2]);
});
