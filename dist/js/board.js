import { cutEdge, legalMoves } from './rules.js';
import { createRegionArt } from './region-art.js';

const NS = 'http://www.w3.org/2000/svg';
const WIDTH = 900;
const HEIGHT = 270;
const GROUND = 244;
let instanceNumber = 0;

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function linePath(a, b) {
  return `M${a.x},${a.y}L${b.x},${b.y}`;
}

function between(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pathFor(a, b, control) {
  return control ? `M${a.x},${a.y}Q${control.x},${control.y} ${b.x},${b.y}` : linePath(a, b);
}

function pointAt({ a, b, control }, t) {
  if (!control) return between(a, b, t);
  return between(between(a, control, t), between(control, b, t), t);
}

function tangentAt({ a, b, control }, t) {
  if (!control) return { x: b.x - a.x, y: b.y - a.y };
  return {
    x: 2 * ((1 - t) * (control.x - a.x) + t * (b.x - control.x)),
    y: 2 * ((1 - t) * (control.y - a.y) + t * (b.y - control.y))
  };
}

function extent(a, b, control) {
  let low = Math.min(a, b);
  let high = Math.max(a, b);
  if (control !== undefined) {
    const t = (a - control) / (a - 2 * control + b);
    if (t > 0 && t < 1) {
      const at = (1 - t) ** 2 * a + 2 * (1 - t) * t * control + t ** 2 * b;
      low = Math.min(low, at);
      high = Math.max(high, at);
    }
  }
  return [low, high];
}

// A quadratic's maximum deviation from its chord is bounded by its
// midpoint offset. Splitting it into n equal intervals divides that bound
// by n². Cache a subpixel polyline for picking and distances along the ink.
function traceBranch(a, b, control) {
  const chord = between(a, b, 0.5);
  const bend = control ? Math.hypot(control.x - chord.x, control.y - chord.y) / 2 : 0;
  const count = Math.max(1, Math.ceil(Math.sqrt(bend / 0.18)));
  const shape = { a, b, control, path: pathFor(a, b, control), samples: [{ ...a, t: 0, along: 0 }], length: 0 };
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const point = pointAt(shape, t);
    const previous = shape.samples[i - 1];
    shape.length += Math.hypot(point.x - previous.x, point.y - previous.y);
    shape.samples.push({ ...point, t, along: shape.length });
  }
  [shape.left, shape.right] = extent(a.x, b.x, control?.x);
  [shape.top, shape.bottom] = extent(a.y, b.y, control?.y);
  return shape;
}

function parameterAtLength(shape, distance) {
  const at = Math.min(shape.length, Math.max(0, distance));
  for (let i = 1; i < shape.samples.length; i++) {
    const sample = shape.samples[i];
    if (at > sample.along) continue;
    const prev = shape.samples[i - 1];
    const part = (at - prev.along) / (sample.along - prev.along || 1);
    return prev.t + (sample.t - prev.t) * part;
  }
  return 1;
}

function slicePath(shape, from, to) {
  const a = pointAt(shape, from);
  const b = pointAt(shape, to);
  if (!shape.control) return linePath(a, b);
  // Exact quadratic subcurve, using the derivative at its new start.
  const tangent = tangentAt(shape, from);
  const scale = (to - from) / 2;
  return pathFor(a, b, { x: a.x + tangent.x * scale, y: a.y + tangent.y * scale });
}

function crossbars(shape, color, halfWidth) {
  if (color === 'green' || !shape.length) return '';
  const spacing = Math.min(2.15, shape.length * 0.14);
  const offsets = color === 'blue' ? [-spacing, spacing] : [0];
  return offsets.map(offset => {
    const t = parameterAtLength(shape, shape.length / 2 + offset);
    const p = pointAt(shape, t);
    const tangent = tangentAt(shape, t);
    const length = Math.hypot(tangent.x, tangent.y) || 1;
    const x = -tangent.y / length * halfWidth;
    const y = tangent.x / length * halfWidth;
    return linePath({ x: p.x - x, y: p.y - y }, { x: p.x + x, y: p.y + y });
  }).join('');
}

function incidence(edges) {
  const index = new Map();
  for (const edge of edges) {
    for (const id of [edge.a, edge.b]) {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(edge);
    }
  }
  return index;
}

// Keep each detached piece together as it falls. The same components also
// describe which spans of the drawing contain branches when fitting a phone.
function components(edges) {
  const incident = incidence(edges);
  const remaining = new Set(edges);
  const pieces = [];
  for (const first of edges) {
    if (!remaining.delete(first)) continue;
    const piece = [];
    const stack = [first];
    while (stack.length) {
      const edge = stack.pop();
      piece.push(edge);
      for (const id of [edge.a, edge.b]) {
        for (const neighbor of incident.get(id)) {
          if (remaining.delete(neighbor)) stack.push(neighbor);
        }
      }
    }
    pieces.push(piece);
  }
  return pieces;
}

function branchSpans(edges, nodes) {
  const ranges = components(edges).map(piece => {
    const xs = piece.flatMap(edge => extent(nodes.get(edge.a).x, nodes.get(edge.b).x, edge.control?.x));
    return [Math.min(...xs), Math.max(...xs)];
  }).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [left, right] of ranges) {
    const last = merged[merged.length - 1];
    if (last && left <= last[1]) last[1] = Math.max(last[1], right);
    else merged.push([left, right]);
  }
  return merged;
}

// Compress empty space between separate figures first. The original full
// board, including branches already cut, determines this projection.
function horizontalProjection(width, spans) {
  const ratio = width / WIDTH;
  const uniform = { x: x => x * ratio, scale: ratio };
  if (Math.abs(width - WIDTH) < 0.05) return uniform;
  const occupied = spans.reduce((total, [left, right]) => total + right - left, 0);
  const blank = WIDTH - occupied;
  if (!occupied || blank <= 0 || ratio >= 1) return uniform;
  const occupiedScale = Math.min(1, (width - blank * ratio * ratio) / occupied);
  const blankScale = (width - occupied * occupiedScale) / blank;
  function project(x) {
    let before = 0;
    for (const [left, right] of spans) {
      before += Math.max(0, Math.min(x, right) - left);
    }
    return before * occupiedScale + (x - before) * blankScale;
  }
  return { x: project, scale: occupiedScale };
}

function addScissors() {
  const mark = svgElement('g', { class: 'hb-field__scissors', 'aria-hidden': 'true', display: 'none' });
  const blades = 'M-4.7,2.7L4.5,-10.6M4.7,2.7L-4.5,-10.6';
  mark.append(svgElement('path', { class: 'hb-field__scissor-back', d: blades }));
  mark.append(svgElement('path', { class: 'hb-field__scissor-ink', d: blades }));
  for (const sign of [-1, 1]) {
    mark.append(svgElement('ellipse', {
      class: 'hb-field__scissor-handle', cx: sign * 5.4, cy: -12.6, rx: 2.55, ry: 3.1,
      transform: `rotate(${sign * 24} ${sign * 5.4} -12.6)`
    }));
  }
  mark.append(svgElement('circle', { class: 'hb-field__scissor-pin', cx: 0, cy: -3.9, r: 0.9 }));
  return mark;
}

function distanceToEdge(point, shape) {
  let bestSquared = Infinity;
  let along = 0;
  for (let i = 1; i < shape.samples.length; i++) {
    const a = shape.samples[i - 1];
    const b = shape.samples[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const squared = dx * dx + dy * dy;
    const t = squared ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared)) : 0;
    const distance = (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2;
    if (distance >= bestSquared) continue;
    bestSquared = distance;
    along = a.along + t * (b.along - a.along);
  }
  return { distance: Math.sqrt(bestSquared), interior: Math.min(along, shape.length - along) };
}

export function createBoard(container, { onCut } = {}) {
  const prefix = `hb-field-${++instanceNumber}`;
  const frame = document.createElement('div');
  frame.className = 'hb-field';
  const landscape = document.createElement('div');
  landscape.className = 'hb-field__landscape';
  landscape.setAttribute('aria-hidden', 'true');
  const svg = svgElement('svg', {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'group', tabindex: -1,
    'aria-label': 'Hackenbush board', 'aria-describedby': `${prefix}-instructions`
  });
  const desc = svgElement('desc', { id: `${prefix}-instructions` });
  desc.textContent = 'Arrow keys select an available branch. Enter or Space cuts it. Red branches carry one stripe. Blue branches carry two.';
  const defs = svgElement('defs');
  const dots = svgElement('pattern', { id: `${prefix}-dots`, width: 16, height: 16, patternUnits: 'userSpaceOnUse' });
  dots.append(svgElement('circle', { class: 'hb-field__dot', cx: 8, cy: 8, r: 0.79 }));
  const hatching = svgElement('pattern', {
    id: `${prefix}-hatching`, width: 16, height: 9, patternUnits: 'userSpaceOnUse',
    patternTransform: `translate(0 ${GROUND})`
  });
  hatching.append(svgElement('path', { class: 'hb-field__etch', d: 'M-3,7L3,0M8,4L11.5,0M13,7L19,0' }));
  const soil = svgElement('linearGradient', { id: `${prefix}-soil`, x1: 0, x2: 0, y1: 0, y2: 1 });
  soil.append(svgElement('stop', { offset: '0%', 'stop-color': '#76855b', 'stop-opacity': 0.14 }));
  soil.append(svgElement('stop', { offset: '100%', 'stop-color': '#76855b', 'stop-opacity': 0 }));
  defs.append(dots, hatching, soil);
  const grid = svgElement('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: `url(#${prefix}-dots)`, 'aria-hidden': true });
  const ground = svgElement('g', { 'aria-hidden': true, class: 'hb-field__ground' });
  const groundLine = svgElement('path', { class: 'hb-field__ground-line' });
  const groundWash = svgElement('rect', { height: 13, fill: `url(#${prefix}-soil)` });
  const groundTicks = svgElement('rect', { height: 7.1, fill: `url(#${prefix}-hatching)` });
  ground.append(groundWash, groundTicks, groundLine);
  const branches = svgElement('g');
  const joints = svgElement('g', { class: 'hb-field__joints', 'aria-hidden': true });
  const effects = svgElement('g', { class: 'hb-field__effects', 'aria-hidden': true });
  const scissors = addScissors();
  const art = createRegionArt(prefix, svgElement);
  svg.append(desc, defs, art.defs, art.shapes, grid, ground, art.layer, effects, branches, joints, scissors);
  frame.append(landscape, svg);
  container.append(frame);

  let board = null;
  let signature = null;
  let side = 'blue';
  let live = new Set();
  let available = new Set();
  let hover = null;
  let focused = null;
  let roving = null;
  let keyboardFocus = false;
  let press = null;
  let width = WIDTH;
  let height = HEIGHT;
  let groundY = GROUND;
  let dense = false;
  let spans = [];
  let incident = new Map();
  const nodes = new Map();
  const edges = new Map();
  const timers = new Set();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function clearEffects() {
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    effects.replaceChildren();
  }

  function build(next) {
    clearEffects();
    branches.replaceChildren();
    joints.replaceChildren();
    nodes.clear();
    edges.clear();
    hover = focused = roving = null;
    press = null;
    art.build(next);
    for (const node of next.nodes) {
      const dot = svgElement('circle', { class: 'hb-field__joint' });
      joints.append(dot);
      nodes.set(node.id, { ...node, dot, at: null });
    }
    for (const [index, edge] of next.edges.entries()) {
      const group = svgElement('g', {
        class: `hb-field__edge hb-field--${edge.color}`, role: 'button', tabindex: -1,
        'data-edge-id': edge.id
      });
      const hit = svgElement('path', { class: 'hb-field__hit' });
      const halo = svgElement('path', { class: 'hb-field__halo' });
      const keyline = svgElement('path', { class: 'hb-field__edge-keyline' });
      const stem = svgElement('path', { class: 'hb-field__stem' });
      stem.classList.toggle('hb-field__stem--support', ['root', 'stem', 'trunk', 'trellis post'].includes(edge.part));
      const stripes = svgElement('path', { class: 'hb-field__stripes' });
      group.append(hit, halo, keyline, stem, stripes);
      branches.append(group);
      edges.set(edge.id, { ...edge, index, group, hit, halo, keyline, stem, stripes, center: null });
    }
    incident = incidence([...edges.values()]);
    spans = branchSpans([...edges.values()], nodes);
    dense = next.edges.length >= 40;
    frame.classList.toggle('hb-field--dense', dense);
    for (const [id, node] of nodes) {
      const junction = (incident.get(id)?.length ?? 0) > 2;
      const radius = node.ground ? 4.3 : junction ? 3.95 : 3.35;
      node.dot.setAttribute('r', radius - (dense && !node.ground ? 0.55 : 0));
      node.dot.classList.toggle('hb-field__joint--root', !!node.ground);
    }
  }

  function geometry() {
    const project = horizontalProjection(width, spans);
    art.project(project);
    const margin = Math.min(17, width * 0.018);
    groundLine.setAttribute('d', `M${margin},${groundY}H${width - margin}`);
    hatching.setAttribute('patternTransform', `translate(0 ${groundY})`);
    for (const strip of [groundWash, groundTicks]) {
      strip.setAttribute('x', margin);
      strip.setAttribute('y', groundY + 0.3);
      strip.setAttribute('width', width - 2 * margin);
    }
    for (const node of nodes.values()) {
      node.at = { x: project.x(node.x), y: node.y };
      node.dot.setAttribute('cx', node.at.x);
      node.dot.setAttribute('cy', node.at.y);
    }
    for (const edge of edges.values()) {
      const anchor = nodes.get(edge.a);
      const a = anchor.at;
      const b = nodes.get(edge.b).at;
      // A control point can extend past the actual petal into the gap
      // next door. Apply the same affine map as the rest of this figure.
      const control = edge.control && {
        x: a.x + (edge.control.x - anchor.x) * project.scale, y: edge.control.y
      };
      edge.shape = traceBranch(a, b, control);
      const middle = parameterAtLength(edge.shape, edge.shape.length / 2);
      edge.center = pointAt(edge.shape, middle);
      const tangent = tangentAt(edge.shape, middle);
      for (const part of [edge.hit, edge.halo, edge.keyline, edge.stem]) part.setAttribute('d', edge.shape.path);
      edge.stripes.setAttribute('d', crossbars(edge.shape, edge.color, dense ? 1.5 : 1.8));
      let angle = Math.atan2(tangent.y, tangent.x) * 180 / Math.PI;
      if (angle >= 90) angle -= 180;
      if (angle < -90) angle += 180;
      edge.angle = angle;
    }
  }

  function preview() {
    const active = hover || (keyboardFocus && focused) || null;
    const edge = available.has(active) ? edges.get(active) : null;
    const move = edge && cutEdge(board, [...live], edge.id, side);
    const willFall = new Set(move?.fallen);
    const remaining = move ? new Set(move.live) : null;
    art.preview(edge?.id, willFall);
    for (const [id, view] of edges) {
      view.group.classList.toggle('hb-field__edge--target', id === edge?.id);
      view.group.classList.toggle('hb-field__edge--falling', willFall.has(id));
    }
    for (const [id, node] of nodes) {
      const losesSupport = remaining && !node.ground && !incident.get(id)?.some(adjacent => remaining.has(adjacent.id));
      node.dot.classList.toggle('hb-field__joint--falling', !!losesSupport);
      node.dot.classList.toggle('hb-field__joint--target', !!edge && (edge.a === id || edge.b === id));
    }
    svg.classList.toggle('hb-field__svg--cuttable', !!hover && !!edge);
    if (edge) {
      scissors.setAttribute('transform', `translate(${edge.center.x} ${edge.center.y}) rotate(${edge.angle})`);
      scissors.removeAttribute('display');
    } else {
      scissors.setAttribute('display', 'none');
    }
  }

  function fit(force = false) {
    const box = frame.getBoundingClientRect();
    const fitted = box.width > 0 && box.height > 0 ? Math.round(box.width * height / box.height * 100) / 100 : WIDTH;
    if (!force && Math.abs(fitted - width) < 0.05) return;
    width = fitted;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    clearEffects();
    geometry();
    preview();
  }

  function animateRemoval(vanished, removed, cutId) {
    if (!vanished.length || reduceMotion?.matches) return;
    const cut = vanished.includes(cutId) ? edges.get(cutId) : null;
    const reported = new Set(removed);
    const fallen = vanished.filter(id => id !== cut?.id && (cut || reported.has(id))).map(id => edges.get(id));
    if (!cut && !fallen.length) return;
    const batch = svgElement('g');
    if (cut) {
      batch.append(...art.opened(cut.id));
      const middle = cut.shape.length / 2;
      const gap = Math.min(2, middle * 0.16);
      const left = parameterAtLength(cut.shape, middle - gap);
      const right = parameterAtLength(cut.shape, middle + gap);
      for (const [from, to, sign] of [[0, left, -1], [right, 1, 1]]) {
        const half = svgElement('g', { class: `hb-field__snip hb-field--${cut.color}` });
        half.style.setProperty('--hb-drift', `${sign * 2.6}px`);
        const ink = cut.stem.cloneNode();
        ink.setAttribute('d', slicePath(cut.shape, from, to));
        half.append(ink);
        batch.append(half);
      }
    }
    for (const piece of components(fallen)) {
      const ghost = svgElement('g', { class: 'hb-field__fall' });
      ghost.append(...art.detached(new Set(piece.map(edge => edge.id))));
      const ends = new Set();
      let center = 0;
      for (const edge of piece) {
        const copy = svgElement('g', { class: `hb-field--${edge.color}` });
        copy.append(edge.keyline.cloneNode(), edge.stem.cloneNode(), edge.stripes.cloneNode());
        ghost.append(copy);
        ends.add(edge.a).add(edge.b);
        center += edge.center.x;
      }
      const direction = center / piece.length < (cut?.center.x ?? width / 2) ? -1 : 1;
      ghost.style.setProperty('--hb-drift', `${direction * 10}px`);
      ghost.style.setProperty('--hb-spin', `${direction * 7}deg`);
      for (const id of ends) {
        const node = nodes.get(id);
        if (!node.ground && !incident.get(id).some(edge => live.has(edge.id))) {
          const copy = node.dot.cloneNode();
          copy.setAttribute('class', 'hb-field__joint');
          ghost.append(copy);
        }
      }
      batch.append(ghost);
    }
    effects.append(batch);
    const timer = window.setTimeout(() => {
      batch.remove();
      timers.delete(timer);
    }, 600);
    timers.add(timer);
  }

  function setRoving(id) {
    if (roving !== id) edges.get(roving)?.group.setAttribute('tabindex', '-1');
    roving = id;
    if (roving) edges.get(roving).group.setAttribute('tabindex', '0');
  }

  function edgeId(target) {
    return target?.closest?.('[data-edge-id]')?.getAttribute('data-edge-id') ?? null;
  }

  function update({ board: next, live: ids, side: nextSide, locked: disable = false, hintId = null, removed = [], cutId = null, reset = false }) {
    const activeElement = document.activeElement;
    const hadFocus = svg.contains(activeElement);
    const previousFocus = hadFocus ? edgeId(activeElement) : null;
    const nextSignature = JSON.stringify([next.height, next.groundY,
      next.nodes.map(n => [n.id, n.x, n.y, !!n.ground]),
      next.edges.map(e => [e.id, e.a, e.b, e.color, e.control?.x, e.control?.y, e.part, e.feature])]);
    const changed = nextSignature !== signature;
    const before = live;
    board = next;
    side = nextSide;
    if (changed) {
      signature = nextSignature;
      height = next.height ?? HEIGHT;
      groundY = next.groundY ?? GROUND;
      frame.style.setProperty('--hb-height', String(height));
      frame.style.setProperty('--hb-min-height', `${Math.min(222, Math.round(height * 210 / HEIGHT))}px`);
      build(next);
      fit(true);
    } else if (reset) {
      clearEffects();
      hover = null;
      press = null;
    }
    live = new Set(ids ?? next.edges.map(edge => edge.id));
    available = new Set(disable ? [] : legalMoves(board, [...live], side));
    const hint = available.has(hintId) ? hintId : null;
    if (!available.has(hover)) hover = null;
    if (!available.has(focused)) focused = null;
    if (available.has(previousFocus)) setRoving(previousFocus);
    else if (!available.has(roving)) setRoving(available.values().next().value ?? null);
    if (!changed && !reset) {
      const vanished = [...before].filter(id => !live.has(id) && edges.has(id));
      animateRemoval(vanished, removed, cutId);
    }
    art.setLive(live);
    for (const [id, view] of edges) {
      const visible = live.has(id);
      const enabled = available.has(id);
      view.group.setAttribute('display', visible ? 'inline' : 'none');
      view.group.setAttribute('tabindex', id === roving ? '0' : '-1');
      const disabled = String(!enabled);
      if (view.group.getAttribute('aria-disabled') !== disabled) view.group.setAttribute('aria-disabled', disabled);
      const part = view.part ? `, ${view.part}` : '';
      const label = `${enabled ? 'Cut ' : ''}${view.color} branch ${view.index + 1}${part}${id === hint ? ', suggested move' : ''}`;
      if (view.group.getAttribute('aria-label') !== label) view.group.setAttribute('aria-label', label);
      view.group.classList.toggle('hb-field__edge--hint', id === hint);
    }
    for (const [id, node] of nodes) {
      const visible = incident.get(id)?.some(edge => live.has(edge.id));
      node.dot.setAttribute('display', visible ? 'inline' : 'none');
    }
    if (hadFocus && (changed || !available.has(previousFocus))) {
      const target = roving ? edges.get(roving).group : svg;
      if (target !== document.activeElement) target.focus({ preventScroll: true });
    }
    preview();
  }

  // Hit paths overlap at joints. Compare the visible curves in screen space
  // so DOM order cannot decide which branch the player cuts.
  function pick(event, touch = false) {
    if (!available.size) return null;
    const box = svg.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const scale = box.height / height;
    const point = { x: (event.clientX - box.left) * width / box.width, y: (event.clientY - box.top) / scale };
    const tolerance = (touch ? 22 : dense ? 8 : 13) / scale;
    let best = null;
    let score = Infinity;
    let otherDistance = Infinity;
    for (const [id, edge] of edges) {
      if (!live.has(id)) continue;
      const shape = edge.shape;
      if (point.x < shape.left - tolerance || point.x > shape.right + tolerance ||
          point.y < shape.top - tolerance || point.y > shape.bottom + tolerance) continue;
      const hit = distanceToEdge(point, shape);
      if (!available.has(id)) {
        otherDistance = Math.min(otherDistance, hit.distance);
        continue;
      }
      if (hit.distance > tolerance) continue;
      const rank = hit.distance + Math.max(0, 3 / scale - hit.interior) * 0.28;
      if (rank < score || (rank === score && id === hover)) {
        score = rank;
        best = { id, distance: hit.distance };
      }
    }
    if (!best || otherDistance + (touch ? 2.5 : 1) / scale < best.distance) return null;
    return best.id;
  }

  function setHover(id) {
    if (id === hover) return;
    hover = id;
    preview();
  }

  function nextInDirection(id, dx, dy) {
    const ordered = [...available].sort((a, b) => {
      const left = edges.get(a).center;
      const right = edges.get(b).center;
      return left.x - right.x || left.y - right.y;
    });
    const step = dx + dy > 0 ? 1 : -1;
    const next = ordered[(ordered.indexOf(id) + step + ordered.length) % ordered.length];
    // Repeated left or right always reaches every legal branch.
    if (dx) return next;
    const origin = edges.get(id).center;
    let best = null;
    let score = Infinity;
    for (const candidate of ordered) {
      if (candidate === id) continue;
      const point = edges.get(candidate).center;
      const x = point.x - origin.x;
      const y = point.y - origin.y;
      const forward = dy * y;
      if (forward <= 0.5) continue;
      const rank = Math.hypot(x, y) + Math.abs(x) * 1.7;
      if (rank < score) { score = rank; best = candidate; }
    }
    return best ?? next;
  }

  function cut(id) {
    if (available.has(id)) onCut?.(id);
  }

  // Keep keyboard selection visible inside the optional zoomed field.
  // Only an explicit navigation key pans it, and only horizontally.
  function showInViewport(id) {
    const scrollport = container.closest?.('.board-scroll');
    if (!scrollport || scrollport.scrollWidth <= scrollport.clientWidth) return;
    const port = scrollport.getBoundingClientRect();
    const art = svg.getBoundingClientRect();
    const x = art.left + edges.get(id).center.x * art.width / width;
    const padding = Math.min(24, port.width / 6);
    if (x < port.left + padding) scrollport.scrollLeft += x - port.left - padding;
    else if (x > port.right - padding) scrollport.scrollLeft += x - port.right + padding;
  }

  svg.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch') { setHover(pick(event)); return; }
    if (press?.touch) {
      const onBranch = Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 12 && pick(event, true) === press.id;
      setHover(onBranch ? press.id : null);
    }
  });
  svg.addEventListener('pointerleave', () => setHover(null));
  svg.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    const touch = event.pointerType === 'touch';
    press = { id: pick(event, touch), x: event.clientX, y: event.clientY, touch };
    keyboardFocus = false;
    setHover(press.id);
  });
  svg.addEventListener('pointercancel', () => { press = null; setHover(null); });
  svg.addEventListener('click', event => {
    const started = press;
    press = null;
    if (event.button !== 0) return;
    if (event.detail === 0) { cut(edgeId(event.target)); return; }
    const touch = event.pointerType === 'touch' || started?.touch;
    const chosen = pick(event, touch);
    if (touch) setHover(null);
    if (started && (chosen !== started.id || Math.hypot(event.clientX - started.x, event.clientY - started.y) > (touch ? 12 : 7))) return;
    cut(chosen);
  });
  svg.addEventListener('focusin', event => {
    focused = edgeId(event.target);
    if (available.has(focused)) setRoving(focused);
    if (event.target.matches(':focus-visible')) keyboardFocus = true;
    preview();
  });
  svg.addEventListener('focusout', event => {
    focused = null;
    if (!svg.contains(event.relatedTarget)) keyboardFocus = false;
    preview();
  });
  svg.addEventListener('keydown', event => {
    const id = edgeId(event.target);
    if (!available.has(id) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) cut(id);
      return;
    }
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    let next;
    if (directions[event.key]) next = nextInDirection(id, ...directions[event.key]);
    else if (event.key === 'Home' || event.key === 'End') next = [...available].at(event.key === 'Home' ? 0 : -1);
    else return;
    event.preventDefault();
    hover = null;
    keyboardFocus = true;
    setRoving(next);
    edges.get(next).group.focus({ preventScroll: true });
    showInViewport(next);
    preview();
  });

  const onResize = () => fit();
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
  if (observer) observer.observe(frame);
  else window.addEventListener('resize', onResize);
  geometry();
  fit();
  return {
    landscape,
    update,
    destroy() {
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', onResize);
      clearEffects();
      frame.remove();
    }
  };
}
