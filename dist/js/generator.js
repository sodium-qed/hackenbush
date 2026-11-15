import { botanicalGarden } from './garden-layouts.js';
import { composeMap } from './map-catalog.js';
import { CURRENT_BOARD_VERSION } from './map-seed.js';
import { generateWorld } from './world-generator.js';

const GROUND_Y = 244;
const LEFT = 35;
const RIGHT = 865;
const MAX_RISE = 209;

// A point is [x, height above ground]. Each path traces adjoining edges.
function motif(points, paths) {
  const edges = paths.flatMap(path =>
    path.slice(1).map((to, index) => [path[index], to])
  );
  return { points, edges };
}

const bentStem = motif(
  [[0, 0], [3, 63], [-26, 106]],
  [[0, 1, 2]]
);
const uprightStem = motif(
  [[0, 0], [-12, 48], [-4, 108]],
  [[0, 1, 2]]
);
const fork = motif(
  [[0, 0], [-2, 68], [-39, 109], [34, 123]],
  [[0, 1, 2], [1, 3]]
);
const switchback = motif(
  [[0, 0], [0, 49], [-29, 90], [-24, 145]],
  [[0, 1, 2, 3]]
);
const gate = motif(
  [[-49, 0], [-34, 71], [30, 85], [51, 0]],
  [[0, 1, 2, 3]]
);
const highFork = motif(
  [[0, 0], [3, 52], [-11, 109], [-49, 148], [19, 161]],
  [[0, 1, 2, 3], [2, 4]]
);
const longFork = motif(
  [[0, 0], [-4, 67], [-42, 110], [24, 106], [38, 159]],
  [[0, 1, 2], [1, 3, 4]]
);
const fan = motif(
  [[0, 0], [2, 72], [-46, 114], [-4, 144], [47, 116]],
  [[0, 1, 2], [1, 3], [1, 4]]
);
const arch = motif(
  [[-54, 0], [-39, 71], [1, 105], [40, 70], [55, 0]],
  [[0, 1, 2, 3, 4]]
);
const leaf = motif(
  [[0, 0], [-38, 58], [3, 122], [36, 65]],
  [[0, 1, 2, 3, 0]]
);
const bough = motif(
  [[0, 0], [-4, 66], [-47, 115], [19, 119], [-6, 169], [58, 159]],
  [[0, 1, 2], [1, 3, 4], [3, 5]]
);
const alternating = motif(
  [[0, 0], [0, 54], [-41, 94], [5, 108], [44, 149], [-7, 173]],
  [[0, 1, 2], [1, 3, 4], [3, 5]]
);
const lowFork = motif(
  [[0, 0], [-23, 54], [-58, 95], [21, 55], [17, 112], [46, 155]],
  [[0, 1, 2], [0, 3, 4, 5]]
);
const sproutingArch = motif(
  [[-54, 0], [-38, 70], [0, 112], [42, 72], [57, 0], [27, 154]],
  [[0, 1, 2, 3, 4], [2, 5]]
);
const eyelet = motif(
  [[0, 0], [0, 55], [-38, 106], [0, 157], [38, 106]],
  [[0, 1, 2, 3, 4, 1]]
);
const spread = motif(
  [[0, 0], [-3, 60], [-31, 108], [-68, 141], [-19, 162], [31, 105], [52, 155]],
  [[0, 1, 2, 3], [2, 4], [1, 5, 6]]
);
const layered = motif(
  [[0, 0], [1, 54], [-46, 95], [13, 102], [54, 133], [0, 148], [-22, 191]],
  [[0, 1, 2], [1, 3, 4], [3, 5, 6]]
);
const archBranch = motif(
  [[-60, 0], [-42, 72], [0, 106], [44, 62], [63, 0], [9, 150], [-16, 192]],
  [[0, 1, 2, 3, 4], [2, 5, 6]]
);
const leafTip = motif(
  [[0, 0], [-5, 53], [-42, 100], [1, 147], [34, 96], [17, 193]],
  [[0, 1, 2, 3, 4, 1], [3, 5]]
);
const canopy = motif(
  [[0, 0], [-2, 60], [-34, 106], [-65, 146], [-21, 162], [33, 112], [23, 171], [71, 149]],
  [[0, 1, 2, 3], [2, 4], [1, 5, 6], [5, 7]]
);
const lopsided = motif(
  [[0, 0], [2, 55], [-37, 94], [14, 97], [49, 124], [3, 143], [-26, 176], [29, 187]],
  [[0, 1, 2], [1, 3, 4], [3, 5, 6], [5, 7]]
);
const crownedArch = motif(
  [[-62, 0], [-42, 74], [2, 107], [48, 64], [64, 0], [-57, 125], [11, 152], [38, 189]],
  [[0, 1, 2, 3, 4], [1, 5], [2, 6, 7]]
);
const forkedLeaf = motif(
  [[0, 0], [-2, 53], [-41, 101], [0, 145], [39, 100], [-29, 184], [33, 184]],
  [[0, 1, 2, 3, 4, 1], [3, 5], [3, 6]]
);

const TREES = {
  2: [bentStem, uprightStem],
  3: [fork, fork, switchback],
  4: [highFork, longFork, fan],
  5: [bough, alternating, lowFork],
  6: [spread, layered],
  7: [canopy, lopsided],
};

const BRIDGES_AND_LOOPS = {
  3: [gate],
  4: [arch, leaf],
  5: [sproutingArch, eyelet],
  6: [archBranch, leafTip],
  7: [crownedArch, forkedLeaf],
};

const SIZES = {
  small: [6, 9],
  standard: [11, 16],
  large: [17, 22],
};

function randomSource(label) {
  let state = 2166136261;
  for (let index = 0; index < label.length; index++) {
    state = Math.imul(state ^ label.charCodeAt(index), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = Math.imul(state ^ (state >>> 15), 1 | state);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), 61 | bits);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random, min, max) {
  return min + random() * (max - min);
}

function choose(random, values) {
  return values[Math.floor(random() * values.length)];
}

function shuffle(random, values) {
  for (let end = values.length - 1; end > 0; end--) {
    const index = Math.floor(random() * (end + 1));
    [values[index], values[end]] = [values[end], values[index]];
  }
  return values;
}

function componentSizes(random, difficulty) {
  const [min, max] = SIZES[difficulty];
  const total = Math.floor(between(random, min, max + 1));
  let options;
  if (difficulty === 'small') options = total < 8 ? [2] : [2, 3];
  else if (difficulty === 'large') options = [4, 5];
  else options = total < 14 ? [3, 3, 4] : [3, 4, 4, 5];

  const sizes = Array(choose(random, options)).fill(2);
  for (let left = total - sizes.length * 2; left > 0; left--) {
    const available = sizes.flatMap((size, index) => size < 7 ? [index] : []);
    sizes[choose(random, available)]++;
  }
  return sizes;
}

function transform(shape, xScale, yScale, lean) {
  const points = shape.points.map(([x, rise]) => [
    x * xScale + rise * lean,
    GROUND_Y - rise * yScale,
  ]);
  return { points, edges: shape.edges };
}

function generatedPieces(random, difficulty) {
  const sizes = componentSizes(random, difficulty);
  const candidates = sizes.flatMap((size, index) => size >= 3 ? [index] : []);
  const special = random() < 0.53 ? choose(random, candidates) : -1;
  const pieces = sizes.map((size, index) => {
    const shape = choose(random, index === special ? BRIDGES_AND_LOOPS[size] : TREES[size]);
    const maxRise = Math.max(...shape.points.map(point => point[1]));
    const yScale = Math.min(between(random, 0.95, 1.18), MAX_RISE / maxRise);
    const xScale = between(random, 0.98, 1.23) * (random() < 0.5 ? -1 : 1);
    return transform(shape, xScale, yScale, between(random, -0.09, 0.09));
  });

  // Use each silhouette's actual width so thin stalks and broad arches both
  // receive visible breathing room on either side.
  const bounds = pieces.map(piece => {
    const xs = piece.points.map(point => point[0]);
    return { min: Math.min(...xs), width: Math.max(...xs) - Math.min(...xs) };
  });
  const occupied = bounds.reduce((sum, bound) => sum + bound.width, 0);
  const minGap = 36;
  const free = RIGHT - LEFT - occupied - minGap * (pieces.length - 1);
  const weights = [between(random, 0.44, 0.68)];
  for (let index = 1; index < pieces.length; index++) weights.push(between(random, 0.88, 1.14));
  weights.push(between(random, 0.44, 0.68));
  const unit = free / weights.reduce((sum, weight) => sum + weight, 0);
  let left = LEFT + weights[0] * unit;
  pieces.forEach((piece, index) => {
    piece.origin = left - bounds[index].min;
    left += bounds[index].width + minGap + weights[index + 1] * unit;
  });
  return pieces;
}

function openingPieces() {
  return [
    { ...transform(fork, 1.08, 1.02, 0), origin: 126 },
    { ...transform(bough, 1.14, 1.12, -0.015), origin: 329 },
    { ...transform(sproutingArch, 1.04, 1.06, 0.015), origin: 560 },
    { ...transform(bentStem, -1.06, 1.09, 0.01), origin: 771 },
  ];
}

function colorEdges(edges, rootEdges, random, variant) {
  if (variant === 'green') return;
  const palette = shuffle(random, variant === 'mixed' ? ['red', 'blue', 'green'] : ['red', 'blue']);
  const bag = Array.from({ length: edges.length }, (_, index) => palette[index % palette.length]);
  const roots = shuffle(random, rootEdges.slice());

  // Give both players an opening cut at a supporting root, in different
  // components. The remaining colors are drawn from the balanced bag.
  const reserved = new Set();
  ['red', 'blue'].forEach((color, index) => {
    const anchor = choose(random, roots[index]);
    edges[anchor].color = color;
    reserved.add(anchor);
    bag.splice(bag.indexOf(color), 1);
  });
  shuffle(random, bag);
  edges.forEach((edge, index) => {
    if (!reserved.has(index)) edge.color = bag.pop();
  });
}

// Version 1 is the original seeded field. Its ordering and random draws are
// part of invitations and saved move histories.
function legacyBoard(seed, variant, difficulty) {
  const label = String(seed);
  const size = Object.hasOwn(SIZES, difficulty) ? difficulty : 'standard';
  const colorVariant = variant === 'redblue' || variant === 'mixed' ? variant : 'green';
  const geometry = randomSource(JSON.stringify([label, size, 'geometry']));
  const pieces = label === 'GROVE7' && size === 'standard'
    ? openingPieces()
    : generatedPieces(geometry, size);
  const nodes = [];
  const edges = [];
  const rootEdges = [];

  for (const piece of pieces) {
    const offset = nodes.length;
    for (const [x, y] of piece.points) {
      const node = { id: 'n' + nodes.length, x: Math.round(x + piece.origin), y: Math.round(y) };
      if (y === GROUND_Y) node.ground = true;
      nodes.push(node);
    }
    const roots = [];
    for (const [from, to] of piece.edges) {
      const a = nodes[offset + from];
      const b = nodes[offset + to];
      if (a.ground || b.ground) roots.push(edges.length);
      edges.push({ id: 'e' + edges.length, a: a.id, b: b.id, color: 'green' });
    }
    rootEdges.push(roots);
  }
  const colors = randomSource(JSON.stringify([label, size, colorVariant, 'colors']));
  colorEdges(edges, rootEdges, colors, colorVariant);
  return { nodes, edges };
}

const NETWORK_SIZES = {
  small: { edges: [12, 18], columns: [3], cycles: [1], roots: [2] },
  standard: { edges: [24, 32], columns: [4, 5], cycles: [2, 3], roots: [2, 3] },
  large: { edges: [36, 48], columns: [6, 7], cycles: [3, 4], roots: [3, 4] },
};

// Crowns grow from the upper junction of a stem. The first form at each size
// of two or more has a supporting first edge with further growth above it.
const CROWNS = [
  [],
  [motif([[0, 0], [25, 43]], [[0, 1]])],
  [
    motif([[0, 0], [9, 36], [-12, 72]], [[0, 1, 2]]),
    motif([[0, 0], [-28, 39], [28, 46]], [[0, 1], [0, 2]]),
  ],
  [
    motif([[0, 0], [2, 36], [-27, 68], [31, 75]], [[0, 1, 2], [1, 3]]),
    motif([[0, 0], [-24, 36], [-43, 73], [28, 46]], [[0, 1, 2], [0, 3]]),
  ],
  [
    motif([[0, 0], [-12, 34], [-43, 62], [-7, 79], [29, 38]], [[0, 1, 2], [1, 3], [0, 4]]),
    motif([[0, 0], [19, 35], [44, 69], [-18, 38], [-36, 79]], [[0, 1, 2], [0, 3, 4]]),
  ],
  [
    motif([[0, 0], [-14, 36], [-47, 66], [-9, 79], [24, 36], [41, 77]], [[0, 1, 2], [1, 3], [0, 4, 5]]),
    motif([[0, 0], [-12, 33], [-38, 66], [17, 57], [7, 90], [49, 82]], [[0, 1, 2], [1, 3, 4], [3, 5]]),
  ],
];

// Each hollow is made of two ordered paths between neighboring stems. Some
// meet in a fork, others reach two different heights on both sides.
const HOLLOW_PATHS = [
  [[0, 0], [1, 1]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0]],
  [[1, 0], [1, 1]],
  [[0, 1], [1, 1]],
];

function drawing() {
  const nodes = [];
  const edges = [];
  function node(x, y) {
    const point = { id: 'n' + nodes.length, x: Math.round(x), y: Math.round(y) };
    if (point.y === GROUND_Y) point.ground = true;
    nodes.push(point);
    return point;
  }
  function edge(a, b) {
    const index = edges.length;
    edges.push({ id: 'e' + index, a: a.id, b: b.id, color: 'green' });
    return index;
  }
  return { nodes, edges, node, edge };
}

function networkPlan(random, size) {
  const config = NETWORK_SIZES[size];
  const total = Math.floor(between(random, config.edges[0], config.edges[1] + 1));
  const count = choose(random, config.columns);
  const columns = Array.from({ length: count }, (_, i) => i);
  const overhang = random() < 0.5 ? 0 : count - 1;
  const outerGap = overhang === 0 ? 0 : count - 2;
  const interior = columns.filter(i => i !== overhang);
  const loaded = choose(random, interior);
  const crown = Array(count).fill(0);
  crown[loaded] = size === 'small' ? 2 : 3;
  crown[overhang] = size === 'small' ? 1 : size === 'standard' ? 2 : 3;
  if (size === 'large') crown[choose(random, interior.filter(i => i !== loaded))] = 2;

  const rootCount = choose(random, config.roots);
  const rootSplit = Math.floor(count / 2) + (overhang === 0 ? 1 : 0);
  const roots = [
    choose(random, interior.filter(i => i < rootSplit)),
    choose(random, interior.filter(i => i >= rootSplit)),
  ];
  roots.push(...shuffle(random, interior.filter(i => !roots.includes(i))).slice(0, rootCount - 2));
  const hollows = shuffle(random, columns.slice(0, -1).filter(i => i !== outerGap))
    .slice(0, choose(random, config.cycles));
  const links = [];
  for (let gap = 0; gap < count - 1; gap++) {
    if (hollows.includes(gap)) {
      const paths = choose(random, HOLLOW_PATHS);
      links.push({ gap, ports: paths[0], side: 'low' }, { gap, ports: paths[1], side: 'high' });
    } else {
      links.push({ gap, ports: choose(random, [[0, 0], [1, 0], [0, 1], [1, 1]]), side: 'single' });
    }
  }
  const used = count + roots.length + links.length + crown.reduce((sum, length) => sum + length, 0);
  // Spend the remaining edges on different levels of the same connected
  // growth. A bend can in turn carry a new shoot in the middle of a span.
  for (let left = total - used; left > 0; left--) {
    const choices = [];
    columns.forEach(i => {
      if (crown[i] < 5) choices.push(() => { crown[i]++; });
      if (crown[i] === 0) choices.push(() => { crown[i]++; });
    });
    links.forEach(link => {
      if (!link.bent) choices.push(() => { link.bent = true; });
      else if (link.side !== 'low' && !link.shoot) choices.push(() => { link.shoot = true; });
    });
    choose(random, choices)();
  }
  return { count, roots, overhang, outerGap, loaded, crown, links };
}

function growNetwork(random, size) {
  const plan = networkPlan(random, size);
  const graph = drawing();
  const roots = [];
  const loads = [];
  const start = between(random, 94, 113);
  const end = between(random, 787, 806);
  const spacing = (end - start) / (plan.count - 1);
  const stems = Array.from({ length: plan.count }, (_, index) => {
    const wobble = index > 0 && index < plan.count - 1 ? between(random, -0.1, 0.1) * spacing : 0;
    const x = start + spacing * index + wobble;
    const topY = plan.crown[index] >= 3 ? between(random, 103, 144) : between(random, 91, 151);
    const base = graph.node(x, Math.min(207, topY + between(random, 45, 73)));
    const top = graph.node(x + between(random, -23, 23), topY);
    graph.edge(base, top);
    if (plan.roots.includes(index)) {
      const root = graph.node(x + between(random, -31, 31), GROUND_Y);
      roots.push(graph.edge(root, base));
    }
    return [base, top];
  });

  plan.links.forEach(link => {
    const [left, right] = link.ports;
    const a = stems[link.gap][left];
    const b = stems[link.gap + 1][right];
    const first = graph.edges.length;
    if (link.bent) {
      const t = between(random, 0.39, 0.61);
      const sign = link.side === 'single' ? choose(random, [-1, 1]) : link.side === 'low' ? 1 : -1;
      const mid = graph.node(a.x + (b.x - a.x) * t,
        Math.min(214, a.y + (b.y - a.y) * t + sign * between(random, 16, 33)));
      graph.edge(a, mid);
      graph.edge(mid, b);
      if (link.shoot) {
        const tip = graph.node(mid.x + between(random, -19, 19),
          Math.max(35, mid.y - between(random, 37, 54)));
        graph.edge(mid, tip);
      }
    } else {
      graph.edge(a, b);
    }
    if (link.gap === plan.outerGap) {
      loads.push(first + (plan.overhang === 0 && link.bent ? 1 : 0));
    }
  });

  plan.crown.forEach((length, index) => {
    if (!length) return;
    const shape = index === plan.loaded ? CROWNS[length][0] : choose(random, CROWNS[length]);
    const top = stems[index][1];
    const tallest = Math.max(...shape.points.map(point => point[1]));
    const ys = Math.min(between(random, 0.98, 1.16), (top.y - 35) / tallest);
    const reach = Math.min(spacing * 0.36, top.x - LEFT - 2, RIGHT - top.x - 2);
    const xs = Math.min(between(random, 0.99, 1.31), reach / 49) * choose(random, [-1, 1]);
    const points = [top, ...shape.points.slice(1).map(([dx, rise]) => graph.node(top.x + dx * xs, top.y - rise * ys))];
    if (index === plan.loaded) loads.push(graph.edges.length);
    for (const [a, b] of shape.edges) graph.edge(points[a], points[b]);
  });
  return { nodes: graph.nodes, edges: graph.edges, roots, loads };
}

function openingNetwork() {
  const grove = motif([
    [113, 244], [134, 179], [94, 119], [49, 86], [99, 65], [190, 143], [247, 165],
    [239, 103], [171, 91], [250, 64], [219, 38], [278, 35], [328, 190], [399, 151],
    [378, 244], [429, 96], [408, 48], [468, 61], [496, 117], [555, 98], [559, 163],
    [470, 178], [578, 244], [611, 72], [648, 125], [717, 157], [764, 104], [747, 60],
    [824, 78], [765, 198],
  ], [
    [0, 1, 2, 3], [2, 4], [1, 5, 6, 7, 8, 2], [7, 9, 10], [9, 11], [6, 12, 13],
    [14, 13, 15, 16], [15, 17], [15, 18, 19, 20, 21, 13], [20, 22],
    [20, 24, 25, 26, 27], [26, 28], [25, 29], [19, 23, 24],
  ]);
  const graph = drawing();
  const nodes = grove.points.map(([x, y]) => graph.node(x, y));
  const roots = [];
  const loads = [];
  for (const [a, b] of grove.edges) {
    const index = graph.edge(nodes[a], nodes[b]);
    if (nodes[a].ground || nodes[b].ground) roots.push(index);
    if ((a === 7 && b === 9) || (a === 24 && b === 25)) loads.push(index);
  }
  return { nodes: graph.nodes, edges: graph.edges, roots, loads };
}

function gapSquared(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

function turn(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function wellSpaced(network) {
  const points = new Map(network.nodes.map(point => [point.id, point]));
  for (const [index, point] of network.nodes.entries()) {
    for (let previous = 0; previous < index; previous++) {
      const other = network.nodes[previous];
      if ((point.x - other.x) ** 2 + (point.y - other.y) ** 2 < 30 ** 2) return false;
    }
  }
  const segments = [];
  for (const edge of network.edges) {
    const a = points.get(edge.a);
    const b = points.get(edge.b);
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < 32 ** 2) return false;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const { c, d, center } of segments) {
      if (gapSquared(mid, c, d) < 14 ** 2 || gapSquared(center, a, b) < 14 ** 2) return false;
      if (a === c || a === d || b === c || b === d) continue;
      if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) return false;
      if (Math.min(gapSquared(a, c, d), gapSquared(b, c, d),
        gapSquared(c, a, b), gapSquared(d, a, b)) < 20 ** 2) return false;
    }
    segments.push({ c: a, d: b, center: mid });
  }
  return true;
}

function colorNetwork(network, random, variant) {
  if (variant === 'green') return;
  const palette = shuffle(random, variant === 'mixed' ? ['red', 'blue', 'green'] : ['red', 'blue']);
  const bag = Array.from({ length: network.edges.length }, (_, index) => palette[index % palette.length]);
  const reserved = new Set();
  // Each player gets an exclusive cut that brings down further edges and
  // a second, independent choice at a ground support.
  for (const indices of [network.roots, network.loads]) {
    const picks = shuffle(random, indices.slice());
    ['red', 'blue'].forEach((color, index) => {
      network.edges[picks[index]].color = color;
      reserved.add(picks[index]);
      bag.splice(bag.indexOf(color), 1);
    });
  }
  shuffle(random, bag);
  network.edges.forEach((edge, index) => {
    if (!reserved.has(index)) edge.color = bag.pop();
  });
}

function networkForSeed(label, size) {
  if (label === 'GROVE7' && size === 'standard') return openingNetwork();
  const random = randomSource(JSON.stringify([2, label, size, 'geometry']));
  for (let attempt = 0; attempt < 96; attempt++) {
    const network = growNetwork(random, size);
    if (wellSpaced(network)) return network;
  }
  // The first drawing from this stream meets the spacing limits at all three
  // sizes. It bounds generation time even for a run of crowded layouts.
  const reserve = randomSource(JSON.stringify([2, 'GROVE-RESERVE-1', size, 'geometry']));
  return growNetwork(reserve, size);
}

export function generateBoard(seed, variant = 'green', difficulty = 'expert', boardVersion = CURRENT_BOARD_VERSION) {
  if (boardVersion === 5 || boardVersion === '5') {
    const code = seed === undefined ? 'A35D7E' : seed;
    const { roots, loads, ...board } = generateWorld(code);
    const colors = variant === 'redblue' ? 'redblue' : 'green';
    colorNetwork({ edges: board.edges, roots, loads }, randomSource(JSON.stringify([5, board.mapSeed, colors])), colors);
    return board;
  }
  if (boardVersion === 4 || boardVersion === '4') {
    const map = composeMap(seed === undefined ? 'A35D7E' : seed, randomSource);
    const colors = variant === 'redblue' ? 'redblue' : 'green';
    colorNetwork(map, randomSource(JSON.stringify([4, map.mapSeed, colors])), colors);
    return { nodes: map.nodes, edges: map.edges, family: map.family, height: map.height,
      groundY: map.groundY, mapSeed: map.mapSeed, landmarks: map.landmarks };
  }
  const label = seed === undefined ? 'GROVE7' : String(seed);
  if (boardVersion === 1 || boardVersion === '1') return legacyBoard(label, variant, difficulty);
  if (boardVersion === 3 || boardVersion === '3') {
    const garden = botanicalGarden(label, randomSource);
    const colors = variant === 'redblue' ? 'redblue' : 'green';
    colorNetwork(garden, randomSource(JSON.stringify([3, label, colors])), colors);
    return { nodes: garden.nodes, edges: garden.edges, family: garden.family,
      height: garden.height, groundY: garden.groundY };
  }
  if (boardVersion !== 2 && boardVersion !== '2') throw new RangeError('Unknown board version.');
  const size = Object.hasOwn(NETWORK_SIZES, difficulty) ? difficulty : 'standard';
  const colors = variant === 'redblue' || variant === 'mixed' ? variant : 'green';
  const network = networkForSeed(label, size);
  colorNetwork(network, randomSource(JSON.stringify([2, label, size, colors])), colors);
  return { nodes: network.nodes, edges: network.edges };
}

export function freshSeed() {
  const bytes = new Uint8Array(3);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}
