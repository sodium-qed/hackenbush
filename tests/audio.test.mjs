import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudio } from '../dist/js/audio.js';

class Surface {
  listeners = new Map();
  attrs = new Map();
  style = { setProperty() {} };
  dataset = {};
  setAttribute(key, value) { this.attrs.set(key, value); }
  hasAttribute(key) { return this.attrs.has(key); }
  removeAttribute(key) { this.attrs.delete(key); }
  addEventListener(name, fn, { signal } = {}) {
    const list = this.listeners.get(name) || [];
    list.push({ fn, signal });
    this.listeners.set(name, list);
  }
  emit(name, data = {}) {
    for (const { fn, signal } of this.listeners.get(name) || []) {
      if (!signal?.aborted) fn({ type: name, target: this, ...data });
    }
  }
}

function fixture(t, { store = new Map(), blockedStorage = false, audio = true, holdResume = false } = {}) {
  let now = 50;
  let timerId = 0;
  const timers = new Map();
  const contexts = [];
  const view = new Surface();
  const doc = new Surface();
  doc.defaultView = view;
  view.navigator = { userActivation: { hasBeenActive: true } };
  view.performance = { now: () => now };
  view.setTimeout = fn => { timers.set(++timerId, fn); return timerId; };
  view.clearTimeout = id => timers.delete(id);
  Object.defineProperty(view, 'localStorage', { get() {
    if (blockedStorage) throw new Error('Storage disabled');
    return { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  } });
  function param() {
    return { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} };
  }
  if (audio) view.AudioContext = class extends Surface {
    state = holdResume ? 'suspended' : 'running';
    currentTime = 1;
    sampleRate = 24000;
    destination = {};
    started = [];
    constructor() { super(); contexts.push(this); }
    node(type) {
      const node = {
        type, gain: param(), frequency: param(), Q: param(), pan: param(), connected: false,
        connect() { this.connected = true; },
        disconnect() { this.connected = false; },
        start: (time = 0) => { node.startTime = time; this.started.push(node); },
        stop(time) { this.stopTime = time; }
      };
      return node;
    }
    createGain() { return this.node('gain'); }
    createOscillator() { return this.node('oscillator'); }
    createStereoPanner() { return this.node('stereo'); }
    createBufferSource() { return this.node('noise'); }
    createBiquadFilter() { return this.node('filter'); }
    createBuffer(count, length, rate) {
      return { duration: length / rate, getChannelData: () => new Float32Array(length) };
    }
    setState(value) { this.state = value; this.emit('statechange'); }
    resume() {
      if (holdResume) {
        this.pending ??= new Promise(resolve => { this.resolveResume = resolve; });
        return this.pending;
      }
      this.setState('running');
      return Promise.resolve();
    }
    finishResume() { this.setState('running'); this.resolveResume(); }
    suspend() { this.setState('suspended'); return Promise.resolve(); }
    close() { this.setState('closed'); return Promise.resolve(); }
  };
  const dialog = new Surface();
  const button = new Surface();
  const icon = new Surface();
  const controls = Object.fromEntries(['close', 'effects', 'ambience', 'volume', 'test', 'unavailable', 'reading'].map(name => [name, new Surface()]));
  dialog.id = 'sound-dialog';
  dialog.ownerDocument = doc;
  dialog.querySelector = selector => controls[selector.match(/"([a-z]+)"/)[1]];
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => { dialog.removeAttribute('open'); dialog.emit('close'); };
  button.querySelector = () => icon;
  const args = { button, dialog };
  const api = createAudio(args);
  t.after(() => api.destroy());
  return {
    api, args, contexts, controls, timers, doc, view, icon,
    gesture: () => doc.emit('keydown', { isTrusted: true, key: 'Enter' }),
    advance: ms => { now += ms; },
    toggle: (name, enabled) => { controls[name].checked = enabled; controls[name].emit('change'); },
    changeVisibility: hidden => { doc.hidden = hidden; doc.emit('visibilitychange'); },
    runBirdTimer() { const [[id, fn]] = timers; timers.delete(id); fn(); }
  };
}

test('trusted input unlocks sound once, then cuts scale with the detached mass and endings have distinct cadences', t => {
  const h = fixture(t);
  const { api } = h;
  assert.equal(createAudio(h.args), api);
  assert.equal(h.controls.effects.checked, true);
  assert.equal(h.controls.ambience.checked, false);
  h.doc.emit('click', { isTrusted: false });
  api.cut({ part: 'petal', fallen: 12 });
  api.end();
  assert.equal(h.contexts.length, 0);
  h.gesture();
  h.gesture();
  const [ctx] = h.contexts;
  assert.equal(h.contexts.length, 1);
  assert.equal(ctx.started.length, 0);
  assert.equal(h.timers.size, 0);
  const count = play => {
    const before = ctx.started.length;
    play();
    return ctx.started.length - before;
  };
  const bladeOnly = count(() => api.cut({ part: 'petal', fallen: 0 }));
  const littleFall = count(() => api.cut({ part: 'branch', fallen: 1 }));
  const bigFall = count(() => api.cut({ part: 'trunk', fallen: 42 }));
  assert.ok(bladeOnly > 0 && bladeOnly < littleFall && littleFall < bigFall);
  assert.equal(count(() => api.cut({ fallen: 10000 })), bigFall);
  assert.ok(count(() => api.reveal()) > 0);
  const timeout = count(() => api.end({ timedOut: true }));
  assert.ok(timeout > 0 && timeout < count(() => api.end({ timedOut: false })));
  for (const source of ctx.started) assert.ok(source.stopTime > source.startTime);
});

test('settings persist independently, and background audio stops on hide, cache parking, or teardown', async t => {
  const store = new Map();
  const h = fixture(t, { store });
  h.args.button.emit('click');
  assert.equal(h.args.button.attrs.get('aria-expanded'), 'true');
  h.controls.close.emit('click');
  assert.equal(h.args.button.attrs.get('aria-expanded'), 'false');
  h.gesture();
  h.toggle('ambience', true);
  h.toggle('effects', false);
  h.controls.volume.value = '41';
  h.controls.volume.emit('input');
  const [ctx] = h.contexts;
  assert.equal(h.controls.reading.textContent, '41%');
  assert.equal(h.controls.test.disabled, true);
  assert.equal(h.timers.size, 1);
  assert.equal(ctx.started.length, 2);
  h.api.cut({ fallen: 3 });
  h.runBirdTimer();
  assert.equal(ctx.started.length, 4);
  assert.equal(h.timers.size, 1);
  h.changeVisibility(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.state, 'suspended');
  assert.equal(h.timers.size, 0);
  assert.ok(ctx.started.every(node => !node.connected));
  h.api.reveal();
  h.changeVisibility(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.state, 'running');
  assert.equal(ctx.started.length, 6);
  h.changeVisibility(false);
  h.gesture();
  assert.equal(ctx.started.length, 6);
  h.view.emit('pagehide', { persisted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.state, 'suspended');
  h.view.emit('pageshow');
  assert.equal(ctx.state, 'running');
  assert.equal(h.timers.size, 1);
  h.api.destroy();
  h.api.end();
  h.gesture();
  assert.equal(ctx.state, 'closed');
  assert.equal(h.timers.size, 0);
  assert.ok(ctx.started.every(node => !node.connected));
  const fresh = fixture(t, { store });
  assert.equal(fresh.controls.ambience.checked, true);
  assert.equal(fresh.controls.effects.checked, false);
  assert.equal(fresh.controls.volume.value, '41');
  assert.equal(fresh.contexts.length, 0);
});

test('only timely cues from the visible, unmuted tab survive asynchronous gesture unlock', async t => {
  const h = fixture(t, { holdResume: true });
  h.gesture();
  h.api.reveal();
  h.advance(1600);
  h.api.cut({ fallen: 4 });
  h.toggle('effects', false);
  h.toggle('effects', true);
  h.api.end();
  h.changeVisibility(true);
  h.changeVisibility(false);
  h.api.cut({ part: 'petal' });
  const [ctx] = h.contexts;
  assert.equal(ctx.started.length, 0);
  ctx.finishResume();
  await new Promise(resolve => setImmediate(resolve));
  const onUnlock = ctx.started.length;
  h.api.cut({ part: 'petal' });
  assert.ok(onUnlock > 0);
  assert.equal(ctx.started.length, 2 * onUnlock);
  const delayed = fixture(t, { holdResume: true });
  delayed.gesture();
  delayed.api.reveal();
  delayed.advance(1000);
  delayed.contexts[0].finishResume();
  assert.equal(delayed.contexts[0].started.length, 0);
});

test('unavailable audio and blocked storage leave the game and settings usable', t => {
  const missing = fixture(t, { audio: false, blockedStorage: true });
  missing.gesture();
  missing.api.cut({ fallen: 5 });
  assert.equal(missing.controls.unavailable.hidden, false);
  assert.equal(missing.controls.effects.disabled, true);
  assert.equal(missing.icon.attrs.get('href'), '#i-muted');
  missing.args.button.emit('click');
  assert.equal(missing.args.dialog.hasAttribute('open'), true);
  const local = fixture(t, { blockedStorage: true });
  local.gesture();
  local.toggle('effects', false);
  assert.equal(local.controls.effects.checked, false);
  assert.equal(local.controls.test.disabled, true);
  assert.equal(local.icon.attrs.get('href'), '#i-muted');
});
