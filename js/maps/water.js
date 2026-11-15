function waterwheel(g) {
  const axle = g.node(60, 118);
  const topLeft = g.node(37, 77);
  const topRight = g.node(83, 77);
  const right = g.node(107, 118);
  const lowRight = g.node(83, 159);
  const lowLeft = g.node(37, 159);
  const left = g.node(13, 118);

  g.edge(g.hub, lowLeft, 'wheel stand');
  g.edge(g.hub, lowRight, 'wheel stand');
  g.edge(topLeft, topRight, 'wheel rim', { x: 60, y: 64 });
  g.edge(topRight, right, 'wheel rim', { x: 107, y: 90 });
  g.edge(right, lowRight, 'wheel rim', { x: 107, y: 146 });
  g.edge(lowRight, lowLeft, 'wheel rim', { x: 60, y: 172 });
  g.edge(lowLeft, left, 'wheel rim', { x: 13, y: 146 });
  g.edge(left, topLeft, 'wheel rim', { x: 13, y: 90 });
  for (const point of [topLeft, topRight, lowRight, lowLeft]) g.edge(axle, point, 'wheel spoke');
  g.edge(topLeft, g.node(9, 61), 'paddle', { x: 18, y: 78 });
  g.edge(lowRight, g.node(111, 175), 'paddle', { x: 103, y: 158 });
}

function waterLily(g) {
  const bend = g.node(46, 202);
  const cup = g.node(61, 151);
  const padTip = g.node(6, 181);
  const padBelly = g.node(23, 206);
  g.edge(g.hub, bend, 'stem', { x: 62, y: 224 });
  g.edge(bend, cup, 'stem', { x: 42, y: 180 });
  g.edge(bend, padTip, 'lily pad', { x: 28, y: 180 });
  g.edge(padTip, padBelly, 'lily pad', { x: 7, y: 198 });
  g.edge(padBelly, bend, 'lily pad', { x: 34, y: 211 });

  const leftTip = g.node(7, 85);
  const leftFold = g.node(37, 113);
  const crown = g.node(58, 35);
  const rightFold = g.node(82, 110);
  const rightTip = g.node(113, 75);
  g.edge(cup, leftTip, 'outer petal', { x: 17, y: 145 });
  g.edge(leftTip, leftFold, 'outer petal', { x: 25, y: 89 });
  g.edge(leftFold, crown, 'central petal', { x: 33, y: 77 });
  g.edge(crown, rightFold, 'central petal', { x: 80, y: 64 });
  g.edge(rightFold, rightTip, 'outer petal', { x: 97, y: 85 });
  g.edge(rightTip, cup, 'outer petal', { x: 106, y: 138 });
  g.edge(cup, leftFold, 'petal fold', { x: 46, y: 139 });
  g.edge(cup, rightFold, 'petal fold', { x: 76, y: 137 });
  g.edge(cup, g.node(60, 92), 'stamen', { x: 64, y: 124 });
}

function reedBed(g) {
  const clump = g.node(58, 199);
  const left = g.node(24, 144);
  const middle = g.node(54, 77);
  const right = g.node(94, 153);
  g.edge(g.hub, clump, 'stem', { x: 53, y: 224 });
  g.edge(clump, left, 'reed stalk', { x: 35, y: 184 });
  g.edge(clump, middle, 'reed stalk', { x: 48, y: 141 });
  g.edge(clump, right, 'reed stalk', { x: 81, y: 187 });

  const leftBelly = g.node(10, 114);
  const leftCap = g.node(18, 82);
  g.edge(left, leftBelly, 'cattail', { x: 11, y: 138 });
  g.edge(leftBelly, leftCap, 'cattail', { x: 5, y: 82 });
  g.edge(leftCap, left, 'cattail', { x: 32, y: 82 });
  g.edge(leftCap, g.node(15, 59), 'reed awn');
  const middleBelly = g.node(43, 54);
  const middleCap = g.node(52, 25);
  g.edge(middle, middleBelly, 'cattail', { x: 43, y: 70 });
  g.edge(middleBelly, middleCap, 'cattail', { x: 40, y: 25 });
  g.edge(middleCap, middle, 'cattail', { x: 68, y: 25 });

  g.edge(right, g.node(108, 96), 'reed tip', { x: 106, y: 129 });
  g.edge(left, g.node(7, 178), 'reed blade', { x: 10, y: 151 });
  g.edge(right, g.node(112, 183), 'reed blade', { x: 110, y: 159 });
}

function coralFan(g) {
  const base = g.node(57, 194);
  const left = g.node(27, 152);
  const middle = g.node(57, 129);
  const right = g.node(88, 155);
  const leftFork = g.node(33, 93);
  const rightFork = g.node(84, 97);
  const crown = g.node(58, 78);
  g.edge(g.hub, base, 'coral stem', { x: 68, y: 221 });
  g.edge(base, left, 'coral arm', { x: 38, y: 187 });
  g.edge(base, middle, 'coral arm', { x: 65, y: 169 });
  g.edge(base, right, 'coral arm', { x: 80, y: 186 });
  g.edge(left, g.node(6, 120), 'coral finger', { x: 8, y: 157 });
  g.edge(left, leftFork, 'coral arm', { x: 21, y: 127 });
  g.edge(middle, leftFork, 'coral bridge', { x: 40, y: 126 });
  g.edge(middle, crown, 'coral arm', { x: 52, y: 103 });
  g.edge(right, rightFork, 'coral arm', { x: 99, y: 124 });
  g.edge(middle, rightFork, 'coral bridge', { x: 76, y: 125 });
  g.edge(right, g.node(112, 125), 'coral finger', { x: 109, y: 153 });
  g.edge(leftFork, g.node(18, 49), 'coral finger', { x: 18, y: 83 });
  g.edge(crown, g.node(67, 37), 'coral finger', { x: 69, y: 63 });
  g.edge(rightFork, g.node(99, 57), 'coral finger', { x: 97, y: 86 });
}

export const waterMaps = [
  { id: 'waterwheel', name: 'Waterwheel', build: waterwheel },
  { id: 'water-lily', name: 'Water lily', build: waterLily },
  { id: 'reed-bed', name: 'Reed bed', build: reedBed },
  { id: 'coral-fan', name: 'Coral fan', build: coralFan },
];
