function spiderweb(g) {
  const center = g.node(60, 107);
  const south = g.node(60, 177);
  const east = g.node(109, 130);
  const northeast = g.node(91, 59);
  const northwest = g.node(29, 59);
  const west = g.node(11, 130);
  const rim = [south, east, northeast, northwest, west];
  const scallops = [
    { x: 75, y: 145 }, { x: 86, y: 94 }, { x: 60, y: 80 },
    { x: 34, y: 94 }, { x: 45, y: 145 },
  ];

  g.edge(g.hub, south, 'anchor silk');
  for (let i = 0; i < rim.length; i++) {
    g.edge(center, rim[i], 'spoke');
    g.edge(rim[i], rim[(i + 1) % rim.length], 'web', scallops[i]);
  }
  g.edge(northwest, g.node(9, 30), 'anchor silk');
  g.edge(northeast, g.node(112, 32), 'anchor silk');
}

function mushroomCap(g, neck, left, crown, right, leftArc, rightArc) {
  g.edge(left, crown, 'cap', leftArc);
  g.edge(crown, right, 'cap', rightArc);
  g.path([right, neck, left], 'cap rim');
}

function mushroomColony(g) {
  const base = g.node(54, 219);
  const lowerStalk = g.node(38, 178);
  const tallNeck = g.node(32, 115);
  const lowNeck = g.node(88, 161);
  g.edge(g.hub, base, 'stalk');
  g.edge(base, lowerStalk, 'stalk', { x: 46, y: 206 });
  g.edge(lowerStalk, tallNeck, 'stalk', { x: 30, y: 150 });
  g.edge(base, lowNeck, 'stalk', { x: 78, y: 202 });

  const tallCrown = g.node(31, 62);
  mushroomCap(g, tallNeck, g.node(5, 107), tallCrown, g.node(59, 106),
    { x: 10, y: 65 }, { x: 53, y: 63 });
  g.edge(tallNeck, tallCrown, 'gill', { x: 23, y: 91 });
  mushroomCap(g, lowNeck, g.node(62, 152), g.node(88, 108), g.node(115, 152),
    { x: 67, y: 110 }, { x: 109, y: 111 });
}

function saguaroCactus(g) {
  const base = g.node(59, 209);
  const leftJoint = g.node(47, 147);
  const rightJoint = g.node(74, 113);
  const crown = g.node(60, 37);
  g.edge(g.hub, base, 'trunk');
  g.edge(base, leftJoint, 'trunk', { x: 46, y: 191 });
  g.edge(leftJoint, crown, 'trunk', { x: 44, y: 35 });
  g.edge(crown, rightJoint, 'trunk', { x: 77, y: 34 });
  g.edge(rightJoint, base, 'trunk', { x: 77, y: 190 });
  g.edge(base, crown, 'rib');

  const leftElbow = g.node(18, 132);
  const rightElbow = g.node(99, 96);
  g.edge(leftJoint, leftElbow, 'arm', { x: 18, y: 153 });
  g.edge(leftElbow, g.node(17, 83), 'arm', { x: 16, y: 105 });
  g.edge(rightJoint, rightElbow, 'arm', { x: 99, y: 119 });
  g.edge(rightElbow, g.node(100, 60), 'arm');
}

function sunflower(g) {
  const stem = g.node(54, 172);
  const south = g.node(60, 109);
  const east = g.node(76, 91);
  const north = g.node(60, 73);
  const west = g.node(44, 91);
  g.edge(g.hub, stem, 'stem', { x: 51, y: 207 });
  g.edge(stem, south, 'stem', { x: 55, y: 135 });

  const disk = [south, east, north, west];
  const petals = [
    [g.node(104, 131), { x: 78, y: 141 }, { x: 108, y: 107 }, { x: 76, y: 109 }],
    [g.node(104, 48), { x: 109, y: 72 }, { x: 81, y: 39 }, { x: 76, y: 73 }],
    [g.node(16, 48), { x: 39, y: 39 }, { x: 11, y: 72 }, { x: 44, y: 73 }],
    [g.node(16, 131), { x: 12, y: 107 }, { x: 42, y: 141 }, { x: 44, y: 109 }],
  ];
  for (let i = 0; i < disk.length; i++) {
    const a = disk[i];
    const b = disk[(i + 1) % disk.length];
    const [tip, out, back, inner] = petals[i];
    g.edge(a, b, 'flower center', inner);
    g.edge(a, tip, 'petal', out);
    g.edge(tip, b, 'petal', back);
  }
}

export const habitatMaps = [
  { id: 'spiderweb', name: 'Spiderweb', build: spiderweb },
  { id: 'mushroom-colony', name: 'Mushroom colony', build: mushroomColony },
  { id: 'saguaro-cactus', name: 'Saguaro cactus', build: saguaroCactus },
  { id: 'sunflower', name: 'Sunflower', build: sunflower },
];
