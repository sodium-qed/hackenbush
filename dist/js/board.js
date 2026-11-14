import { cutEdge, legalMoves } from './rules.js';

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

function crossbars(a, b, color) {
  if (color === 'green') return '';
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!length) return '';
  const tx = dx / length;
  const ty = dy / length;
  const center = between(a, b, 0.5);
  const offsets = color === 'blue' ? [-2.15, 2.15] : [0];
  return offsets.map(offset => {
    const x = center.x + tx * offset;
    const y = center.y + ty * offset;
    return linePath({ x: x + ty * 1.75, y: y - tx * 1.75 }, { x: x - ty * 1.75, y: y + tx * 1.75 });
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
    const xs = piece.flatMap(edge => [nodes.get(edge.a).x, nodes.get(edge.b).x]);
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
  if (Math.abs(width - WIDTH) < 0.05) return x => x;
  const occupied = spans.reduce((total, [left, right]) => total + right - left, 0);
  const blank = WIDTH - occupied;
  const ratio = width / WIDTH;
  if (!occupied || !blank || ratio >= 1) return x => x * ratio;
  const occupiedScale = Math.min(1, (width - blank * ratio * ratio) / occupied);
  const blankScale = (width - occupied * occupiedScale) / blank;
  return x => {
    let before = 0;
    for (const [left, right] of spans) {
      before += Math.max(0, Math.min(x, right) - left);
    }
    return before * occupiedScale + (x - before) * blankScale;
  };
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

function distanceToEdge(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const squared = dx * dx + dy * dy;
  const t = squared ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared)) : 0;
  const closest = between(a, b, t);
  return { distance: Math.hypot(point.x - closest.x, point.y - closest.y), interior: Math.min(t, 1 - t) * Math.sqrt(squared) };
}

export function createBoard(container, { onCut } = {}) {
  const prefix = `hb-field-${++instanceNumber}`;
  const frame = document.createElement('div');
  frame.className = 'hb-field';
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
    id: `${prefix}-hatching`, width: 10, height: 7, patternUnits: 'userSpaceOnUse',
    patternTransform: `translate(0 ${GROUND})`
  });
  hatching.append(svgElement('path', { class: 'hb-field__etch', d: 'M-4,6L2,0M6,6L12,0' }));
  defs.append(dots, hatching);
  const grid = svgElement('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: `url(#${prefix}-dots)`, 'aria-hidden': true });
  const ground = svgElement('g', { 'aria-hidden': true, class: 'hb-field__ground' });
  const groundLine = svgElement('path', { class: 'hb-field__ground-line' });
  const groundTicks = svgElement('rect', { y: GROUND + 0.3, height: 6.2, fill: `url(#${prefix}-hatching)` });
  ground.append(groundTicks, groundLine);
  const branches = svgElement('g');
  const joints = svgElement('g', { class: 'hb-field__joints', 'aria-hidden': true });
  const effects = svgElement('g', { class: 'hb-field__effects', 'aria-hidden': true });
  const scissors = addScissors();
  svg.append(desc, defs, grid, ground, branches, joints, effects, scissors);
  frame.append(svg);
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
    for (const node of next.nodes) {
      const dot = svgElement('circle', { class: 'hb-field__joint', r: node.ground ? 4.2 : 3.75 });
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
      const stem = svgElement('path', { class: 'hb-field__stem' });
      const stripes = svgElement('path', { class: 'hb-field__stripes' });
      group.append(hit, halo, stem, stripes);
      branches.append(group);
      edges.set(edge.id, { ...edge, index, group, hit, halo, stem, stripes, center: null });
    }
    incident = incidence([...edges.values()]);
    spans = branchSpans([...edges.values()], nodes);
  }

  function geometry() {
    const project = horizontalProjection(width, spans);
    const margin = Math.min(17, width * 0.018);
    groundLine.setAttribute('d', `M${margin},${GROUND}H${width - margin}`);
    groundTicks.setAttribute('x', margin);
    groundTicks.setAttribute('width', width - 2 * margin);
    for (const node of nodes.values()) {
      node.at = { x: project(node.x), y: node.y };
      node.dot.setAttribute('cx', node.at.x);
      node.dot.setAttribute('cy', node.at.y);
    }
    for (const edge of edges.values()) {
      const a = nodes.get(edge.a).at;
      const b = nodes.get(edge.b).at;
      edge.center = between(a, b, 0.5);
      const path = linePath(a, b);
      for (const part of [edge.hit, edge.halo, edge.stem]) part.setAttribute('d', path);
      edge.stripes.setAttribute('d', crossbars(a, b, edge.color));
      let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
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
    for (const [id, view] of edges) {
      view.group.classList.toggle('hb-field__edge--target', id === edge?.id);
      view.group.classList.toggle('hb-field__edge--falling', willFall.has(id));
    }
    for (const [id, node] of nodes) {
      const losesSupport = remaining && !node.ground && !incident.get(id)?.some(adjacent => remaining.has(adjacent.id));
      node.dot.classList.toggle('hb-field__joint--falling', !!losesSupport);
    }
    svg.classList.toggle('hb-field__svg--cuttable', !!hover && !!edge);
    if (edge) {
      scissors.setAttribute('transform', `translate(${edge.center.x} ${edge.center.y}) rotate(${edge.angle})`);
      scissors.removeAttribute('display');
    } else {
      scissors.setAttribute('display', 'none');
    }
  }

  function fit() {
    const box = frame.getBoundingClientRect();
    const fitted = box.width > 0 && box.height > 0 ? Math.round(box.width * HEIGHT / box.height * 100) / 100 : WIDTH;
    if (Math.abs(fitted - width) < 0.05) return;
    width = fitted;
    svg.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
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
      const a = nodes.get(cut.a).at;
      const b = nodes.get(cut.b).at;
      for (const [start, end, sign] of [[a, between(a, b, 0.47), -1], [between(a, b, 0.53), b, 1]]) {
        const half = svgElement('g', { class: `hb-field__snip hb-field--${cut.color}` });
        half.style.setProperty('--hb-drift', `${sign * 2.6}px`);
        half.append(svgElement('path', { class: 'hb-field__stem', d: linePath(start, end) }));
        batch.append(half);
      }
    }
    for (const piece of components(fallen)) {
      const ghost = svgElement('g', { class: 'hb-field__fall' });
      const ends = new Set();
      let center = 0;
      for (const edge of piece) {
        const copy = svgElement('g', { class: `hb-field--${edge.color}` });
        copy.append(edge.stem.cloneNode(), edge.stripes.cloneNode());
        ghost.append(copy);
        ends.add(edge.a).add(edge.b);
        center += edge.center.x;
      }
      const direction = center / piece.length < (cut?.center.x ?? width / 2) ? -1 : 1;
      ghost.style.setProperty('--hb-drift', `${direction * 5}px`);
      ghost.style.setProperty('--hb-spin', `${direction * 4.5}deg`);
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
    }, 500);
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
    const nextSignature = JSON.stringify([next.nodes.map(n => [n.id, n.x, n.y, !!n.ground]), next.edges.map(e => [e.id, e.a, e.b, e.color])]);
    const changed = nextSignature !== signature;
    const before = live;
    board = next;
    side = nextSide;
    if (changed) {
      signature = nextSignature;
      build(next);
      geometry();
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
    for (const [id, view] of edges) {
      const visible = live.has(id);
      const enabled = available.has(id);
      view.group.setAttribute('display', visible ? 'inline' : 'none');
      view.group.setAttribute('tabindex', id === roving ? '0' : '-1');
      const disabled = String(!enabled);
      if (view.group.getAttribute('aria-disabled') !== disabled) view.group.setAttribute('aria-disabled', disabled);
      const label = `${enabled ? 'Cut ' : ''}${view.color} branch ${view.index + 1}${id === hint ? ', suggested move' : ''}`;
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

  // SVG hit paths overlap at joints. Resolve the nearest actual segment in
  // screen space so DOM order cannot decide which branch the player cuts.
  function pick(event, touch = false) {
    if (!available.size) return null;
    const box = svg.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const scale = box.height / HEIGHT;
    const point = { x: (event.clientX - box.left) * width / box.width, y: (event.clientY - box.top) / scale };
    const tolerance = (touch ? 22 : 13) / scale;
    let best = null;
    let score = Infinity;
    let otherDistance = Infinity;
    for (const [id, edge] of edges) {
      if (!live.has(id)) continue;
      const hit = distanceToEdge(point, nodes.get(edge.a).at, nodes.get(edge.b).at);
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
    if (!best || (otherDistance < 3.6 / scale && otherDistance + 1 / scale < best.distance)) return null;
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

  svg.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch') setHover(pick(event));
  });
  svg.addEventListener('pointerleave', () => setHover(null));
  svg.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    const touch = event.pointerType === 'touch';
    press = { id: pick(event, touch), x: event.clientX, y: event.clientY, touch };
    keyboardFocus = false;
    if (!touch) setHover(press.id);
  });
  svg.addEventListener('pointercancel', () => { press = null; setHover(null); });
  svg.addEventListener('click', event => {
    const started = press;
    press = null;
    if (event.button !== 0) return;
    if (event.detail === 0) { cut(edgeId(event.target)); return; }
    const touch = event.pointerType === 'touch' || started?.touch;
    const chosen = pick(event, touch);
    if (started && (chosen !== started.id || Math.hypot(event.clientX - started.x, event.clientY - started.y) > (touch ? 12 : 7))) return;
    if (touch) setHover(null);
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
    preview();
  });

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
  if (observer) observer.observe(frame);
  else window.addEventListener('resize', fit);
  geometry();
  fit();
  return {
    update,
    destroy() {
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', fit);
      clearEffects();
      frame.remove();
    }
  };
}
