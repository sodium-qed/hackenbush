import { normalizeMapSeed } from './map-seed.js';
import { sceneForSeed } from './scenery.js';
import { woodlandMaps } from './maps/woodland.js';
import { waterMaps } from './maps/water.js';
import { structureMaps } from './maps/structures.js';
import { habitatMaps } from './maps/habitats.js';

const MAP_HEIGHT = 340;
const GROUND = 314;
const TYPES = [...woodlandMaps, ...waterMaps, ...structureMaps, ...habitatMaps];
export const LANDMARKS = Object.freeze(TYPES.map(({ id, name }) => Object.freeze({ id, name })));

export function landmarkIndices(seed) {
  const code = normalizeMapSeed(seed);
  if (!code) throw new RangeError('A map seed must have six hexadecimal digits.');
  return Array.from(code, digit => Number.parseInt(digit, 16));
}

function between(random, low, high) {
  return low + (high - low) * random();
}

function drawing() {
  const nodes = [];
  const edges = [];
  function node(x, y) {
    const entry = { id: 'n' + nodes.length, x, y };
    if (y === GROUND) entry.ground = true;
    nodes.push(entry);
    return entry;
  }
  function edge(a, b, part = 'branch', control) {
    const index = edges.length;
    const entry = { id: 'e' + index, a: a.id, b: b.id, color: 'green', part };
    if (control) entry.control = { x: control.x, y: control.y };
    edges.push(entry);
    return index;
  }
  function path(points, part = 'branch') {
    return points.slice(1).map((to, i) => edge(points[i], to, part));
  }
  return { nodes, edges, node, edge, path };
}

function attachLandmark(field, slot, type, random) {
  const local = drawing();
  local.hub = local.node(60, 250);
  type.build(local, random);
  // Authors work in the same 120-unit local coordinate space in all six
  // positions, including when computing curve controls from returned nodes.
  const offset = 15 + slot * 150;
  const placed = new Map(local.nodes.map(n => [n.id, field.node(n.x + offset, n.y)]));
  for (const e of local.edges) {
    const control = e.control && { x: e.control.x + offset, y: e.control.y };
    field.edge(placed.get(e.a), placed.get(e.b), e.part, control);
  }
  return placed.get(local.hub.id);
}

function buildSupports(field, hubs, random) {
  const supports = hubs.map(hub => {
    const x = hub.x + between(random, -8, 8);
    const y = between(random, 274, 281);
    const support = field.node(x, y);
    field.edge(support, hub, 'landmark stem',
      { x: x + between(random, -3, 3), y: (hub.y + y) / 2 });
    return support;
  });
  for (let i = 0; i < supports.length - 1; i++) {
    const a = supports[i], b = supports[i + 1];
    field.edge(a, b, 'support bridge', {
      x: (a.x + b.x) / 2 + between(random, -12, 12), y: between(random, 257, 268),
    });
  }
  // The extra ground next to the left end orients the chain even when
  // coordinates and part names are ignored. Each of its six upper motifs
  // connects by exactly one stem, outside the paths between grounded roots.
  for (const index of [0, 1, 5]) {
    const anchor = supports[index];
    const foot = field.node(anchor.x + between(random, -17, 17), GROUND);
    field.edge(foot, anchor, 'root', {
      x: foot.x + between(random, -5, 5), y: between(random, 292, 301),
    });
  }
  const gaps = [0, 1, 2, 3, 4];
  const count = Math.min(3, Math.floor((100 - field.edges.length) / 2));
  const bridges = Math.max(1, Math.min(count, 1 + Math.floor(random() * 3)));
  for (let i = 0; i < bridges; i++) {
    const gap = gaps.splice(Math.floor(random() * gaps.length), 1)[0];
    const a = supports[gap], b = supports[gap + 1];
    const mid = field.node((a.x + b.x) / 2 + between(random, -12, 12), between(random, 296, 303));
    field.edge(a, mid, 'support arch', { x: (a.x + mid.x) / 2, y: mid.y });
    field.edge(mid, b, 'support arch', { x: (b.x + mid.x) / 2, y: mid.y });
  }
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function subdivision(a, b, control) {
  if (!control) return { joint: midpoint(a, b) };
  const left = midpoint(a, control);
  const right = midpoint(control, b);
  return { joint: midpoint(left, right), left, right };
}

function lengthOf(a, b, control) {
  if (!control) return Math.hypot(a.x - b.x, a.y - b.y);
  let length = 0, previous = a;
  for (let i = 1; i <= 6; i++) {
    const t = i / 6, s = 1 - t;
    const x = s * s * a.x + 2 * t * s * control.x + t * t * b.x;
    const y = s * s * a.y + 2 * t * s * control.y + t * t * b.y;
    length += Math.hypot(previous.x - x, previous.y - y);
    previous = { x, y };
  }
  return length;
}

function subdivideLongEdges(field, random) {
  const target = Math.max(field.edges.length, 82 + Math.floor(random() * 19));
  const nodes = new Map(field.nodes.map(n => [n.id, n]));
  const candidates = [];
  function enqueue(edge) {
    const a = nodes.get(edge.a), b = nodes.get(edge.b);
    const length = lengthOf(a, b, edge.control);
    if (length >= 38) candidates.push({ edge, a, b, length });
  }
  field.edges.forEach(enqueue);
  while (field.edges.length < target && candidates.length) {
    candidates.sort((a, b) => a.length - b.length);
    const { edge, a, b } = candidates.pop();
    const split = subdivision(a, b, edge.control);
    const p = split.joint;
    if (field.nodes.some(n => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 < 17 ** 2)) continue;
    const joint = field.node(p.x, p.y);
    nodes.set(joint.id, joint);
    edge.b = joint.id;
    // De Casteljau preserves both the entire quadratic and its tangent at
    // the new playable joint. The left child keeps the original edge index.
    if (split.left) edge.control = split.left;
    const second = field.edge(joint, b, edge.part, split.right);
    enqueue(edge);
    enqueue(field.edges[second]);
  }
}

function openingCuts(field) {
  const vertices = new Map();
  const adjacency = [[]];
  for (const n of field.nodes) {
    vertices.set(n.id, n.ground ? 0 : adjacency.length);
    if (!n.ground) adjacency.push([]);
  }
  field.edges.forEach((e, index) => {
    const a = vertices.get(e.a), b = vertices.get(e.b);
    adjacency[a].push([b, index]);
    adjacency[b].push([a, index]);
  });
  const entry = new Uint16Array(adjacency.length);
  const low = new Uint16Array(adjacency.length);
  const cascade = new Set();
  let time = 0;
  function explore(at, parentEdge) {
    low[at] = entry[at] = ++time;
    for (const [next, edge] of adjacency[at]) {
      if (edge === parentEdge) continue;
      if (entry[next]) {
        low[at] = Math.min(low[at], entry[next]);
      } else {
        explore(next, edge);
        low[at] = Math.min(low[at], low[next]);
        if (low[next] > entry[at] && adjacency[next].length > 1) cascade.add(edge);
      }
    }
  }
  explore(0, -1);
  const roots = [], loads = [];
  field.edges.forEach((e, index) => {
    const grounded = vertices.get(e.a) === 0 || vertices.get(e.b) === 0;
    if (grounded && !cascade.has(index)) roots.push(index);
    if (!grounded && cascade.has(index)) loads.push(index);
  });
  return { roots, loads };
}

export function composeMap(seed, randomSource) {
  const mapSeed = normalizeMapSeed(seed);
  const indices = landmarkIndices(mapSeed);
  const field = drawing();
  const hubs = indices.map((digit, slot) => attachLandmark(field, slot, TYPES[digit],
    randomSource(JSON.stringify([4, mapSeed, slot, 'landmark']))));
  buildSupports(field, hubs, randomSource(JSON.stringify([4, mapSeed, 'supports'])));
  subdivideLongEdges(field, randomSource(JSON.stringify([4, mapSeed, 'joints'])));
  return {
    nodes: field.nodes, edges: field.edges, ...openingCuts(field), mapSeed,
    landmarks: indices.map(i => TYPES[i].name), family: sceneForSeed(mapSeed).name,
    height: MAP_HEIGHT, groundY: GROUND,
  };
}
