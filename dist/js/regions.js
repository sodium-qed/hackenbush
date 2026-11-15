// Painted cells are faces of the original embedded graph. Their identities are
// kept for the whole game: an opened petal cannot become part of a larger fill.
function materialOf(boundary) {
  const parts = boundary.map(step => step.edge.part || '');
  const feature = boundary[0].edge.feature;
  if (boundary.some(step => step.edge.feature !== feature)) return null;
  const names = parts.join('|');
  if (/support (arch|bridge)|root runner|landmark stem|graft/.test(names)) return null;
  if (parts.every(part => part === 'flower center')) return 'seeds';
  if (/lily pad/.test(names)) return 'pad';
  if ((feature === 'lily' && /petal/.test(names)) || /outer petal|central petal|petal fold|lotus/.test(names)) return 'lily';
  if (/petal/.test(names)) return 'petal';
  if (parts.includes('cap') || /mushroom|cap rim/.test(names)) return 'cap';
  if (parts.includes('pinecone')) return 'cone';
  if (/fruit|berry|apple|pear/.test(names)) return 'fruit';
  if (/leaf|pinna|frond|needle|blade/.test(names)) return 'leaf';
  if (/canopy|willow crown|mangrove crown|foliage/.test(names)) return feature === 'pine' ? 'evergreen' : 'canopy';
  if (/glass|glazing|window|pane/.test(names)) return 'glass';
  if (/cattail|reed head/.test(names)) return 'reed';
  if (/culm|bamboo joint|fiddlehead|fern vein|\brib\b|cactus/.test(names)) return 'succulent';
  if (/sail/.test(names)) return 'sail';
  if (/coral/.test(names)) return 'coral';
  if (/web|silk/.test(names)) return 'silk';
  if (/parapet|water surface|ripple|pool|pond/.test(names)) return 'water';
  if (/stone|rock face|rock seam|ridgeline|masonry|brick/.test(names)) return 'stone';
  if (/wheel|mill tower/.test(names)) return 'timber';
  if (/lattice|arbor arch/.test(names)) return 'trellis';
  if (/root arch|woven root/.test(names)) return 'earth';
  return null;
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function makeStep(edge, from, to) {
  const c = edge.control;
  // Just past the tangent, two arcs leaving a joint in the same direction
  // can already be distinguished by which side of each other they occupy.
  const epsilon = 0.00001;
  const dx = c ? 2 * (c.x - from.x) + epsilon * (to.x - 2 * c.x + from.x) : to.x - from.x;
  const dy = c ? 2 * (c.y - from.y) + epsilon * (to.y - 2 * c.y + from.y) : to.y - from.y;
  // Exact integral of x dy - y dx along a line or a quadratic Bezier.
  const area = c ? (2 * cross(from, c) + 2 * cross(c, to) + cross(from, to)) / 3 : cross(from, to);
  return { edge, from, to, angle: Math.atan2(dy, dx), area };
}

export function findRegions(board) {
  const nodes = new Map(board.nodes.map(node => [node.id, node]));
  const rays = new Map(board.nodes.map(node => [node, []]));
  const steps = [];
  for (const edge of board.edges) {
    const a = nodes.get(edge.a), b = nodes.get(edge.b);
    const forward = makeStep(edge, a, b), backward = makeStep(edge, b, a);
    forward.twin = backward;
    backward.twin = forward;
    rays.get(a).push(forward);
    rays.get(b).push(backward);
    steps.push(forward, backward);
  }
  for (const exits of rays.values()) {
    exits.sort((a, b) => a.angle - b.angle);
    for (let i = 0; i < exits.length; i++) {
      exits[i].twin.next = exits[(i + exits.length - 1) % exits.length];
    }
  }

  const regions = [], walked = new Set();
  for (const start of steps) {
    if (walked.has(start)) continue;
    const chain = [], positions = new Map([[start.from, 0]]);
    for (let step = start; !walked.has(step); step = step.next) {
      walked.add(step);
      chain.push(step);
      const earlier = positions.get(step.to);
      if (earlier === undefined) {
        positions.set(step.to, chain.length);
        continue;
      }
      // A hanging stamen, or even a second loop attached inside a glass pane,
      // is an excursion from its boundary. Close each simple contour on its
      // own. A reversal has zero area; an exterior circuit has negative area.
      const loop = chain.splice(earlier);
      for (let i = 1; i < loop.length; i++) positions.delete(loop[i].from);
      const area = loop.reduce((sum, segment) => sum + segment.area, 0) / 2;
      if (area <= 0.01) continue;
      const material = materialOf(loop);
      if (!material) continue;
      const boundary = loop.map(({ edge, from, to }) => ({ edge, from, to }));
      regions.push({ material, boundary, area, ids: boundary.map(step => step.edge.id) });
    }
  }
  return regions;
}

export function contourPath(boundary) {
  const { from } = boundary[0];
  let path = `M${from.x},${from.y}`;
  for (const { edge, to } of boundary) {
    const c = edge.control;
    path += c ? `Q${c.x},${c.y} ${to.x},${to.y}` : `L${to.x},${to.y}`;
  }
  return path + 'Z';
}
