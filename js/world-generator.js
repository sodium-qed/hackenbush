import { normalizeMapSeed, permuteMapNumber } from './map-seed.js';
import { growLandmark } from './world-growth.js';
import { connectCrowns } from './world-weave.js';

const HEIGHT = 340, GROUND = 314;
const BIOMES = [
  { id: 'meadow', name: 'Wildflower meadow', heroes: ['sunflower', 'sunflower', 'sunflower', 'oak'],
    flora: ['sunflower', 'sunflower', 'reed', 'oak', 'mushroom', 'orchard'] },
  { id: 'orchard', name: 'Orchard grove', heroes: ['orchard', 'orchard', 'arbor', 'sunflower'],
    flora: ['orchard', 'orchard', 'sunflower', 'arbor', 'mushroom', 'oak'] },
  { id: 'wetland', name: 'Willow marsh', heroes: ['willow', 'reed', 'lily'],
    flora: ['willow', 'reed', 'reed', 'lily', 'lily', 'sunflower'] },
  { id: 'highland', name: 'Alpine pass', heroes: ['stone', 'stone', 'pine'],
    flora: ['pine', 'pine', 'stone', 'sunflower', 'reed', 'mushroom'] },
  { id: 'woodland', name: 'Woodland clearing', heroes: ['oak', 'willow', 'mushroom', 'pine'],
    flora: ['oak', 'mushroom', 'mushroom', 'pine', 'willow', 'sunflower'] },
  { id: 'coast', name: 'Tidal coast', heroes: ['stone', 'willow', 'pine'],
    flora: ['pine', 'reed', 'stone', 'willow', 'lily', 'sunflower'] },
  { id: 'canyon', name: 'Sandstone canyon', heroes: ['stone', 'stone', 'cactus'],
    flora: ['cactus', 'cactus', 'stone', 'sunflower', 'pine', 'reed'] },
  { id: 'terrace', name: 'Vine terraces', heroes: ['arbor', 'arbor', 'orchard'],
    flora: ['arbor', 'sunflower', 'orchard', 'reed', 'willow', 'arbor'] },
];

function randomSource(word) {
  let state = word;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = Math.imul(state ^ (state >>> 15), 1 | state);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), 61 | bits);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}

function range(random, a, b) { return a + (b - a) * random(); }
function choose(random, list) { return list[Math.floor(random() * list.length)]; }

// Count the distinct sets of five to eight ground attachments on this grid.
// Adjacent roots are 40–310 units apart, with supports toward both margins.
// Each count admits more than 2^22 arrangements. The two count bits and the
// rank therefore survive in the playable grounded vertices themselves. No
// coordinate jitter, invisible tag, PRNG collision assumption or retry is
// needed to distinguish the 2^24 layouts.
const LAST = 83, RANKS = 1 << 22;
const counts = new Map();
function groundOptions(left, previous) {
  if (!left) return previous >= 62 ? 1 : 0;
  const cacheKey = left * 100 + previous;
  if (counts.has(cacheKey)) return counts.get(cacheKey);
  const first = previous < 0 ? 0 : previous + 4;
  const last = previous < 0 ? 21 : Math.min(LAST, previous + 31);
  let n = 0;
  for (let cell = first; cell <= last; cell++) n += groundOptions(left - 1, cell);
  counts.set(cacheKey, n);
  return n;
}

function groundPositions(word) {
  const number = 5 + (word >>> 22);
  const available = groundOptions(number, -1);
  // The multiplication can exceed JS's exact integer range for eight roots.
  let rank = Number(BigInt(word & (RANKS - 1)) * BigInt(available) / BigInt(RANKS));
  const positions = [];
  let previous = -1;
  for (let left = number; left; left--) {
    const first = previous < 0 ? 0 : previous + 4;
    const last = previous < 0 ? 21 : Math.min(LAST, previous + 31);
    for (let cell = first; cell <= last; cell++) {
      const block = groundOptions(left - 1, cell);
      if (rank < block) {
        positions.push(35 + 10 * cell);
        previous = cell;
        break;
      }
      rank -= block;
    }
  }
  return positions;
}

function drawing() {
  const nodes = [], edges = [];
  const round = n => Math.round(n * 10) / 10;
  function node(x, y, ground = false) {
    const n = { id: 'n' + nodes.length, x: round(x), y: round(y) };
    if (ground) n.ground = true;
    nodes.push(n);
    return n;
  }
  function link(a, b, part, control, feature) {
    const e = { id: 'e' + edges.length, a: a.id, b: b.id, color: 'green', part };
    if (control) e.control = { x: round(control.x), y: round(control.y) };
    if (feature) e.feature = feature;
    edges.push(e);
    return e;
  }
  return { nodes, edges, node, link };
}

function composition(biome, random) {
  const n = choose(random, [3, 3, 4, 4, 4, 5, 5]);
  const main = Math.floor(random() * n);
  const others = Array.from({ length: n }, (_, i) => i).filter(i => i !== main);
  const second = choose(random, others);
  const kinds = Array(n);
  kinds[main] = choose(random, biome.heroes);
  let flowers = 0;
  for (let i = 0; i < n; i++) {
    if (i === main) continue;
    const options = biome.flora.filter(kind => kinds.filter(k => k === kind).length < 2);
    kinds[i] = !kinds.includes('sunflower') && random() < 0.16 ? 'sunflower' : choose(random, options);
  }
  const gutter = range(random, 9, 17);
  const room = 876 - gutter * (n - 1);
  const minimum = kinds.map((kind, i) => i === main ? 155 : i === second ? 128 : 98);
  const weights = kinds.map((kind, i) => i === main ? range(random, 2.7, 4.4) :
    i === second ? range(random, 1.3, 2.2) : range(random, 0.46, 1.28));
  const total = weights.reduce((a, b) => a + b);
  const extra = room - minimum.reduce((a, b) => a + b);
  const slope = range(random, -19, 19);
  let left = 12;
  const stands = kinds.map((kind, i) => {
    const width = minimum[i] + extra * weights[i] / total;
    const top = i === main ? range(random, 17, 40) : i === second ? range(random, 33, 83) : range(random, 61, 135);
    const base = range(random, 235, 258) + slope * (i / (n - 1) - 0.5);
    const area = { left, width, top, base, kind };
    if (kind === 'sunflower') flowers++;
    left += width + gutter;
    return area;
  });
  return { stands, main, flowers };
}

function breaksFor(stands, ground, random, biome) {
  const boundaries = stands.slice(1).map(s => s.left - 6);
  const target = random() < (biome === 'wetland' || biome === 'coast' ? 0.52 : 0.32)
    ? (stands.length === 5 && random() < 0.26 ? 2 : 1) : 0;
  const cuts = [];
  let candidates = boundaries.slice();
  while (cuts.length < target && candidates.length) {
    const x = choose(random, candidates);
    candidates = candidates.filter(c => c !== x);
    const margins = [-Infinity, ...[...cuts, x].sort((a, b) => a - b), Infinity];
    if (margins.slice(1).every((end, i) => ground.some(g => g >= margins[i] && g < end))) cuts.push(x);
  }
  return new Set(cuts);
}

function graft(field, a, b, random) {
  const dx = b.x - a.x;
  const sag = range(random, -8, 18);
  if (dx < 51 || random() < 0.40) {
    field.link(a, b, 'graft', { x: a.x + dx * 0.53, y: (a.y + b.y) / 2 + sag });
    return;
  }
  const knot = field.node(a.x + dx * range(random, 0.43, 0.57), (a.y + b.y) / 2 + sag);
  field.link(a, knot, 'graft', { x: (a.x + knot.x) / 2, y: (a.y + knot.y) / 2 + 4 });
  field.link(knot, b, 'graft', { x: (knot.x + b.x) / 2, y: (knot.y + b.y) / 2 + 4 });
  if (random() < 0.54) {
    const tendril = field.node(knot.x + range(random, -4, 4), knot.y + 19);
    field.link(knot, tendril, 'hanging vine', { x: knot.x - 5, y: knot.y + 11 });
    field.link(tendril, field.node(tendril.x + 13, tendril.y + 12), 'tendril',
      { x: tendril.x + 1, y: tendril.y + 11 });
  }
}

function knitStands(field, stands, ground, random, biome) {
  const breaks = breaksFor(stands, ground, random, biome);
  const beds = [{ ports: [...stands[0].bases], until: Infinity }];
  for (let i = 1; i < stands.length; i++) {
    const l = stands[i - 1], r = stands[i];
    const seam = r.left - 6;
    if (breaks.has(seam)) {
      beds.at(-1).until = seam;
      beds.push({ ports: [...r.bases], until: Infinity });
      continue;
    }
    const upper = random() < 0.78;
    if (upper) graft(field, l.ports[1], r.ports[0], random);
    if (!upper || random() < 0.64) {
      const a = l.bases.at(-1), b = r.bases[0];
      const mid = field.node(a.x + (b.x - a.x) * range(random, 0.42, 0.58),
        Math.min(272, Math.max(a.y, b.y) + range(random, 2, 14)));
      field.link(a, mid, 'root runner', { x: (a.x + mid.x) / 2, y: a.y + 5 });
      field.link(mid, b, 'root runner', { x: (mid.x + b.x) / 2, y: b.y + 5 });
      beds.at(-1).ports.push(mid);
    }
    beds.at(-1).ports.push(...r.bases);
  }
  return { beds, breaks };
}

function rootFan(field, port, feet, random) {
  if (!feet.length) return;
  const bend = range(random, 0.55, 0.70);
  function attach(stem, foot) {
    field.link(stem, foot, 'root', { x: stem.x + (foot.x - stem.x) * bend,
      y: stem.y + (GROUND - stem.y) * 0.47 });
  }
  if (feet.length === 1) {
    attach(port, feet[0]);
    return;
  }
  if (port.x < feet[0].x + 7 || port.x > feet.at(-1).x - 7) {
    const middle = (feet[0].x + feet.at(-1).x) / 2;
    const fork = field.node(middle + 0.1 * (port.x - middle), Math.max(port.y + 17, 282));
    field.link(port, fork, 'prop root', { x: port.x + (fork.x - port.x) * 0.45, y: (port.y + fork.y) / 2 });
    for (const foot of feet) attach(fork, foot);
    return;
  }
  // A stand can catch the ground on spreading prop roots, via a common fork,
  // or on either side of a hollow. Which neighboring supports it shares then
  // depends on the grafts and rhizomes above it.
  const split = Math.ceil(feet.length / 2);
  const groups = [feet.slice(0, split), feet.slice(split)];
  const gap = groups[1][0].x - groups[0].at(-1).x;
  const level = Math.max(port.y + 17, range(random, 280, 288));
  const knees = groups.map((group, i) => {
    const knee = field.node(i ? group[0].x - gap * 0.07 : group.at(-1).x + gap * 0.07, level);
    field.link(port, knee, 'prop root', { x: (port.x + knee.x) / 2, y: port.y + 0.41 * (knee.y - port.y) });
    for (const foot of group) attach(knee, foot);
    return knee;
  });
  if (random() < 0.69) {
    field.link(knees[0], knees[1], 'root arch',
      { x: (knees[0].x + knees[1].x) / 2, y: Math.max(knees[0].y, knees[1].y) + 11 });
  }
}

function putDownRoots(field, beds, positions, random) {
  let start = -Infinity;
  for (const bed of beds) {
    const ports = bed.ports.slice().sort((a, b) => a.x - b.x);
    const groups = ports.map(() => []);
    const boundaries = ports.slice(1).map((p, i) =>
      ports[i].x + (p.x - ports[i].x) * range(random, 0.36, 0.64));
    for (const x of positions.filter(x => x >= start && x < bed.until)) {
      const next = boundaries.findIndex(limit => x < limit);
      groups[next < 0 ? groups.length - 1 : next].push(field.node(x, GROUND, true));
    }
    groups.forEach((feet, i) => rootFan(field, ports[i], feet, random));
    start = bed.until;
  }
}

function interpolate(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function addJoints(field, random) {
  const target = Math.max(field.edges.length + Math.floor(random() * 4), 78 + Math.floor(random() * 13));
  const candidates = [];
  for (const edge of field.edges) {
    const a = field.nodes[Number(edge.a.slice(1))], b = field.nodes[Number(edge.b.slice(1))];
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    if (length < 49 || a.ground || b.ground || ['leaf', 'petal', 'flower center', 'fruit',
      'reed head', 'pinecone', 'lily pad', 'cactus pad', 'prop root'].includes(edge.part)) continue;
    candidates.push({ edge, a, b, score: length * range(random, 0.77, 1.24) });
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const { edge, a, b } of candidates) {
    if (field.edges.length >= target) break;
    const t = range(random, 0.42, 0.58);
    const c = edge.control;
    const left = c && interpolate(a, c, t), right = c && interpolate(c, b, t);
    const mid = c ? interpolate(left, right, t) : interpolate(a, b, t);
    if (field.nodes.some(n => (n.x - mid.x) ** 2 + (n.y - mid.y) ** 2 < 16 ** 2)) continue;
    const joint = field.node(mid.x, mid.y);
    edge.b = joint.id;
    if (left) edge.control = left;
    field.link(joint, b, edge.part, right, edge.feature);
  }
}

// With grounded vertices identified, a DFS bridge with an edge beyond it is
// precisely a move that makes another edge fall. This works across islands,
// including a stand whose only current support is an overhead graft.
function openingCuts({ nodes, edges }) {
  const vertex = new Map(), adjacency = [[]];
  for (const n of nodes) {
    vertex.set(n.id, n.ground ? 0 : adjacency.length);
    if (!n.ground) adjacency.push([]);
  }
  edges.forEach((e, i) => {
    const a = vertex.get(e.a), b = vertex.get(e.b);
    adjacency[a].push([b, i]);
    adjacency[b].push([a, i]);
  });
  const visited = new Uint16Array(adjacency.length), low = new Uint16Array(adjacency.length);
  const cascade = new Set();
  let time = 0;
  function explore(at, arriving) {
    low[at] = visited[at] = ++time;
    for (const [next, edge] of adjacency[at]) {
      if (edge === arriving) continue;
      if (visited[next]) low[at] = Math.min(low[at], visited[next]);
      else {
        explore(next, edge);
        low[at] = Math.min(low[at], low[next]);
        if (low[next] > visited[at] && adjacency[next].length > 1) cascade.add(edge);
      }
    }
  }
  explore(0, -1);
  const roots = [], loads = [];
  edges.forEach((e, i) => {
    const isRoot = vertex.get(e.a) === 0 || vertex.get(e.b) === 0;
    if (isRoot && !cascade.has(i)) roots.push(i);
    if (!isRoot && cascade.has(i)) loads.push(i);
  });
  return { roots, loads };
}

export function generateWorld(seed) {
  const mapSeed = normalizeMapSeed(seed);
  if (!mapSeed) throw new RangeError('A map seed must have six hexadecimal digits.');
  const word = permuteMapNumber(Number.parseInt(mapSeed, 16) ^ 0xb7283d);
  const random = randomSource(word);
  const biome = BIOMES[(word >>> 13) & 7];
  const wind = random() < 0.5 ? -1 : 1;
  const ground = groundPositions(word);
  const field = drawing();
  const { stands, main, flowers } = composition(biome, random);
  for (const stand of stands) {
    const firstNode = field.nodes.length;
    Object.assign(stand, growLandmark(field, stand, stand.kind, random, wind));
    stand.crownNodes = field.nodes.slice(firstNode);
  }
  const { beds, breaks } = knitStands(field, stands, ground, random, biome.id);
  putDownRoots(field, beds, ground, random);
  for (let i = 1; i < stands.length; i++) {
    if (breaks.has(stands[i].left - 6) || random() >= 0.77) continue;
    const nodesBefore = field.nodes.length, edgesBefore = field.edges.length;
    if (connectCrowns(field, stands[i - 1], stands[i], random) && openingCuts(field).loads.length < 2) {
      field.nodes.length = nodesBefore;
      field.edges.length = edgesBefore;
    }
  }
  addJoints(field, random);
  const hero = stands[main];
  const world = { biome: biome.id, focus: (hero.left + hero.width / 2) / 900, wind,
    horizon: range(random, 0.46, 0.68), dominant: hero.kind, landmarks: stands.map(s => s.kind),
    components: beds.length, flowers };
  return { nodes: field.nodes, edges: field.edges, ...openingCuts(field), mapSeed, family: biome.name,
    height: HEIGHT, groundY: GROUND, world };
}
