// A verified color-reversing rooted graph bijection identifies a number with
// the negative of its partner. Partition refinement only selects candidates.
// The incremental adjacency checks verify *all* loops and parallel multiplicities.
function view(graph, mask, root, flip) {
  const adjacent = new Map([[root, new Map()]]);
  function add(a, b, blue) {
    if (!adjacent.has(a)) adjacent.set(a, new Map());
    const neighbors = adjacent.get(a);
    if (!neighbors.has(b)) neighbors.set(b, [0, 0]);
    neighbors.get(b)[blue ? 0 : 1]++;
  }
  for (let bits = mask; bits; bits &= bits - 1n) {
    const edge = graph.edges[graph.bitIndex.get(bits & -bits)];
    const blue = (edge.color === 'blue') !== flip;
    add(edge.a, edge.b, blue);
    if (edge.a !== edge.b) add(edge.b, edge.a, blue);
  }
  for (const neighbors of adjacent.values()) {
    for (const [other, counts] of neighbors) neighbors.set(other, counts.join('/'));
  }
  return { adjacent, labels: new Map([...adjacent.keys()].map(id => [id, id === root ? 1 : 0])) };
}

export function* oppositeGraphs(graph, a, b, root) {
  const source = view(graph, a, root, false);
  const target = view(graph, b, root, true);
  if (source.adjacent.size !== target.adjacent.size) return false;

  for (let round = 0; round < 4; round++) {
    yield;
    const classes = new Map();
    for (const network of [source, target]) {
      const next = new Map();
      for (const [id, neighbors] of network.adjacent) {
        const neighborhood = [...neighbors].map(([v, pair]) => pair + '@' + network.labels.get(v)).sort();
        const signature = network.labels.get(id) + ':' + neighborhood.join(',');
        if (!classes.has(signature)) classes.set(signature, classes.size);
        next.set(id, classes.get(signature));
      }
      network.labels = next;
    }
  }

  const candidates = new Map();
  for (const [id, label] of target.labels) {
    if (!candidates.has(label)) candidates.set(label, []);
    candidates.get(label).push(id);
  }
  const vertices = [...source.adjacent.keys()];
  if (vertices.some(id => !candidates.has(source.labels.get(id)))) return false;
  vertices.sort((u, v) => candidates.get(source.labels.get(u)).length - candidates.get(source.labels.get(v)).length
    || source.adjacent.get(v).size - source.adjacent.get(u).size);
  const paired = new Map();
  const used = new Set();
  // Failure of this optional, bounded search says nothing about the game.
  const limit = Math.max(64, 3 * vertices.length);
  let attempts = 0;
  function* match(index) {
    if (index === vertices.length) return true;
    const u = vertices[index];
    const neighbors = source.adjacent.get(u);
    for (const v of candidates.get(source.labels.get(u))) {
      if (used.has(v)) continue;
      if (++attempts > limit) return false;
      yield;
      const other = target.adjacent.get(v);
      if (neighbors.get(u) !== other.get(v)) continue;
      let valid = true;
      for (const [s, t] of paired) {
        if (neighbors.get(s) !== other.get(t)) { valid = false; break; }
      }
      if (!valid) continue;
      paired.set(u, v);
      used.add(v);
      if (yield* match(index + 1)) return true;
      paired.delete(u);
      used.delete(v);
    }
    return false;
  }
  return yield* match(0);
}
