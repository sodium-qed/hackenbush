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

function sliceBranch(shape, from, to) {
  const a = pointAt(shape, from);
  const b = pointAt(shape, to);
  if (!shape.control) return traceBranch(a, b);
  // Exact quadratic subcurve, using the derivative at its new start.
  const tangent = tangentAt(shape, from);
  const scale = (to - from) / 2;
  return traceBranch(a, b, { x: a.x + tangent.x * scale, y: a.y + tangent.y * scale });
}

function crossbars(shape, color, halfWidth, from = 0, to = 1) {
  if (color === 'green' || !shape.length) return '';
  const spacing = Math.min(2.15, shape.length * 0.14);
  const offsets = color === 'blue' ? [-spacing, spacing] : [0];
  return offsets.map(offset => {
    const t = parameterAtLength(shape, shape.length / 2 + offset);
    if (t < from || t > to) return '';
    const p = pointAt(shape, t);
    const tangent = tangentAt(shape, t);
    const length = Math.hypot(tangent.x, tangent.y) || 1;
    const x = -tangent.y / length * halfWidth;
    const y = tangent.x / length * halfWidth;
    return linePath({ x: p.x - x, y: p.y - y }, { x: p.x + x, y: p.y + y });
  }).join('');
}

// Treat the ink as rods of uniform density. The same curve samples used for
// picking give each piece its balance point, moment of inertia and soil contact.
function fallingBody(shapes) {
  let mass = 0, firstX = 0, firstY = 0, secondMoment = 0;
  const points = [];
  for (const { samples } of shapes) {
    points.push(...samples);
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const length = b.along - a.along;
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      mass += length;
      firstX += x * length;
      firstY += y * length;
      secondMoment += length * (x * x + y * y + length * length / 12);
    }
  }
  const x = mass ? firstX / mass : points[0].x;
  const y = mass ? firstY / mass : points[0].y;
  const inertia = Math.max(25, secondMoment / (mass || 1) - x * x - y * y);
  const offsets = points.map(point => ({ x: point.x - x, y: point.y - y }));
  return { x, y, inertia, offsets };
}

// Sample a short rigid-body flight once. The browser interpolates these poses
// while the next player can already select and cut another branch.
function tumble(group, body, vx, vy, spin, floor, gravity) {
  const step = 1 / 60;
  const frames = [];
  let x = 0, y = 0, angle = 0, fadeAt = 0.48, impact = null;
  for (let tick = 0; ; tick++) {
    const time = tick * step;
    if (tick) {
      x += vx * step;
      y += vy * step + gravity * step * step / 2;
      vy += gravity * step;
      angle += spin * step;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      let footX = 0, footY = -Infinity;
      for (const point of body.offsets) {
        const down = sin * point.x + cos * point.y;
        if (down > footY) {
          footX = cos * point.x - sin * point.y;
          footY = down;
        }
      }
      const overlap = body.y + y + footY - floor;
      if (overlap > 0) {
        y -= overlap;
        impact ??= { time, x: body.x + x + footX };
        // A tip landing off-center exchanges vertical speed for rotation.
        // Low restitution and soil friction make the first bounce settle.
        const speed = Math.max(0, vy + spin * footX);
        const normal = -1.18 * speed / (1 + footX * footX / body.inertia);
        vy += normal;
        spin += footX * normal / body.inertia;
        const slip = (vx - spin * footY) / (1 + footY * footY / body.inertia);
        const friction = -Math.sign(slip) * Math.min(Math.abs(slip), -normal * 0.55);
        vx += friction;
        spin -= footY * friction / body.inertia;
        fadeAt = Math.min(fadeAt, Math.max(0.19, time));
      }
    }
    const opacity = Math.max(0, Math.min(1, 1 - (time - fadeAt) / 0.16));
    frames.push({
      transform: `translate(${x.toFixed(3)}px, ${y.toFixed(3)}px) rotate(${angle.toFixed(5)}rad)`,
      opacity,
    });
    if (!opacity) break;
  }
  group.style.setProperty('transform-origin', `${body.x}px ${body.y}px`);
  const duration = (frames.length - 1) * step * 1000;
  group.animate?.(frames, { duration, easing: 'linear', fill: 'backwards' });
  return { duration, impact };
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
  const place = svgElement('g', { class: 'hb-field__scissors', 'aria-hidden': 'true', display: 'none' });
  const mark = svgElement('g', { class: 'hb-field__scissors-mark' });
  place.append(mark);
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
  return place;
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
  const bead = svgElement('radialGradient', { id: `${prefix}-bead`, cx: 0.36, cy: 0.3, r: 0.75 });
  bead.append(svgElement('stop', { offset: '0%', 'stop-color': '#71876d' }));
  bead.append(svgElement('stop', { offset: '46%', 'stop-color': '#3a503d' }));
  bead.append(svgElement('stop', { offset: '100%', 'stop-color': '#233126' }));
  defs.append(dots, hatching, soil, bead);
  const grid = svgElement('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: `url(#${prefix}-dots)`, 'aria-hidden': true });
  const ground = svgElement('g', { 'aria-hidden': true, class: 'hb-field__ground' });
  const groundLine = svgElement('path', { class: 'hb-field__ground-line' });
  const groundWash = svgElement('rect', { height: 13, fill: `url(#${prefix}-soil)` });
  const groundTicks = svgElement('rect', { height: 7.1, fill: `url(#${prefix}-hatching)` });
  ground.append(groundWash, groundTicks, groundLine);
  const shadows = svgElement('g', { class: 'hb-field__shadows', 'aria-hidden': true });
  const branches = svgElement('g', { class: 'hb-field__branches' });
  const sparks = svgElement('g', { class: 'hb-field__sparks', 'aria-hidden': true });
  const joints = svgElement('g', { class: 'hb-field__joints', 'aria-hidden': true });
  const effects = svgElement('g', { class: 'hb-field__effects', 'aria-hidden': true });
  const scissors = addScissors();
  const art = createRegionArt(prefix, svgElement);
  svg.append(desc, defs, art.defs, art.shapes, grid, ground, art.layer, shadows, effects, branches, joints, sparks, scissors);
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
  let grown = [];
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function clearEffects() {
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    for (const animation of effects.getAnimations?.({ subtree: true }) ?? []) animation.cancel();
    for (const animation of sparks.getAnimations?.({ subtree: true }) ?? []) animation.cancel();
    for (const animation of grown) animation?.cancel();
    grown = [];
    effects.replaceChildren();
    sparks.replaceChildren();
  }
  function motionChanged() {
    if (reduceMotion.matches) clearEffects();
  }
  reduceMotion?.addEventListener?.('change', motionChanged);

  function build(next) {
    clearEffects();
    branches.replaceChildren();
    shadows.replaceChildren();
    joints.replaceChildren();
    nodes.clear();
    edges.clear();
    hover = focused = roving = null;
    press = null;
    art.build(next);
    for (const node of next.nodes) {
      const dot = svgElement('circle', { class: 'hb-field__joint', fill: `url(#${prefix}-bead)` });
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
      const sheen = svgElement('path', { class: 'hb-field__sheen' });
      const stripes = svgElement('path', { class: 'hb-field__stripes' });
      const shadow = svgElement('path', { class: 'hb-field__shadow' });
      group.append(hit, halo, keyline, stem, sheen, stripes);
      branches.append(group);
      shadows.append(shadow);
      edges.set(edge.id, { ...edge, index, group, hit, halo, keyline, stem, sheen, stripes, shadow, center: null });
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
      for (const part of [edge.hit, edge.halo, edge.keyline, edge.stem, edge.sheen, edge.shadow]) part.setAttribute('d', edge.shape.path);
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
      view.shadow.classList.toggle('hb-field__shadow--falling', willFall.has(id) || id === edge?.id);
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

  // The dealt garden grows out of the soil: each branch draws from its
  // supported end, one step after the branch that carries it.
  function growIn() {
    if (reduceMotion?.matches) return;
    const depth = new Map();
    let frontier = [...nodes.values()].filter(node => node.ground).map(node => node.id);
    for (const id of frontier) depth.set(id, 0);
    let deepest = 0;
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        for (const edge of incident.get(id) ?? []) {
          const other = edge.a === id ? edge.b : edge.a;
          if (!live.has(edge.id) || depth.has(other)) continue;
          depth.set(other, depth.get(id) + 1);
          deepest = depth.get(other);
          next.push(other);
        }
      }
      frontier = next;
    }
    const step = Math.max(40, Math.min(120, 1250 / (deepest + 1)));
    const span = step * 1.7;
    const ends = new Map();
    for (const [id, edge] of edges) {
      if (!live.has(id)) continue;
      const a = depth.get(edge.a) ?? deepest, b = depth.get(edge.b) ?? deepest;
      const delay = Math.min(a, b) * step;
      const length = edge.shape.length;
      const dash = `${length} ${length + 2}`;
      const hidden = a <= b ? length + 1 : -length - 1;
      const timing = { duration: span, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'backwards' };
      for (const part of [edge.shadow, edge.keyline, edge.stem, edge.sheen]) {
        grown.push(part.animate?.([
          { strokeDasharray: dash, strokeDashoffset: hidden },
          { strokeDasharray: dash, strokeDashoffset: 0 }
        ], timing));
      }
      grown.push(edge.stripes.animate?.([{ opacity: 0 }, { opacity: 1 }],
        { duration: span * 0.6, delay: delay + span * 0.6, fill: 'backwards' }));
      ends.set(id, delay + span);
    }
    for (const [id, node] of nodes) {
      const delay = (depth.get(id) ?? deepest) * step + (node.ground ? 0 : span * 0.35);
      grown.push(node.dot.animate?.([
        { transform: 'scale(0)' }, { transform: 'scale(1.4)', offset: 0.65 }, { transform: 'scale(1)' }
      ], { duration: 240, delay, easing: 'ease-out', fill: 'backwards' }));
    }
    grown.push(...art.grow(ends));
  }

  // Chips of the cut branch scatter from the blades.
  function burst(layer, cut) {
    const { x, y } = cut.center;
    const ring = svgElement('circle', { class: `hb-field__ring hb-field--${cut.color}`, r: 4 });
    layer.append(ring);
    ring.animate?.([
      { transform: `translate(${x}px, ${y}px) scale(.4)`, opacity: 0.85 },
      { transform: `translate(${x}px, ${y}px) scale(4.4)`, opacity: 0 }
    ], { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
    const count = dense ? 6 : 9;
    const flight = 0.58;
    for (let i = 0; i < count; i++) {
      const turn = (i + ((cut.index * 7 + i * 3) % 5) / 5) / count * Math.PI * 2;
      const speed = 38 + (cut.index * 13 + i * 29) % 41;
      const vx = Math.cos(turn) * speed, vy = Math.sin(turn) * speed - 30;
      const spin = (i % 2 ? 1 : -1) * (260 + speed * 5);
      const pale = i % 3 === 2 ? ' hb-field__chip--pale' : '';
      const chip = svgElement('path', { class: `hb-field__chip hb-field--${cut.color}${pale}`, d: 'M-2.7,0Q0,-2 2.7,0Q0,2 -2.7,0Z' });
      layer.append(chip);
      const frames = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6 * flight;
        const size = 1 - 0.45 * k / 6;
        frames.push({
          transform: `translate(${(x + vx * t).toFixed(2)}px, ${(y + vy * t + 210 * t * t).toFixed(2)}px) rotate(${(spin * t).toFixed(1)}deg) scale(${size.toFixed(2)})`,
          opacity: k < 4 ? 1 : (6 - k) / 3
        });
      }
      chip.animate?.(frames, { duration: flight * 1000, easing: 'linear', fill: 'both' });
    }
  }

  // A falling piece raises a little dust where it first meets the soil.
  function dust(layer, impact, radius) {
    const scale = Math.max(0.6, Math.min(1.6, radius / 24));
    const y = groundY - 1.2;
    for (const side of [-1, 0, 1]) {
      const puff = svgElement('ellipse', { class: 'hb-field__dust', rx: 5.2, ry: 2.7 });
      layer.append(puff);
      const from = impact.x + side * 3 * scale;
      puff.animate?.([
        { transform: `translate(${from.toFixed(2)}px, ${y}px) scale(${(0.3 * scale).toFixed(2)})`, opacity: 0 },
        { transform: `translate(${(from + side * 4 * scale).toFixed(2)}px, ${(y - 1.5 * scale).toFixed(2)}px) scale(${(0.7 * scale).toFixed(2)})`, opacity: 0.6, offset: 0.22 },
        { transform: `translate(${(from + side * 15 * scale).toFixed(2)}px, ${(y - (side ? 3.5 : 8) * scale).toFixed(2)}px) scale(${(1.35 * scale).toFixed(2)})`, opacity: 0 }
      ], { duration: 540, delay: impact.time * 1000, easing: 'ease-out', fill: 'both' });
    }
    return impact.time * 1000 + 540;
  }

  function animateRemoval(vanished, removed, cutId) {
    if (!vanished.length || reduceMotion?.matches) return;
    const cut = vanished.includes(cutId) ? edges.get(cutId) : null;
    const reported = new Set(removed);
    const fallen = vanished.filter(id => id !== cut?.id && (cut || reported.has(id))).map(id => edges.get(id));
    if (!cut && !fallen.length) return;
    const batch = svgElement('g');
    const loose = svgElement('g');
    effects.append(batch);
    sparks.append(loose);
    let puffs = 0;
    const floor = groundY - 1.5;
    const gravity = Math.max(1700, height * 8.5);
    let duration = 460; // The wash of an opened region peels for 460 ms.

    function addLooseJoint(group, id) {
      const node = nodes.get(id);
      if (node.ground || incident.get(id).some(edge => live.has(edge.id))) return;
      const dot = node.dot.cloneNode();
      dot.setAttribute('class', 'hb-field__joint');
      group.append(dot);
    }

    if (cut) {
      burst(loose, cut);
      batch.append(...art.opened(cut.id));
      const middle = cut.shape.length / 2;
      const tangent = tangentAt(cut.shape, parameterAtLength(cut.shape, middle));
      const length = Math.hypot(tangent.x, tangent.y) || 1;
      const tx = tangent.x / length, ty = tangent.y / length;
      const gap = Math.min(2, middle * 0.16);
      const left = parameterAtLength(cut.shape, middle - gap);
      const right = parameterAtLength(cut.shape, middle + gap);
      for (const [from, to, sign, end] of [[0, left, -1, cut.a], [right, 1, 1, cut.b]]) {
        const half = svgElement('g', { class: `hb-field__snip hb-field--${cut.color}` });
        const shape = sliceBranch(cut.shape, from, to);
        const keyline = cut.keyline.cloneNode(), ink = cut.stem.cloneNode(), stripes = cut.stripes.cloneNode();
        keyline.setAttribute('d', shape.path);
        ink.setAttribute('d', shape.path);
        stripes.setAttribute('d', crossbars(cut.shape, cut.color, dense ? 1.5 : 1.8, from, to));
        half.append(keyline, ink, stripes);
        if (!fallen.some(edge => edge.a === end || edge.b === end)) addLooseJoint(half, end);
        batch.append(half);
        const body = fallingBody([shape]);
        const radius = Math.sqrt(body.inertia);
        const kick = sign * 106 / (1 + radius / 100);
        const vx = kick * (tx - 0.85 * ty);
        const vy = kick * (0.55 * ty + 0.42 * tx) - 32;
        const spin = sign * (1.8 + 80 / (radius + 8));
        duration = Math.max(duration, tumble(half, body, vx, vy, spin, floor, gravity).duration);
      }
    }
    for (const piece of components(fallen)) {
      const ghost = svgElement('g', { class: 'hb-field__fall' });
      ghost.append(...art.detached(new Set(piece.map(edge => edge.id))));
      const ends = new Set();
      for (const edge of piece) {
        const copy = svgElement('g', { class: `hb-field--${edge.color}` });
        copy.append(edge.keyline.cloneNode(), edge.stem.cloneNode(), edge.stripes.cloneNode());
        ghost.append(copy);
        ends.add(edge.a).add(edge.b);
      }
      for (const id of ends) addLooseJoint(ghost, id);
      batch.append(ghost);
      const body = fallingBody(piece.map(edge => edge.shape));
      const radius = Math.sqrt(body.inertia);
      // The shared joint is where this piece lost its support. A crown tips
      // toward its heavier side, and a long limb turns more slowly.
      const joint = cut && [cut.a, cut.b].find(id => ends.has(id));
      const cutX = cut?.center.x ?? width / 2;
      const pivotX = nodes.get(joint)?.at.x ?? cutX;
      const lean = Math.max(-1, Math.min(1, (body.x - pivotX) / radius));
      const shear = Math.sign(pivotX - cutX) || 1;
      const direction = Math.abs(lean) > 0.08 ? Math.sign(lean) : shear;
      const vx = direction * (23 + 47 * Math.abs(lean));
      const spin = direction * Math.min(6.4, (78 + 76 * Math.abs(lean)) / (radius + 10));
      const flight = tumble(ghost, body, vx, -9, spin, floor, gravity);
      duration = Math.max(duration, flight.duration);
      if (flight.impact && puffs++ < 6) duration = Math.max(duration, dust(loose, flight.impact, radius));
    }
    const timer = window.setTimeout(() => {
      batch.remove();
      loose.remove();
      timers.delete(timer);
    }, Math.ceil(duration) + 34);
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

  function update({ board: next, live: ids, side: nextSide, locked: disable = false, hintId = null, removed = [], cutId = null, reset = false, grow = false }) {
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
      view.shadow.setAttribute('display', visible ? 'inline' : 'none');
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
    if (grow) growIn();
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
      reduceMotion?.removeEventListener?.('change', motionChanged);
      clearEffects();
      frame.remove();
    }
  };
}
