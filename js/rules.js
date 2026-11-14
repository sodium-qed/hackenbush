// The board is immutable, so all positions on it can share one adjacency list.
const graphs = new WeakMap();

function graphFor(board) {
  if (graphs.has(board)) return graphs.get(board);

  const edges = new Map();
  const incident = new Map(board.nodes.map(({ id }) => [id, []]));
  const roots = board.nodes.filter((node) => node.ground).map((node) => node.id);

  for (const edge of board.edges) {
    edges.set(edge.id, edge);
    incident.get(edge.a).push(edge);
    incident.get(edge.b).push(edge);
  }

  const graph = { edges, incident, roots };
  graphs.set(board, graph);
  return graph;
}

function groundedNodes(graph, active) {
  const pending = [...graph.roots];
  const grounded = new Set(pending);
  while (pending.length) {
    const node = pending.pop();
    for (const edge of graph.incident.get(node)) {
      if (!active.has(edge.id)) continue;
      const neighbor = edge.a === node ? edge.b : edge.a;
      if (grounded.has(neighbor)) continue;
      grounded.add(neighbor);
      pending.push(neighbor);
    }
  }
  return grounded;
}

function canCut(edge, side) {
  return edge && (edge.color === 'green' || edge.color === side);
}

export function otherSide(side) {
  return side === 'blue' ? 'red' : 'blue';
}

export function initialEdges(board) {
  const graph = graphFor(board);
  const grounded = groundedNodes(graph, new Set(graph.edges.keys()));
  return board.edges.filter((edge) => grounded.has(edge.a)).map((edge) => edge.id);
}

export function legalMoves(board, live, side) {
  const graph = graphFor(board);
  return live.filter((id) => canCut(graph.edges.get(id), side));
}

export function cutEdge(board, live, edgeId, side) {
  const graph = graphFor(board);
  if (!canCut(graph.edges.get(edgeId), side)) return null;
  const remaining = new Set(live);
  if (!remaining.delete(edgeId)) return null;

  const grounded = groundedNodes(graph, remaining);
  const standing = [];
  const fallen = [];
  for (const id of remaining) {
    const edge = graph.edges.get(id);
    if (grounded.has(edge.a)) standing.push(id);
    else fallen.push(id);
  }
  return { live: standing, fallen };
}

export function winner(board, live, toMove) {
  return legalMoves(board, live, toMove).length ? null : otherSide(toMove);
}
