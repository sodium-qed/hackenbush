// Growth and lean change the drawing without changing a landmark's graph.
function planting(g, random) {
  const mirror = random() < 0.5 ? -1 : 1;
  const breadth = 0.955 + random() * 0.043;
  const height = 0.965 + random() * 0.045;
  const lean = (random() - 0.5) * 3;
  function at(x, y) {
    const rise = 250 - y;
    return { x: 60 + (x - 60) * breadth * mirror + lean * rise / 228, y: 250 - rise * height };
  }
  function node(x, y) {
    const p = at(x, y);
    return g.node(p.x, p.y);
  }
  function edge(a, b, part, cx, cy) {
    return g.edge(a, b, part, cx === undefined ? undefined : at(cx, cy));
  }
  return { hub: g.hub, node, edge };
}

function willow(g, random) {
  const { hub, node, edge } = planting(g, random);
  const knee = node(66, 200);
  const fork = node(56, 148);
  const crown = node(60, 42);
  const left = node(28, 75);
  const right = node(93, 70);
  edge(hub, knee, 'willow trunk', 65, 228);
  edge(knee, fork, 'willow trunk', 66, 174);
  edge(knee, node(32, 215), 'basal willow shoot', 48, 199);
  edge(fork, crown, 'central willow bough', 61, 95);
  edge(fork, left, 'left willow bough', 36, 108);
  edge(left, crown, 'willow crown', 34, 37);
  edge(fork, right, 'right willow bough', 84, 100);
  edge(right, crown, 'willow crown', 85, 34);

  const outerLeft = node(5, 151);
  const outerRight = node(115, 139);
  edge(left, outerLeft, 'weeping branch', 6, 87);
  edge(outerLeft, node(11, 191), 'willow tassel', 4, 177);
  edge(left, node(31, 180), 'inner willow spray', 16, 130);
  edge(right, outerRight, 'weeping branch', 114, 78);
  edge(outerRight, node(108, 180), 'willow tassel', 116, 163);
  edge(right, node(87, 163), 'inner willow spray', 98, 121);
}

function bamboo(g, random) {
  const { hub, node, edge } = planting(g, random);
  const footL = node(45, 187), footR = node(65, 189);
  const midL = node(51, 126), midR = node(71, 124);
  const capL = node(58, 69), capR = node(77, 67);
  edge(hub, footR, 'bamboo culm', 69, 213);
  // The transverse joints are actual playable edges shared by the hollow
  // chambers and the lower leaf sheath.
  edge(footL, footR, 'bamboo joint', 55, 193);
  edge(footL, midL, 'lower culm wall', 45, 157);
  edge(footR, midR, 'lower culm wall', 65, 156);
  edge(midL, midR, 'bamboo joint', 61, 131);
  edge(midL, capL, 'upper culm wall', 51, 96);
  edge(midR, capR, 'upper culm wall', 71, 93);
  edge(capL, capR, 'bamboo joint', 68, 74);
  const lowTip = node(6, 150);
  edge(footL, lowTip, 'bamboo leaf sheath', 29, 155);
  edge(lowTip, footR, 'bamboo leaf margin', 43, 235);

  const crown = node(81, 46);
  edge(capR, crown, 'young bamboo shoot', 78, 55);
  const highTip = node(114, 28);
  const highBelly = node(104, 49);
  edge(crown, highTip, 'bamboo leaf', 95, 28);
  edge(highTip, highBelly, 'bamboo leaf margin', 111, 40);
  edge(highBelly, crown, 'bamboo leaf margin', 93, 52);
}

function fiddlehead(g, random) {
  const { hub, node, edge } = planting(g, random);
  const knee = node(47, 204);
  const shoulder = node(29, 149);
  edge(hub, knee, 'fern rachis', 58, 225);
  edge(knee, shoulder, 'fern rachis', 36, 178);
  edge(knee, node(90, 172), 'lower fern pinna', 70, 199);
  edge(shoulder, node(82, 132), 'upper fern pinna', 52, 146);

  // Eight sixty-degree sections follow one continuous inward coil. A vein
  // between like angles gives the outer whorl a second route to the stem.
  function coil(index) {
    const angle = Math.PI + index * Math.PI / 3;
    const radius = 53 - index * 4.6;
    return { x: 65 + radius * Math.cos(angle), y: 84 + radius * Math.sin(angle) };
  }
  const points = Array.from({ length: 9 }, (_, i) => coil(i));
  const curl = points.map(p => node(p.x, p.y));
  edge(shoulder, curl[0], 'unfurling fern stem', 13, 116);
  for (let i = 0; i < 8; i++) {
    const a = points[i];
    const b = points[i + 1];
    const middle = coil(i + 0.5);
    edge(curl[i], curl[i + 1], 'fiddlehead coil',
      2 * middle.x - (a.x + b.x) / 2, 2 * middle.y - (a.y + b.y) / 2);
  }
  edge(curl[1], curl[7], 'folded fern vein');
}

function mangrove(g, random) {
  const { hub, node, edge } = planting(g, random);
  const left = node(8, 221);
  const middle = node(61, 204);
  const right = node(112, 220);
  const base = node(56, 151);
  edge(hub, left, 'left tidal root', 24, 247);
  edge(hub, middle, 'central tidal root', 60, 225);
  edge(hub, right, 'right tidal root', 94, 246);
  edge(left, middle, 'woven root', 30, 201);
  edge(middle, right, 'woven root', 91, 203);
  edge(left, base, 'left prop root', 17, 173);
  edge(middle, base, 'central prop root', 63, 177);
  edge(right, base, 'right prop root', 98, 169);

  const trunk = node(63, 116);
  const west = node(36, 80);
  const east = node(91, 77);
  edge(base, trunk, 'mangrove trunk', 54, 131);
  edge(trunk, west, 'mangrove bough', 53, 90);
  edge(west, node(6, 59), 'coastal spray', 16, 82);
  edge(west, node(48, 34), 'mangrove crown', 37, 50);
  edge(trunk, east, 'mangrove bough', 85, 105);
  edge(east, node(113, 48), 'coastal spray', 108, 70);
}

export const woodlandMaps = [
  { id: 'willow', name: 'Willow', build: willow },
  { id: 'bamboo', name: 'Bamboo', build: bamboo },
  { id: 'fiddlehead-fern', name: 'Fiddlehead fern', build: fiddlehead },
  { id: 'mangrove', name: 'Mangrove', build: mangrove }
];
