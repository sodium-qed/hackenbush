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
    return {
      setValueAtTime(value) { this.start = value; },
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime(value) { this.end = value; },
      setTargetAtTime() {}
    };
  }
  if (audio) view.AudioContext = class extends Surface {
    state = holdResume ? 'suspended' : 'running';
    currentTime = 1;
    sampleRate = 24000;
    destination = {};
    started = [];
    nodes = [];
    constructor() { super(); contexts.push(this); }
    node(type) {
      const node = {
        kind: type, gain: param(), frequency: param(), Q: param(), pan: param(), connected: false,
        connect() { this.connected = true; },
        disconnect() { this.connected = false; },
        start: (time = 0) => { node.startTime = time; this.started.push(node); },
        stop(time) { this.stopTime = time; }
      };
      this.nodes.push(node);
      return node;
    }
    createGain() { return this.node('gain'); }
    createDynamicsCompressor() {
      const node = this.node('compressor');
      for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = param();
      return node;
    }
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
  const controls = Object.fromEntries(['close', 'effects', 'ambience', 'volume', 'sample', 'test', 'unavailable', 'reading'].map(name => [name, new Surface()]));
  controls.sample.value = 'leaf';
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

test('cuts use the material of the board part and keep its location intelligible in stereo and mono', t => {
  const h = fixture(t);
  h.gesture();
  const [ctx] = h.contexts;
  function cut(part, position) {
    const before = ctx.started.length;
    h.api.cut({ part, position });
    const sources = ctx.started.slice(before);
    const tones = sources.filter(node => node.kind === 'oscillator');
    const duration = Math.max(...sources.map(node => node.stopTime)) - Math.min(...sources.map(node => node.startTime));
    return { tones, duration, pan: ctx.nodes.filter(node => node.kind === 'stereo').at(-1)?.pan.value };
  }
  const leaf = cut('bamboo leaf margin', -1);
  const wood = cut('paddle');
  const glass = cut('glass roof', 4);
  const stone = cut('rock seam');
  const metal = cut('suspension cable');
  assert.equal(leaf.tones.length, 0);
  assert.ok(wood.tones.length && wood.tones[0].frequency.end / wood.tones[0].frequency.start < .8);
  assert.ok(stone.tones.length > wood.tones.length && stone.duration < .2);
  assert.ok(glass.duration > .4 && glass.tones.every(note => note.frequency.end / note.frequency.start > .98));
  assert.ok(metal.duration > glass.duration && metal.tones[0].frequency.start < glass.tones[0].frequency.start * .6);
  assert.ok(leaf.pan < 0 && leaf.pan > -.75);
  assert.equal(wood.pan, 0);
  assert.equal(glass.pan, -leaf.pan);
  for (const source of ctx.started) source.onended?.();
  assert.deepEqual(ctx.nodes.filter(node => node.connected).map(node => node.kind), ['gain', 'compressor']);
  ctx.createStereoPanner = undefined;
  assert.equal(cut('glasshouse foundation', .8).tones.length, stone.tones.length);
});

test('previews play only on request, replace each other and leave live match cues audible', t => {
  const h = fixture(t);
  h.gesture();
  const [ctx] = h.contexts;
  h.args.button.emit('click');
  h.controls.sample.value = 'glass';
  h.controls.sample.emit('change');
  assert.equal(ctx.started.length, 0);
  h.controls.test.emit('click');
  const glass = ctx.started.slice();
  h.api.reveal();
  const reveal = ctx.started.slice(glass.length);
  const stops = reveal.map(source => source.stopTime);
  h.controls.sample.value = 'cascade';
  h.controls.test.emit('click');
  assert.ok(glass.every(source => source.stopTime <= ctx.currentTime + .03));
  assert.deepEqual(reveal.map(source => source.stopTime), stops);
  const falling = ctx.started.slice(glass.length + reveal.length);
  assert.ok(falling.some(source => source.startTime > ctx.currentTime + .3));
  h.controls.close.emit('click');
  assert.ok(falling.every(source => source.stopTime <= ctx.currentTime + .03));
  assert.deepEqual(reveal.map(source => source.stopTime), stops);
  h.controls.volume.value = '0';
  h.controls.volume.emit('input');
  assert.equal(h.controls.test.disabled, true);
  const before = ctx.started.length;
  h.controls.test.emit('click');
  assert.equal(ctx.started.length, before);
});

test('the win arpeggio follows the last landing and rapid cuts keep active voices bounded', t => {
  const h = fixture(t);
  h.gesture();
  const [ctx] = h.contexts;
  h.api.cut({ part: 'trunk', fallen: 40 });
  const lastDebris = Math.max(...ctx.started.filter(node => node.kind === 'oscillator').map(node => node.startTime));
  const before = ctx.started.length;
  h.api.end();
  assert.ok(Math.min(...ctx.started.slice(before).map(node => node.startTime)) > lastDebris + .1);
  for (let i = 0; i < 22; i++) h.api.cut({ part: 'stone arch', fallen: 50, position: .9 });
  assert.ok(ctx.nodes.filter(node => node.kind === 'stereo' && node.connected).length <= 12);
  h.api.destroy();
  assert.ok(ctx.nodes.every(node => !node.connected));
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
