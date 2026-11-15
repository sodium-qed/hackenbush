import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_BOARD_VERSION, COLUMNS, ROWS, MAX_BRANCHES, MAX_TITLE, branchIssue, floatingBranches,
  isDrawing, pointName, readCustomBoard, readCustomDrawing, writeCustomBoard,
} from '../dist/js/custom-board.js';
import { initialEdges, cutEdge, legalMoves } from '../dist/js/rules.js';
import { createBuilder } from '../dist/js/builder.js';

const edge = (a, b, color = 'green') => ({ a, b, color });

test('a drawn loop is playable with either support, and falls when both are cut', () => {
  const edges = [edge(0, 9), edge(9, 19), edge(19, 11), edge(11, 9), edge(11, 2)];
  const code = writeCustomBoard('green', 'Seed arch', edges);
  const { variant, board } = readCustomBoard(code);
  assert.equal(CUSTOM_BOARD_VERSION, 6);
  assert.equal(variant, 'green');
  assert.equal(board.family, 'Seed arch');
  assert.equal(board.nodes.length, 5);
  assert.equal(board.edges.length, 5);
  assert.ok(board.nodes.every(n => n.x > 0 && n.x < 900 && n.y > 0 && n.y < board.height));
  assert.deepEqual(board.nodes.filter(n => n.y === board.groundY).map(n => n.id), ['n0', 'n2']);
  const roots = board.edges.filter(e => e.part === 'root');
  const live = initialEdges(board);
  assert.equal(live.length, 5);
  const first = cutEdge(board, live, roots[0].id, 'blue');
  assert.deepEqual(first.fallen, []);
  const second = cutEdge(board, first.live, roots[1].id, 'red');
  assert.deepEqual(second.live, []);
  assert.equal(second.fallen.length, 3);
});

test('codes fix branch identities and colors across drawing order, direction and independent readers', () => {
  const edges = [edge(4, 13, 'blue'), edge(5, 14, 'red')];
  const code = writeCustomBoard('redblue', 'Twin stems', edges);
  assert.equal(code, 'H6R0aVHdpbiBzdGVtcwENOF');
  assert.equal(writeCustomBoard('redblue', '  Twin  stems  ',
    edges.toReversed().map(({ a, b, color }) => edge(b, a, color))), code);
  const { board } = readCustomBoard(code);
  const blue = legalMoves(board, initialEdges(board), 'blue');
  const red = legalMoves(board, initialEdges(board), 'red');
  assert.deepEqual(blue, ['e0']);
  assert.deepEqual(red, ['e1']);
  assert.deepEqual(readCustomDrawing(code), { title: 'Twin stems', variant: 'redblue', edges });
  board.edges[0].color = 'red';
  assert.equal(readCustomBoard(code).board.edges[0].color, 'blue');
  assert.equal(readCustomBoard('H6G00EN').board.family, 'Custom garden');
});

test('new branches can share ends and form loops, while crossings, overlaps and ambiguous joints are rejected', () => {
  const diagonal = [edge(0, 20)];
  for (const [a, b] of [[0, 20], [20, 0], [0, 10], [10, 11], [1, 9], [2, 18]]) {
    assert.ok(branchIssue(diagonal, a, b), a + '/' + b);
  }
  for (const [a, b] of [[20, 30], [20, 18], [20, 21], [1, 2 + COLUMNS]]) {
    assert.equal(branchIssue(diagonal, a, b), '', a + '/' + b);
  }
  assert.ok(branchIssue([], 0, 2));
  assert.ok(branchIssue([], 0, 0));
  assert.ok(branchIssue([], 0, -1));
  assert.ok(branchIssue([], 0, COLUMNS * ROWS));
  assert.equal(pointName(0), 'A1');
  assert.equal(pointName(COLUMNS * ROWS - 1), 'I7');
});

test('a draft may contain floating branches and separate rooted plants, but only grounded drawings can be played', () => {
  const floating = [edge(0, 9), edge(10, 19), edge(19, 20), edge(2, 11)];
  assert.equal(isDrawing('green', floating), true);
  assert.deepEqual(floatingBranches(floating), new Set([1, 2]));
  assert.equal(writeCustomBoard('green', '', floating), null);
  const supported = [...floating, edge(1, 10)];
  assert.equal(floatingBranches(supported).size, 0);
  assert.equal(readCustomBoard(writeCustomBoard('green', '', supported)).board.edges.length, 5);
  assert.equal(writeCustomBoard('green', '', []), null);
  assert.equal(writeCustomBoard('blue', '', [edge(1, 10)]), null);
  assert.equal(writeCustomBoard('redblue', '', [edge(1, 10)]), null);
  assert.equal(writeCustomBoard('green', '', [edge(1, 10, 'red')]), null);
  assert.ok(writeCustomBoard('redblue', '', [edge(1, 10, 'red')]));
});

test('the largest colored drawing and multibyte title fit in share links and preserve every branch', () => {
  const edges = [];
  for (let p = 0; p < COLUMNS * (ROWS - 1); p++) {
    edges.push(edge(p, p + COLUMNS, p % 2 ? 'blue' : 'red'));
  }
  for (let col = 0; edges.length < MAX_BRANCHES; col++) edges.push(edge(COLUMNS + col, COLUMNS + col + 1, 'blue'));
  const title = '✿'.repeat(MAX_TITLE);
  const code = writeCustomBoard('redblue', title, edges);
  assert.match(code, /^[a-zA-Z0-9_-]+$/);
  assert.ok(code.length <= 256);
  const decoded = readCustomDrawing(code);
  assert.equal(decoded.title, title);
  assert.equal(decoded.edges.length, MAX_BRANCHES);
  assert.equal(writeCustomBoard(decoded.variant, decoded.title, decoded.edges), code);
  assert.equal(writeCustomBoard('redblue', title, [...edges, edge(17, 16, 'red')]), null);
  const unicode = 'Café 🌱';
  assert.equal(readCustomBoard(writeCustomBoard('green', unicode, [edge(4, 13)])).board.family, unicode);
});

test('malformed, floating and noncanonical drawings fail cleanly', () => {
  for (const code of [undefined, null, 6, {}, '', 'FA003A', 'H7G00EN', 'H6B00EN', 'H6G00',
    'H6G00E', 'H6G00NE', 'H6G00E_', 'H6G00EE', 'H6G00ENEN', 'H6G00AB', 'H6G00NW',
    'H6G00EN#', 'H6G00EN\n', 'H6R00OFEN', 'H6GzzAA', 'H6G01_zEN', 'H6G01IRBB', 'H6G00' + 'EN'.repeat(126)]) {
    assert.equal(readCustomBoard(code), null, String(code));
  }
});

// The editor uses a native dialog and a roving group of SVG buttons. This
// event surface lets the real handlers run when focus jumps directly between
// buttons, as it can with a screen reader, without adding DOM dependencies.
function editorSurface(t) {
  const doc = { activeElement: null };
  const stored = new Map();
  class Element {
    children = [];
    handlers = new Map();
    attrs = {};
    dataset = {};
    style = { setProperty() {} };
    classList = { toggle() {}, add() {} };
    ownerDocument = doc;
    value = '';
    get firstChild() { return this.children[0]; }
    get lastChild() { return this.children.at(-1); }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
      if (key.startsWith('data-')) this.dataset[key.slice(5)] = String(value);
    }
    append(...children) {
      this.children.push(...children);
      for (const child of children) child.parent = this;
    }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    contains(item) { return !!item && (this === item || this.children.some(child => child.contains(item))); }
    closest(selector) {
      return this.dataset[selector.slice(6, -1)] !== undefined ? this : this.parent?.closest(selector);
    }
    querySelector(selector) {
      const [, key, value] = selector.match(/^\[data-([\w-]+)="([^"]*)"\]$/);
      return this.find(el => el.dataset[key] === value);
    }
    find(check) {
      if (check(this)) return this;
      for (const child of this.children) { const found = child.find(check); if (found) return found; }
      return null;
    }
    getBoundingClientRect() { return { width: 300, height: 218 }; }
    addEventListener(type, handler) {
      const list = this.handlers.get(type) || [];
      list.push(handler); this.handlers.set(type, list);
    }
    fire(type, detail) {
      const event = { target: this, preventDefault() {}, ...detail };
      for (let el = this; el; el = el.parent) for (const handler of el.handlers.get(type) || []) handler(event);
    }
    focus() { if (doc.activeElement !== this) { doc.activeElement = this; this.fire('focusin'); } }
    showModal() { this.open = true; }
    close() { this.open = false; this.fire('close'); }
  }
  const install = (key, value) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  };
  doc.createElementNS = () => new Element();
  install('document', doc);
  install('ResizeObserver', class { observe() {} });
  install('localStorage', { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) });
  const dialog = new Element();
  const parts = new Map();
  const part = id => {
    if (!parts.has(id)) { const el = new Element(); parts.set(id, el); dialog.append(el); }
    return parts.get(id);
  };
  dialog.querySelector = selector => part(selector === 'h2' ? 'heading' : selector.match(/"([^"]+)"/)[1]);
  dialog.querySelectorAll = () => ['green', 'red', 'blue'].map(color => {
    const pen = part(color); pen.dataset.color = color; return pen;
  });
  const point = id => part('canvas').querySelector(`[data-point="${id}"]`);
  const branch = id => part('canvas').querySelector(`[data-branch="${id}"]`);
  const press = item => { item.focus(); item.fire('keydown', { key: 'Enter' }); };
  const applications = [];
  const builder = createBuilder(dialog, { onUse: (code, variant) => applications.push({ code, variant }) });
  return { builder, part, point, branch, press, applications };
}

test('direct SVG focus draws and erases the focused items, preserves drafts and applies the playable position', t => {
  const { builder, part, point, branch, press, applications } = editorSurface(t);
  builder.open('green');
  assert.equal(part('use').disabled, true);
  press(point(0));
  press(point(9));
  press(point(10));
  assert.equal(part('count').textContent, '2 branches');
  assert.equal(part('use').disabled, false);
  part('erase').fire('click');
  press(branch(1));
  assert.equal(part('count').textContent, '1 branch');
  assert.equal(part('use').disabled, false);
  part('undo').fire('click');
  part('clear').fire('click');
  assert.equal(part('use').disabled, true);
  part('undo').fire('click');
  part('name').value = 'Bedstead';
  part('name').fire('input');
  part('use').fire('click');
  const { code, variant } = applications[0];
  assert.equal(variant, 'green');
  assert.deepEqual(readCustomDrawing(code), { variant, title: 'Bedstead', edges: [edge(0, 9), edge(9, 10)] });
  builder.open('redblue');
  assert.equal(part('count').textContent, '0 branches');
  builder.open('green', code);
  assert.equal(part('name').value, 'Bedstead');
  press(point(22)); press(point(23));
  assert.equal(part('use').disabled, true);
  assert.match(part('validity').textContent, /1 branch needs a path/);
  part('close').fire('click');
  builder.open('green', code);
  assert.equal(part('count').textContent, '3 branches');
  assert.equal(part('use').disabled, true);
});
