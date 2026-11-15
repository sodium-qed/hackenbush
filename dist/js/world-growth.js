// Each growing space has its own width, height and shear. Its ports are real
// joints on the plant or structure, where neighboring growth can be grafted.
function space(field, area, random, wind, feature) {
  const { left, width, top, base } = area;
  const height = base - top;
  const facing = random() < 0.5 ? 1 : -1;
  const shear = wind * (0.012 + random() * 0.026);
  const at = (u, v) => ({
    x: left + width * ((facing > 0 ? u : 100 - u) / 100 + shear * (1 - v / 100)),
    y: top + height * v / 100,
  });
  function node(u, v) {
    const p = at(u, v);
    return field.node(p.x, p.y);
  }
  function edge(a, b, part, u, v) {
    return field.link(a, b, part, u === undefined ? undefined : at(u, v), feature);
  }
  function leaf(start, u, v, breadth, part = 'leaf') {
    const target = at(u, v);
    const dx = target.x - start.x, dy = target.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 15) return start;
    const tip = field.node(target.x, target.y);
    const radius = Math.min(breadth, length * 0.265) * facing;
    const p = (t, side) => ({ x: start.x + t * dx - radius * side * dy / length,
      y: start.y + t * dy + radius * side * dx / length });
    if (length < 32 || breadth < 5.8) {
      field.link(start, tip, part, p(0.54, -0.72), feature);
      return tip;
    }
    const side = p(0.47, 0.68);
    const joint = field.node(side.x, side.y);
    field.link(start, tip, part, p(0.52, -1.48), feature);
    field.link(start, joint, part, p(0.27, 0.68), feature);
    field.link(joint, tip, part, p(0.71, 0.79), feature);
    return tip;
  }
  return { field, area, random, feature, at, node, edge, leaf, height, width, facing };
}

function blossom(p, center, radius, count, stem) {
  const { field, random, feature, facing } = p;
  const disk = Math.max(13.5, radius * (count >= 7 ? 0.367 : 0.323));
  const angleStep = Math.PI * 2 / count;
  function polar(angle, reach, tangent = 0) {
    return { x: center.x + facing * (Math.cos(angle) * reach - Math.sin(angle) * tangent),
      y: center.y + Math.sin(angle) * reach + Math.cos(angle) * tangent };
  }
  const ring = Array.from({ length: count }, (_, i) => {
    const a = polar(Math.PI / 2 + angleStep * i, disk);
    return field.node(a.x, a.y);
  });
  field.link(stem, ring[0], 'stem', { x: ring[0].x, y: (stem.y + ring[0].y) / 2 }, feature);
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % count];
    const angle = Math.PI / 2 + (i + 0.5) * angleStep;
    const reach = radius * (0.91 + random() * 0.08);
    const fullness = i === 0 || i === count - 1 ? 0.53 : 0.77 + random() * 0.12;
    const breadth = reach * Math.tan(angleStep / 2) * fullness;
    const tip = polar(angle, reach);
    const outer = field.node(tip.x, tip.y);
    field.link(a, b, 'flower center', polar(angle, disk / Math.cos(angleStep / 2)), feature);
    field.link(a, outer, 'petal', polar(angle, reach, -breadth), feature);
    field.link(outer, b, 'petal', polar(angle, reach, breadth), feature);
  });
}

function sunflower(p) {
  const { node, edge, leaf, at, random, width, height, area } = p;
  const double = width > 235 && random() < 0.72;
  const headX = double ? 36 : 46 + random() * 9;
  const radius = Math.min(width * (double ? 0.282 : 0.392), height * (0.302 + random() * 0.041));
  const center = { x: at(headX, 12).x, y: area.top + radius + 1 };
  const base = node(49, 100), stalk = node(headX + 1, 78);
  edge(base, stalk, 'stem', 45, 87);
  const left = leaf(stalk, 5, 78, Math.min(14, width * 0.067));
  const right = leaf(base, 94, 67, Math.min(11, width * 0.057));
  const count = radius > 58 ? 6 + Math.floor(random() * 3) : radius > 42 ? 5 + Math.floor(random() * 2) : 5;
  blossom(p, center, radius, count, stalk);
  if (double) {
    const neck = node(80, 59), a = node(72, 48), tip = node(80, 34), b = node(88, 47);
    edge(stalk, neck, 'stem', 70, 74);
    edge(neck, a, 'petal', 73, 57);
    edge(a, tip, 'petal', 72, 40);
    edge(tip, b, 'petal', 87, 37);
    edge(b, neck, 'petal', 89, 58);
    edge(neck, tip, 'flower center', 83, 47);
  }
  return { bases: [base], ports: [left, right] };
}

function broadleaf(p, kind) {
  const { node, edge, leaf, random, width } = p;
  const willow = kind === 'willow';
  const base = node(49, 100), fork = node(46 + random() * 9, 73);
  const west = node(29, willow ? 37 : 45), east = node(71, willow ? 39 : 43);
  edge(base, fork, 'trunk', 54, 88);
  edge(fork, west, 'bough', 34, 62);
  edge(fork, east, 'bough', 59, 58);
  const many = width > 173;
  const leader = many && random() < 0.72 ? node(48 + random() * 5, 30) : null;
  if (leader) edge(fork, leader, 'bough', 48, 49);
  const xs = many ? [6, 19, 35, 51, 67, 83, 94] : [7, 24, 49, 73, 93];
  const rim = xs.map((x, i) => {
    const side = Math.abs(2 * i / (xs.length - 1) - 1);
    return node(x, 4 + 31 * side ** 1.8 + random() * 5);
  });
  const bare = random() < (willow ? 0.64 : 0.30) ? 1 + Math.floor(random() * (rim.length - 2)) : -1;
  for (let i = 0; i < rim.length; i++) {
    const x = xs[i];
    const source = x < 39 ? west : x > 64 ? east : leader ?? (x < 54 ? west : east);
    p.field.link(source, rim[i], 'bough', {
      x: source.x + (rim[i].x - source.x) * 0.39,
      y: source.y + (rim[i].y - source.y) * 0.63,
    }, kind);
    if (i && i !== bare) {
      const up = 3 + 24 * Math.abs((x + xs[i - 1]) / 100 - 1) ** 1.8;
      edge(rim[i - 1], rim[i], 'canopy', (x + xs[i - 1]) / 2, Math.max(0, up - 3));
    }
  }
  const left = node(7, willow ? 77 : 70), right = node(93, willow ? 72 : 67);
  const leftShoulder = willow ? rim[0] : west, rightShoulder = willow ? rim.at(-1) : east;
  edge(leftShoulder, left, willow ? 'weeping bough' : 'lower bough', 6, 50);
  edge(rightShoulder, right, willow ? 'weeping bough' : 'lower bough', 96, 47);
  if (willow) {
    const tassel = node(18, 64);
    edge(west, tassel, 'hanging vine', 17, 47);
    edge(tassel, node(20, 84), 'tendril', 16, 77);
    const fringe = node(82, 56);
    edge(east, fringe, 'hanging vine', 82, 45);
    if (width > 150) edge(fringe, node(78, 78), 'tendril', 83, 67);
  } else {
    for (const [branch, x] of [[west, 29], [east, 72]]) {
      if (branch === east && random() < 0.32) continue;
      const stem = node(x, 61);
      edge(branch, stem, kind === 'orchard' ? 'fruit stem' : 'hanging bough', x - 2, 54);
      leaf(stem, x + (branch === west ? 2 : -3), 77, Math.min(13, width * 0.068),
        kind === 'orchard' ? 'fruit' : 'leaf');
    }
  }
  return { bases: [base], ports: [left, right] };
}

function pine(p) {
  const { node, edge, leaf, random, width } = p;
  const base = node(49, 100), lower = node(48, 71), middle = node(51, 46), upper = node(53, 27);
  const apex = node(54 + random() * 6, 2);
  edge(base, lower, 'pine trunk', 46, 84);
  edge(lower, middle, 'pine trunk', 47, 55);
  edge(middle, upper, 'pine trunk');
  edge(upper, apex, 'pine leader');
  const lowerL = node(5, 76), lowerR = node(94, 70);
  const midL = node(14, 56), midR = node(85, 52);
  const topL = node(29, 35), topR = node(76, 34);
  const coneJoint = node(25, 74);
  edge(lower, coneJoint, 'pine bough', 36, 74);
  edge(coneJoint, lowerL, 'pine bough', 14, 76);
  edge(lower, lowerR, 'pine bough', 71, 72);
  edge(middle, midL, 'pine bough', 32, 54);
  edge(middle, midR, 'pine bough', 68, 51);
  edge(upper, topL, 'pine bough', 40, 30);
  edge(upper, topR, 'pine bough', 66, 30);
  for (const [outer, next, x] of [[lowerL, midL, 12], [lowerR, midR, 87],
    [midL, topL, 21], [midR, topR, 80]]) {
    if (random() < 0.57) edge(outer, next, 'canopy', x, outer === lowerL || outer === lowerR ? 63 : 44);
  }
  if (random() < 0.66) edge(topL, apex, 'canopy', 42, 19);
  else edge(apex, topR, 'canopy', 67, 19);
  const stalk = node(18, 87);
  edge(coneJoint, stalk, 'pinecone stem', 20, 79);
  leaf(stalk, 32, 95, Math.min(10, width * 0.052), 'pinecone');
  return { bases: [base], ports: [lowerL, lowerR] };
}

function reeds(p) {
  const { node, edge, leaf, random, width } = p;
  const count = width > 240 ? 4 : width > 152 ? 3 : 2;
  const bases = [], stems = [];
  const reeds = Array.from({ length: count }, (_, i) => 17 + i * 65 / (count - 1));
  const tall = Math.floor(random() * count);
  for (const [i, x] of reeds.entries()) {
    const height = i === tall ? 5 : 18 + random() * 24;
    const base = node(x + (i % 2 ? -3 : 4), 98 - (i % 2) * 5);
    const elbowY = Math.max(69 + random() * 7, height + 22 + 1600 / p.height);
    const elbow = node(x + 2, elbowY);
    const neck = node(x - 2, height + 22);
    edge(base, elbow, 'reed stem', x + 5, 85);
    edge(elbow, neck, 'reed stem', x + 1, (elbowY + height + 22) / 2);
    leaf(neck, x - 5, height, Math.min(12, width / count * 0.17), 'reed head');
    bases.push(base);
    stems.push(elbow);
    if (i) edge(bases[i - 1], base, 'rhizome', (reeds[i - 1] + x) / 2, 85);
  }
  for (let i = 1; i < count; i++) {
    const runner = random() < 0.59;
    if (runner) edge(stems[i - 1], stems[i], 'reed runner', (reeds[i - 1] + reeds[i]) / 2, 81);
    if (i === 1 || random() < 0.5) {
      const tip = 53 + random() * 6;
      if (!runner) leaf(stems[i - 1], reeds[i - 1] + (reeds[i] - reeds[i - 1]) * 0.64, tip,
        Math.min(10, width / count * 0.15));
    }
  }
  // The bent outer blades are the contact points of a neighboring stand.
  const left = node(4, 64), right = node(96, 69);
  edge(stems[0], left, 'reed blade', 9, 61);
  edge(stems.at(-1), right, 'reed blade', 89, 65);
  return { bases, ports: [left, right] };
}

function stoneArch(p) {
  const { node, edge, leaf, random, width } = p;
  const footL = node(19, 100), footR = node(83, 98);
  const outerL = node(5, 70), outerR = node(95, 69);
  const innerL = node(27, 76), innerR = node(75, 76);
  const key = node(48 + random() * 9, 52);
  edge(footL, outerL, 'rock face', 11, 85);
  edge(footL, innerL, 'stone arch');
  edge(footR, outerR, 'rock face', 93, 81);
  edge(footR, innerR, 'stone arch');
  edge(innerL, key, 'stone arch', 34, 53);
  edge(key, innerR, 'stone arch', 68, 50);
  edge(outerL, innerL, 'rock seam');
  edge(innerR, outerR, 'rock seam');
  const ridge = [outerL, node(14, 38), node(26, 7 + random() * 12),
    node(43, 26 + random() * 9), node(61, 3 + random() * 9),
    node(76, 15 + random() * 13), node(89, 43), outerR];
  for (let i = 1; i < ridge.length; i++) edge(ridge[i - 1], ridge[i], 'ridgeline');
  edge(innerL, ridge[1], 'rock seam');
  edge(innerL, ridge[3], 'rock seam', 27, 48);
  edge(key, ridge[3], 'rock seam');
  if (random() < 0.58) edge(key, ridge[4], 'rock seam');
  edge(key, ridge[5], 'rock seam', 64, 35);
  edge(innerR, ridge[6], 'rock seam');
  if (width > 185 && random() < 0.67) edge(innerR, ridge[5], 'rock seam');
  const vine = node(52, 65);
  edge(key, vine, 'hanging vine', 49, 60);
  leaf(vine, 57, 80, Math.min(11, width * 0.047));
  return { bases: [footL, footR], ports: [outerL, outerR] };
}

function arbor(p) {
  const { node, edge, leaf, random, width } = p;
  const bays = width > 258 ? 3 : width > 155 ? 2 : 1;
  const posts = [];
  for (let i = 0; i <= bays; i++) {
    const x = 7 + 86 * i / bays;
    const base = node(x, 97 + random() * 3);
    const middle = node(x + 1, 61 + random() * 4), cap = node(x, 27 + random() * 9);
    edge(base, middle, 'arbor post');
    edge(middle, cap, 'arbor post');
    posts.push({ x, base, middle, cap });
  }
  for (let i = 0; i < bays; i++) {
    const a = posts[i], b = posts[i + 1], x = (a.x + b.x) / 2;
    const peak = node(x, 4 + random() * 12), knot = node(x, 60 + random() * 6);
    edge(a.cap, peak, 'arbor arch', a.x + (x - a.x) * 0.28, 11);
    edge(peak, b.cap, 'arbor arch', b.x + (x - b.x) * 0.28, 12);
    edge(a.base, knot, 'lattice');
    edge(knot, b.cap, 'lattice');
    edge(a.cap, knot, 'lattice');
    if (random() < 0.78 || bays === 1) edge(knot, b.base, 'lattice');
    if (random() < 0.46) edge(a.cap, b.cap, 'arbor crossbar');
    const hanging = node(x - 1, 81);
    edge(knot, hanging, 'hanging vine', x, 73);
    leaf(hanging, x + (b.x - x) * 0.2, 95, Math.min(10, width / bays * 0.087), 'fruit');
  }
  return { bases: posts.map(post => post.base), ports: [posts[0].middle, posts.at(-1).middle] };
}

function mushrooms(p) {
  const { node, edge, leaf, random, width } = p;
  const base = node(50, 100), junction = node(48, 83);
  edge(base, junction, 'stalk', 46, 89);
  function cap(x, y, half, rise, parent) {
    const neck = node(x, y), a = node(x - half, y - 3), top = node(x - 1, y - rise), b = node(x + half, y - 4);
    edge(parent, neck, 'stalk', x + 3, y + 16);
    edge(a, top, 'cap', x - half * 0.74, y - rise - 1);
    edge(top, b, 'cap', x + half * 0.71, y - rise);
    edge(a, neck, 'cap rim', x - half * 0.51, y + 4);
    edge(neck, b, 'cap rim', x + half * 0.54, y + 4);
    edge(neck, top, 'gill', x - half * 0.18, y - rise * 0.42);
    if (width > 170 && random() < 0.7) {
      const inner = node(x - half * 0.54, y - rise * 0.47);
      edge(neck, inner, 'gill', x - half * 0.37, y - rise * 0.16);
    }
  }
  cap(33, 42, 29, 34 + random() * 5, junction);
  cap(77, 64, 19, 23 + random() * 4, junction);
  const left = leaf(junction, 5, 77, Math.min(10, width * 0.061));
  const right = leaf(base, 95, 72, Math.min(9, width * 0.055));
  return { bases: [base], ports: [left, right] };
}

function lily(p) {
  const { node, edge, leaf, random, width } = p;
  const root = node(39, 100), padRoot = node(77, 96), bend = node(33, 77);
  edge(root, padRoot, 'rhizome', 61, 92);
  edge(root, bend, 'stem', 34, 92);
  const cup = node(37, 55);
  edge(bend, cup, 'stem', 34, 65);
  const outerL = node(5, 34), foldL = node(24, 37), innerL = node(20, 17);
  const peak = node(38, 3 + random() * 5), foldR = node(50, 36);
  const innerR = node(57, 16), outerR = node(68, 32);
  edge(cup, outerL, 'petal', 15, 56);
  edge(outerL, foldL, 'petal', 14, 33);
  edge(foldL, cup, 'petal', 27, 50);
  edge(foldL, innerL, 'petal', 19, 29);
  edge(innerL, peak, 'petal', 30, 21);
  edge(peak, foldR, 'petal', 45, 17);
  edge(foldR, cup, 'petal', 47, 48);
  edge(foldR, innerR, 'petal', 52, 21);
  edge(innerR, outerR, 'petal', 59, 29);
  edge(outerR, cup, 'petal', 61, 54);
  if (width > 158 || random() < 0.6) edge(cup, peak, 'flower center', 37, 26);
  const left = leaf(bend, 5, 77, Math.min(12, width * 0.071));
  const heart = node(77, 72), tip = node(96, 69), back = node(78, 56), flank = node(57, 69);
  edge(padRoot, heart, 'pad stalk', 80, 84);
  edge(heart, tip, 'lily pad', 89, 79);
  edge(tip, back, 'lily pad', 98, 57);
  edge(back, flank, 'lily pad', 60, 54);
  edge(flank, heart, 'lily pad', 65, 76);
  if (random() < 0.63) edge(heart, back, 'pad vein', 75, 64);
  return { bases: [root, padRoot], ports: [left, tip] };
}

function cactus(p) {
  const { node, edge, leaf, random, width } = p;
  const base = node(51, 100), foot = node(50, 80);
  const leftWall = node(43, 58), rightWall = node(59, 46), tip = node(52, 5);
  edge(base, foot, 'cactus stem');
  edge(foot, leftWall, 'cactus skin', 43, 74);
  edge(leftWall, tip, 'cactus skin', 41, 6);
  edge(tip, rightWall, 'cactus skin', 60, 4);
  edge(rightWall, foot, 'cactus skin', 60, 78);
  if (random() < 0.77) edge(foot, tip, 'cactus rib', 50, 40);
  const west = node(8, 67), east = node(91, 57);
  edge(leftWall, west, 'cactus arm', 25, 72);
  edge(rightWall, east, 'cactus arm', 71, 64);
  const elbow = node(13, 45);
  edge(west, elbow, 'cactus arm', 8, 63);
  leaf(elbow, 17, 26 + random() * 4, Math.min(11, width * 0.065), 'cactus pad');
  const easternTip = node(86, 23);
  edge(east, easternTip, 'cactus arm', 86, 51);
  if (width > 180 || random() < 0.55) leaf(easternTip, 92, 11, Math.min(11, width * 0.063), 'fruit');
  return { bases: [base], ports: [west, east] };
}

export function growLandmark(field, area, kind, random, wind) {
  const p = space(field, area, random, wind, kind);
  let result;
  switch (kind) {
    case 'sunflower': result = sunflower(p); break;
    case 'oak': case 'orchard': case 'willow': result = broadleaf(p, kind); break;
    case 'pine': result = pine(p); break;
    case 'reed': result = reeds(p); break;
    case 'stone': result = stoneArch(p); break;
    case 'arbor': result = arbor(p); break;
    case 'mushroom': result = mushrooms(p); break;
    case 'lily': result = lily(p); break;
    case 'cactus': result = cactus(p); break;
    default: throw new RangeError('Unknown landmark ' + kind);
  }
  result.bases.sort((a, b) => a.x - b.x);
  result.ports.sort((a, b) => a.x - b.x);
  return result;
}
