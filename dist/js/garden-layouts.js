const GROUND = 314;
const HEIGHT = 340;
const FAMILIES = ['Wildflower meadow', 'Orchard grove', 'Vine trellis', 'Interwoven garden'];
const RESERVE = {
  'Wildflower meadow': 'Garden reserve 1',
  'Orchard grove': 'Garden reserve 25',
  'Vine trellis': 'Garden reserve 15',
  'Interwoven garden': 'Garden reserve 6',
};

function range(random, low, high) {
  return low + random() * (high - low);
}

function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

function shuffled(random, items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function point(x, y) {
  return { x, y };
}

function drawing() {
  const nodes = [];
  const edges = [];
  const roots = [];
  const loads = [];
  function node(position) {
    const p = { id: 'n' + nodes.length, x: Math.round(position.x), y: Math.round(position.y) };
    if (p.y === GROUND) p.ground = true;
    nodes.push(p);
    return p;
  }
  function link(a, b, part, control) {
    const index = edges.length;
    const edge = { id: 'e' + index, a: a.id, b: b.id, color: 'green', part };
    if (control) edge.control = { x: Math.round(control.x), y: Math.round(control.y) };
    if (a.ground || b.ground) roots.push(index);
    edges.push(edge);
    return index;
  }
  return { nodes, edges, roots, loads, node, link };
}

// A leaf has two independent curved sides, one joint on its underside, and a
// pointed tip. All three contours are ordinary playable edges.
function leaf(graph, start, end, width, part = 'leaf') {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const offset = (along, side) => point(
    start.x + along * dx - side * dy / length,
    start.y + along * dy + side * dx / length
  );
  const tip = graph.node(end);
  const belly = graph.node(offset(0.48, -width * 0.70));
  graph.link(start, tip, part, offset(0.50, width * 1.45));
  graph.link(tip, belly, part, offset(0.76, -width * 0.76));
  graph.link(belly, start, part, offset(0.30, -width * 0.46));
  return tip;
}

function planting(graph, random, left, right, naturalWidth) {
  const cx = (left + right) / 2;
  const scale = Math.min(1.16, (right - left - 8) / naturalWidth);
  const mirror = random() < 0.5 ? -1 : 1;
  const lean = range(random, -0.026, 0.026);
  const height = range(random, 0.96, 1.045);
  const at = (x, y) => point(cx + x * scale * mirror + (GROUND - y) * lean,
    GROUND - (GROUND - y) * height);
  return { graph, random, at, node: (x, y) => graph.node(at(x, y)) };
}

function stemRoot(plant, base, x) {
  const { graph, at, node } = plant;
  return graph.link(node(x, GROUND), base, 'root', at(x + 6, 282));
}

function flower(plant, petals, extraLeaf, tall) {
  const { graph, random, at, node } = plant;
  const base = node(-5, 251);
  const stalkY = tall ? 198 : 211;
  const stalk = node(5, stalkY);
  stemRoot(plant, base, -16);
  graph.link(base, stalk, 'stem', at(10, 217));
  leaf(graph, stalk, at(-58, stalkY - 23), 13);
  if (extraLeaf) leaf(graph, base, at(54, 230), 11);

  const cy = tall ? range(random, 84, 99) : range(random, 108, 121);
  const cx = range(random, -4, 8);
  const coreRadius = petals === 6 ? 23 : 20;
  const radius = tall ? range(random, 60, 67) : range(random, 50, 58);
  const step = 2 * Math.PI / petals;
  const polar = (theta, distance, tangent = 0) => at(
    cx + distance * Math.cos(theta) - tangent * Math.sin(theta),
    cy + distance * Math.sin(theta) + tangent * Math.cos(theta)
  );
  const core = Array.from({ length: petals }, (_, i) => graph.node(polar(Math.PI / 2 + step * i, coreRadius)));
  graph.loads.push(graph.link(stalk, core[0], 'stem', at(cx, cy + coreRadius + 30)));
  for (let i = 0; i < petals; i++) {
    const angle = Math.PI / 2 + (i + 0.5) * step;
    const a = core[i];
    const b = core[(i + 1) % petals];
    const reach = radius * range(random, 0.90, 1.07);
    const nearStem = i === 0 || i === petals - 1;
    const fullness = nearStem ? range(random, 0.48, 0.60) : range(random, 0.78, 0.90);
    const width = Math.min(44, reach * Math.tan(step / 2) * fullness);
    const outer = graph.node(polar(angle, reach));
    graph.link(a, b, 'flower center', polar(angle, coreRadius / Math.cos(step / 2)));
    graph.link(a, outer, 'petal', polar(angle, reach, -width));
    graph.link(outer, b, 'petal', polar(angle, reach, width));
  }
  return { left: base, right: base, upperLeft: stalk, upperRight: stalk };
}

function tree(plant, lush, leader) {
  const { graph, random, at, node } = plant;
  const base = node(-1, 232);
  const footL = node(-28, 273);
  const footR = node(27, 273);
  graph.link(node(-51, GROUND), footL, 'root', at(-47, 288));
  graph.link(node(48, GROUND), footR, 'root', at(38, 291));
  graph.link(footL, base, 'root', at(-9, 258));
  graph.link(base, footR, 'root', at(9, 252));
  graph.link(footL, footR, 'root arch', at(-1, 309));

  const fork = node(4, 168);
  const armL = node(-52, 125);
  const armR = node(52, 128);
  const upright = random() < 0.5;
  const outL = node(upright ? -74 : -90, upright ? 92 : 80);
  const inL = node(-38, upright ? 75 : 67);
  const top = node(upright ? 5 : 3, upright ? 35 : 50);
  const inR = node(43, upright ? 78 : 73);
  const outR = node(upright ? 73 : 89, upright ? 108 : 94);
  graph.link(base, fork, 'trunk', at(14, 201));
  graph.link(fork, armL, 'bough', at(-17, 143));
  graph.link(fork, armR, 'bough', at(31, 151));
  graph.link(armL, outL, 'bough', at(-76, 109));
  graph.link(armL, inL, 'bough', at(-35, 99));
  graph.link(armR, inR, 'bough', at(34, 100));
  graph.link(armR, outR, 'bough', at(77, 120));
  graph.link(outL, inL, 'canopy', at(upright ? -75 : -82, upright ? 52 : 30));
  graph.link(inL, top, 'canopy', at(-26, upright ? 38 : 21));
  graph.link(top, inR, 'canopy', at(32, upright ? 37 : 17));
  graph.link(inR, outR, 'canopy', at(upright ? 73 : 85, upright ? 54 : 36));
  if (leader) {
    const highFork = node(-6, 110);
    graph.link(fork, highFork, 'bough', at(-4, 143));
    graph.link(highFork, top, 'bough', at(-6, 75));
    graph.link(highFork, inR, 'bough', at(22, 98));
  } else {
    graph.link(fork, top, 'bough', at(-4, 106));
  }
  const hanging = node(-76, 153);
  graph.loads.push(graph.link(armL, hanging, 'hanging bough', at(-75, 127)));
  if (lush) leaf(graph, hanging, at(-57, 190), 10);
  else graph.link(hanging, node(-64, 182), 'twig', at(-78, 166));
  if (lush && random() < 0.6) {
    const bud = node(78, 155);
    graph.link(armR, bud, 'twig', at(70, 132));
  }
  return { left: base, right: base, upperLeft: fork, upperRight: fork };
}

function bud(plant) {
  const { graph, at, node } = plant;
  const base = node(1, 250);
  const stalk = node(-5, 187);
  const neck = node(13, 124);
  const a = node(-11, 87);
  const b = node(34, 89);
  const tip = node(10, 45);
  stemRoot(plant, base, 14);
  graph.link(base, stalk, 'stem', at(-12, 220));
  graph.loads.push(graph.link(stalk, neck, 'stem', at(-3, 153)));
  graph.link(neck, a, 'petal', at(-12, 110));
  graph.link(a, tip, 'petal', at(-11, 67));
  graph.link(tip, b, 'petal', at(34, 69));
  graph.link(b, neck, 'petal', at(37, 111));
  graph.link(neck, tip, 'flower center', at(23, 82));
  leaf(graph, stalk, at(50, 169), 10);
  return { left: base, right: base, upperLeft: stalk, upperRight: stalk };
}

function trellis(plant, bays, lavish) {
  const { graph, random, at, node } = plant;
  const posts = [];
  const half = bays === 1 ? 79 : 115;
  const pitch = half * 2 / bays;
  for (let i = 0; i <= bays; i++) {
    const x = -half + pitch * i;
    const base = node(x, range(random, 242, 252));
    const middle = node(x + range(random, -4, 4), range(random, 174, 183));
    const cap = node(x + range(random, -6, 6), range(random, 107, 128));
    graph.link(node(x + range(random, -8, 8), GROUND), base, 'root');
    graph.link(base, middle, 'trellis post');
    graph.link(middle, cap, 'trellis post');
    posts.push({ base, middle, cap, x });
  }
  for (let i = 0; i < bays; i++) {
    const a = posts[i];
    const b = posts[i + 1];
    const x = (a.x + b.x) / 2;
    const crownY = range(random, 57, 78);
    const arch = node(x, crownY);
    const cross = node(x + range(random, -4, 4), range(random, 173, 184));
    const shoulderY = random() < 0.46 ? crownY + 24 : crownY - 2;
    graph.link(a.cap, arch, 'arbor arch', at(a.x + pitch * 0.13, shoulderY));
    graph.link(arch, b.cap, 'arbor arch', at(b.x - pitch * 0.13, shoulderY));
    graph.link(a.base, cross, 'lattice');
    graph.link(cross, b.cap, 'lattice');
    graph.link(a.cap, cross, 'lattice');
    graph.link(cross, b.base, 'lattice');
    const hanging = node(x - 7, 211);
    graph.loads.push(graph.link(cross, hanging, 'hanging vine', point(cross.x, cross.y + 16)));
    if (lavish || random() < 0.5) leaf(graph, hanging, at(x + 11, 241), 9);
    else graph.link(hanging, node(x + 12, 237), 'tendril', at(x - 8, 230));
    if (lavish || random() < 0.72) {
      leaf(graph, a.middle, at(a.x + pitch * 0.32, 174), Math.min(10, pitch * 0.09));
    }
    if (lavish && random() < 0.65) {
      const shoot = node(x + 11, crownY - 26);
      graph.link(arch, shoot, 'shoot', at(x + 11, crownY - 9));
    }
  }
  const ordered = posts.slice().sort((a, b) => a.base.x - b.base.x);
  return {
    left: ordered[0].base, right: ordered.at(-1).base,
    upperLeft: ordered[0].middle, upperRight: ordered.at(-1).middle,
  };
}

const PLANS = {
  'Wildflower meadow': ['flower', 'flower', 'tree', 'arbor'],
  'Orchard grove': ['tree', 'flower', 'tree', 'arbor'],
  'Vine trellis': ['tree', 'double arbor', 'bud', 'flower'],
  'Interwoven garden': ['tree', 'flower', 'arbor', 'flower'],
};
const WIDTHS = { flower: 1.02, tree: 1.20, arbor: 1.05, 'double arbor': 1.45, bud: 0.68 };

function plantGarden(random, family, opening) {
  const graph = drawing();
  const kinds = opening ? PLANS[family] : shuffled(random, PLANS[family]);
  const weights = kinds.map(kind => WIDTHS[kind] * range(random, 0.94, 1.06));
  const usable = 858;
  const total = weights.reduce((sum, value) => sum + value, 0);
  let x = 21;
  let blooms = 0;
  const pieces = kinds.map((kind, i) => {
    const width = usable * weights[i] / total;
    const natural = kind === 'tree' ? 201 : kind === 'double arbor' ? 249 : 178;
    const plant = planting(graph, random, x, x + width, natural);
    x += width;
    if (kind === 'tree') return tree(plant, family === 'Orchard grove' || random() < 0.53,
      opening || random() < 0.56);
    if (kind === 'bud') return bud(plant);
    if (kind === 'flower') {
      const petals = opening ? [5, 4][blooms] :
        family === 'Wildflower meadow' ? pick(random, [5, 5, 6]) : pick(random, [4, 5, 5, 6]);
      return flower(plant, petals, random() < 0.56, blooms++ % 2 === 0);
    }
    return trellis(plant, kind === 'double arbor' ? 2 : 1,
      family === 'Vine trellis' || random() < 0.40);
  });

  // The root runners and elevated grafts attach at different levels of each
  // plant. A cut through a graft can change which neighboring roots hold a
  // crown, while whole blossoms can still be cut at their own necks.
  const grafts = family === 'Interwoven garden' ? [0, 1, 2] : shuffled(random, [0, 1, 2]).slice(0, 2);
  for (let i = 0; i < pieces.length - 1; i++) {
    const a = pieces[i].right;
    const b = pieces[i + 1].left;
    const midX = (a.x + b.x) / 2;
    const mid = graph.node(point(midX, range(random, 258, 274)));
    graph.link(a, mid, 'root runner', point(a.x + (midX - a.x) * 0.57, a.y + 9));
    graph.link(mid, b, 'root runner', point(midX + (b.x - midX) * 0.57, b.y + 9));
    if (!grafts.includes(i)) continue;
    const upperA = pieces[i].upperRight;
    const upperB = pieces[i + 1].upperLeft;
    const knot = graph.node(point((upperA.x + upperB.x) / 2, range(random, 197, 209)));
    graph.link(upperA, knot, 'graft', point((upperA.x + knot.x) / 2, upperA.y + 22));
    graph.link(knot, upperB, 'graft', point((knot.x + upperB.x) / 2, upperB.y + 22));
    if (i === grafts[0]) {
      const hanging = graph.node(point(knot.x + range(random, -10, 10), knot.y + 24));
      graph.loads.push(graph.link(knot, hanging, 'hanging vine', point(knot.x - 8, knot.y + 9)));
      graph.link(hanging, graph.node(point(hanging.x + 18, hanging.y + 16)), 'tendril',
        point(hanging.x + 2, hanging.y + 17));
    }
  }
  return graph;
}

function atCurve(a, control, b, t) {
  const s = 1 - t;
  return point(s * s * a.x + 2 * s * t * control.x + t * t * b.x,
    s * s * a.y + 2 * s * t * control.y + t * t * b.y);
}

function turn(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentDistanceSquared(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

function inspectGeometry(graph) {
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  for (let i = 0; i < graph.nodes.length; i++) {
    const a = graph.nodes[i];
    for (let j = 0; j < i; j++) {
      const b = graph.nodes[j];
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < 16 ** 2) return false;
    }
  }
  const paths = [];
  for (const edge of graph.edges) {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < 18 ** 2) return false;
    const mid = edge.control ? atCurve(a, edge.control, b, 0.5) : point((a.x + b.x) / 2, (a.y + b.y) / 2);
    const path = [a];
    if (edge.control) {
      for (let j = 1; j < 10; j++) path.push(atCurve(a, edge.control, b, j / 10));
    }
    path.push(b);
    const xx = path.map(p => p.x);
    const yy = path.map(p => p.y);
    const left = Math.min(...xx), right = Math.max(...xx), top = Math.min(...yy), bottom = Math.max(...yy);
    if (left < 10 || right > 890 || top < 12 || bottom > GROUND) return false;
    for (const prior of paths) {
      if (left > prior.right + 8 || right < prior.left - 8 || top > prior.bottom + 8 || bottom < prior.top - 8) continue;
      const shared = a === prior.a || b === prior.a || a === prior.b || b === prior.b;
      for (let j = 1; j < path.length; j++) {
        const c = path[j - 1], d = path[j];
        if (segmentDistanceSquared(prior.mid, c, d) < 6.2 ** 2) return false;
        for (let k = 1; k < prior.path.length; k++) {
          const p = prior.path[k - 1], q = prior.path[k];
          if (turn(c, d, p) * turn(c, d, q) < 0 && turn(p, q, c) * turn(p, q, d) < 0) return false;
          if (!shared && Math.min(segmentDistanceSquared(c, p, q), segmentDistanceSquared(d, p, q),
            segmentDistanceSquared(p, c, d), segmentDistanceSquared(q, c, d)) < 7.3 ** 2) return false;
        }
      }
      for (let j = 1; j < prior.path.length; j++) {
        if (segmentDistanceSquared(mid, prior.path[j - 1], prior.path[j]) < 6.2 ** 2) return false;
      }
    }
    paths.push({ a, b, path, mid, left, right, top, bottom });
  }
  return true;
}

export function botanicalGarden(seed, randomSource) {
  const family = seed === 'GROVE7' ? 'Interwoven garden' :
    pick(randomSource(JSON.stringify([3, seed, 'family'])), FAMILIES);
  const random = randomSource(JSON.stringify([3, seed, 'layout']));
  let graph;
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = plantGarden(random, family, seed === 'GROVE7');
    if (candidate.edges.length >= 82 && candidate.edges.length <= 100 && inspectGeometry(candidate)) {
      graph = candidate;
      break;
    }
  }
  // These first-draw layouts are verified for their particular families. The
  // limit also bounds reconstruction work when opening an arbitrary link.
  if (!graph) graph = plantGarden(randomSource(RESERVE[family]), family, false);
  return { nodes: graph.nodes, edges: graph.edges, roots: graph.roots, loads: graph.loads,
    family, height: HEIGHT, groundY: GROUND };
}
