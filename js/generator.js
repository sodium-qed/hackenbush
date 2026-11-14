const GROUND_Y = 244;
const LEFT = 35;
const RIGHT = 865;
const MAX_RISE = 209;
const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

export function generateBoard(seed = 'GROVE7', variant = 'green', difficulty = 'standard') {
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

export function freshSeed() {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, value => SEED_ALPHABET[value % SEED_ALPHABET.length]).join('');
}
