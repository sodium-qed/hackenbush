import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoard } from '../dist/js/board.js';
import { generateBoard } from '../dist/js/generator.js';
import { cutEdge } from '../dist/js/rules.js';

// A small SVG event surface keeps the production-coordinate and keyboard
// checks runnable with the same dependency-free Node test suite as the game.
function surface(t) {
  const bounds = { left: 0, top: 0, width: 900, height: 340 };
  let resize;
  class Element {
    children = [];
    attrs = {};
    handlers = new Map();
    style = { setProperty() {} };
    classList = { toggle: (token, enabled) => {
      const list = new Set((this.attrs.class ?? '').split(' ').filter(Boolean));
      if (enabled) list.add(token);
      else list.delete(token);
      this.attrs.class = [...list].join(' ');
    } };
    constructor(tag) { this.tag = tag; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    removeAttribute(key) { delete this.attrs[key]; }
    append(...children) { this.children.push(...children); for (const child of children) child.parent = this; }
    replaceChildren() { this.children = []; }
    cloneNode() { const copy = new Element(this.tag); copy.attrs = { ...this.attrs }; return copy; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    descendants() { return [this, ...this.children.flatMap(child => child.descendants())]; }
    contains(element) { return this.descendants().includes(element); }
    closest(selector) { return selector === '[data-edge-id]' && this.attrs['data-edge-id'] ? this : this.parent?.closest(selector); }
    matches() { return true; }
    focus() { document.activeElement = this; this.emit('focusin'); }
    getBoundingClientRect() { return bounds; }
    addEventListener(name, handler) { this.handlers.set(name, handler); }
    emit(name, values = {}) {
      const event = { target: this, detail: 1, button: 0, isPrimary: true, preventDefault() {}, ...values };
      for (let el = this; el; el = el.parent) el.handlers.get(name)?.(event);
    }
  }
  globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), activeElement: null };
  globalThis.window = { setTimeout, clearTimeout, matchMedia: () => ({ matches: false }) };
  globalThis.ResizeObserver = class { constructor(cb) { resize = cb; } observe() {} disconnect() {} };
  t.after(() => { delete globalThis.document; delete globalThis.window; delete globalThis.ResizeObserver; });
  return { root: new Element('div'), bounds, resize: () => resize() };
}

test('bowed edges retain distinct ink, picking, markers and motion through a phone projection', t => {
  const { root, bounds, resize } = surface(t);
  const cuts = [];
  const renderer = createBoard(root, { onCut: id => cuts.push(id) });
  try {
    const board = {
      height: 340, groundY: 314,
      nodes: [{ id: 'ground', x: 450, y: 314, ground: true }, { id: 'a', x: 450, y: 236 }, { id: 'b', x: 450, y: 64 }],
      edges: [
        { id: 'stem', a: 'ground', b: 'a', color: 'green' },
        { id: 'left', a: 'a', b: 'b', control: { x: 225, y: 150 }, color: 'blue' },
        { id: 'right', a: 'a', b: 'b', control: { x: 675, y: 150 }, color: 'red' }
      ]
    };
    const live = board.edges.map(edge => edge.id);
    const update = (changes = {}) => renderer.update({ board, live, side: 'blue', ...changes });
    const all = () => root.descendants();
    const classed = name => all().filter(el => el.attrs.class?.split(' ').includes(name));
    const edge = id => all().find(el => el.attrs['data-edge-id'] === id);
    const ink = id => edge(id).children.find(el => el.attrs.class === 'hb-field__stem').attrs.d;
    const svg = all().find(el => el.tag === 'svg');
    const point = (x, y, pointerType = 'mouse') => ({ clientX: x, clientY: y, pointerType });
    update({ hintId: 'left' });
    assert.equal(svg.attrs.viewBox, '0 0 900 340');
    assert.match(classed('hb-field__ground-line')[0].attrs.d, /,314H/);
    assert.equal(ink('left'), 'M450,236Q225,150 450,64');
    assert.equal(ink('stem'), 'M450,314L450,236');
    for (const cls of ['hb-field__hit', 'hb-field__halo']) {
      assert.equal(edge('left').children.find(el => el.attrs.class === cls).attrs.d, ink('left'));
    }
    assert.equal(classed('hb-field__edge--hint')[0], edge('left'));
    const stripeInk = edge('left').children.find(el => el.attrs.class === 'hb-field__stripes').attrs.d;
    assert.equal(stripeInk.split('M').length - 1, 2);
    assert.ok(stripeInk.match(/-?[\d.]+/g).map(Number).filter((_, i) => i % 2 === 0).every(x => Math.abs(x - 337.5) < 2.5));
    svg.emit('pointermove', point(337.5, 150));
    assert.equal(classed('hb-field__edge--target')[0], edge('left'));
    assert.equal(classed('hb-field__joint--target').length, 2);
    assert.equal(classed('hb-field__edge--falling').length, 0);
    const marker = classed('hb-field__scissors')[0].attrs.transform.match(/translate\(([^ ]+) ([^)]+)\)/);
    assert.ok(Math.abs(Number(marker[1]) - 337.5) < 0.001 && Math.abs(Number(marker[2]) - 150) < 0.001);
    svg.emit('click', point(337.5, 150));
    svg.emit('click', point(450, 150)); // Empty space between the two arcs.
    svg.emit('click', point(562.5, 150)); // Red is unavailable to blue.
    assert.deepEqual(cuts, ['left']);
    edge('left').focus();
    edge('left').emit('keydown', { key: 'Enter' });
    assert.deepEqual(cuts, ['left', 'left']);
    const viewport = { scrollLeft: 0, scrollTop: 12, scrollWidth: 900, clientWidth: 320,
      getBoundingClientRect: () => ({ left: 0, right: 320, width: 320 }) };
    root.closest = selector => selector === '.board-scroll' ? viewport : null;
    update();
    assert.equal(viewport.scrollLeft, 0);
    edge('left').emit('keydown', { key: 'ArrowRight' });
    assert.ok(viewport.scrollLeft > 0);
    assert.equal(viewport.scrollTop, 12);
    update({ side: 'red' });
    svg.emit('click', point(562.5, 150));
    assert.deepEqual(cuts, ['left', 'left', 'right']);

    const move = cutEdge(board, live, 'left', 'blue');
    update({ live: move.live, side: 'red', cutId: 'left', removed: move.fallen });
    assert.equal(classed('hb-field__snip').length, 2);
    for (const part of classed('hb-field__snip')) assert.match(part.children[0].attrs.d, /Q/);
    update({ reset: true });
    svg.emit('pointermove', point(450, 275));
    assert.equal(classed('hb-field__edge--falling').length, 2);
    update({ live: [], side: 'red', cutId: 'stem', removed: ['left', 'right'] });
    const ghostInk = classed('hb-field__fall')[0].descendants().filter(el => el.attrs.class === 'hb-field__stem');
    assert.deepEqual(ghostInk.map(el => el.attrs.d).sort(), [ink('left'), ink('right')].sort());

    update({ reset: true });
    bounds.width = 360; bounds.height = 264; resize();
    const [, , fitted, height] = svg.attrs.viewBox.split(' ').map(Number);
    const [ax, ay, cx, cy, bx, by] = ink('left').match(/-?[\d.]+/g).map(Number);
    const touch = point((ax + 2 * cx + bx) / 4 * bounds.width / fitted, (ay + 2 * cy + by) / 4 * bounds.height / height, 'touch');
    svg.emit('pointerdown', touch);
    assert.equal(classed('hb-field__edge--target')[0], edge('left'));
    svg.emit('click', touch);
    assert.equal(cuts.at(-1), 'left');
    const edited = { ...board, edges: board.edges.map(e => e.id === 'left' ? { ...e, control: { x: 180, y: 150 } } : e) };
    const oldInk = ink('left');
    update({ board: edited });
    assert.notEqual(ink('left'), oldInk);
  } finally {
    renderer.destroy();
  }
});

test('every branch in the Expert opening can be selected at its actual drawn midpoint', t => {
  const { root, bounds, resize } = surface(t);
  let selected = null;
  const renderer = createBoard(root, { onCut: id => { selected = id; } });
  try {
    const board = generateBoard('GROVE7', 'redblue', 'expert', 3);
    const live = board.edges.map(edge => edge.id);
    assert.equal(board.groundY, 314);
    assert.ok(live.length >= 82);
    const svg = root.descendants().find(el => el.tag === 'svg');
    for (const [screenWidth, screenHeight] of [[900, 340], [750, 283], [360, 222]]) {
      Object.assign(bounds, { width: screenWidth, height: screenHeight });
      resize();
      for (const side of ['blue', 'red']) {
        renderer.update({ board, live, side });
        const [, , width, height] = svg.attrs.viewBox.split(' ').map(Number);
        const legal = root.descendants().filter(el => el.attrs['data-edge-id'] && el.attrs['aria-disabled'] === 'false');
        for (const branch of legal) {
          const d = branch.children.find(el => el.attrs.class?.split(' ').includes('hb-field__stem')).attrs.d;
          const [ax, ay, x, y, bx, by] = d.match(/-?[\d.]+/g).map(Number);
          const mx = d.includes('Q') ? (ax + 2 * x + bx) / 4 : (ax + x) / 2;
          const my = d.includes('Q') ? (ay + 2 * y + by) / 4 : (ay + y) / 2;
          svg.emit('click', { clientX: mx * screenWidth / width, clientY: my * screenHeight / height, pointerType: screenWidth > 400 ? 'mouse' : 'touch' });
          assert.equal(selected, branch.attrs['data-edge-id'], branch.attrs['aria-label']);
          selected = null;
        }
      }
    }
  } finally {
    renderer.destroy();
  }
});
