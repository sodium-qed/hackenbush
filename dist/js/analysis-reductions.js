import { fixed, supported } from './analysis-dyadics.js';

// The shortest Hackenbush stalk for a dyadic. Its initial monochrome run
// counts in whole moves. After the first change, successive signs have
// weights 1/2, 1/4, 1/8, ... . Reflect the colors for a negative number.
function canonicalStalk(value, unit) {
  const positive = value < 0n ? 'red' : 'blue';
  const negative = value < 0n ? 'blue' : 'red';
  const magnitude = value < 0n ? -value : value;
  const colors = Array(Number(magnitude / unit)).fill(positive);
  const remainder = magnitude % unit;
  if (remainder) {
    colors.push(positive, negative);
    let difference = remainder - unit / 2n;
    for (let weight = unit / 4n; difference; weight >>= 1n) {
      if (difference > 0n) { colors.push(positive); difference -= weight; }
      else { colors.push(negative); difference += weight; }
    }
  }
  return colors;
}

// Preserve a residual graph's core and all of its grounding paths. Peel
// non-ground leaves, accounting for loops as attached one-edge games. At each
// surviving vertex replace its whole pendant forest only if equivalence saves
// edges. Synthetic edge IDs are private to this proof and never reach gameplay.
export function compressHangingTrees(graph, mask) {
  const size = graph.incident.length;
  const unit = 1n << BigInt(graph.edges.length);
  const degree = new Uint32Array(size);
  const sums = Array(size).fill(0n);
  const hanging = Array(size).fill(0n);
  const lengths = new Uint32Array(size);
  let core = mask;
  for (let bits = mask; bits; bits &= bits - 1n) {
    const bit = bits & -bits;
    const { a, b, color } = graph.edges[graph.bitIndex.get(bit)];
    if (a === b) {
      sums[a] += color === 'blue' ? unit : -unit;
      hanging[a] |= bit;
      lengths[a]++;
      core &= ~bit;
    } else {
      degree[a]++;
      degree[b]++;
    }
  }
  const leaves = [];
  for (let v = 1; v < size; v++) if (degree[v] === 1) leaves.push(v);
  while (leaves.length) {
    const v = leaves.pop();
    const bit = graph.incident[v] & core;
    if (!bit) continue;
    const { a, b, color } = graph.edges[graph.bitIndex.get(bit)];
    const parent = a === v ? b : a;
    sums[parent] += supported(color, fixed(sums[v]), unit).lo;
    hanging[parent] |= bit | hanging[v];
    lengths[parent] += 1 + lengths[v];
    hanging[v] = 0n;
    core &= ~bit;
    if (--degree[parent] === 1 && parent !== 0) leaves.push(parent);
  }

  let keep = core;
  const added = [];
  let nextVertex = size;
  for (let v = 0; v < size; v++) {
    if (!hanging[v]) continue;
    const colors = canonicalStalk(sums[v], unit);
    if (colors.length >= lengths[v]) {
      keep |= hanging[v];
      continue;
    }
    let base = v;
    for (const color of colors) {
      added.push({ a: base, b: nextVertex, color });
      base = nextVertex++;
    }
  }
  if (keep === mask) return null;
  const edges = [];
  const vertices = new Set([0]);
  function add({ a, b, color }) {
    vertices.add(a);
    vertices.add(b);
    edges.push({ id: edges.length, a, b, color });
  }
  for (let bits = keep; bits; bits &= bits - 1n) add(graph.edges[graph.bitIndex.get(bits & -bits)]);
  for (const edge of added) add(edge);
  return { nodes: [...vertices].map(id => ({ id, ground: id === 0 })), edges };
}
