// Each drawing meets the rest of the board only at its foundation, g.hub.
// Cables, sails, glazing bars, and arches are ordinary playable edges.
function suspensionBridge(g) {
  const left = g.node(28, 158);
  const right = g.node(92, 158);
  const deck = g.node(60, 158);
  const westAnchor = g.node(5, 158);
  const eastAnchor = g.node(115, 158);
  const westTower = g.node(28, 60);
  const eastTower = g.node(92, 60);
  const saddle = g.node(60, 121);
  const footing = g.node(60, 218);

  g.edge(g.hub, footing, 'bridge foundation');
  g.path([left, footing, right], 'bridge pier');
  g.path([westAnchor, left, deck, right, eastAnchor], 'bridge deck');
  g.edge(left, westTower, 'bridge tower');
  g.edge(right, eastTower, 'bridge tower');
  g.edge(westAnchor, westTower, 'anchor cable', { x: 5, y: 109 });
  g.edge(westTower, saddle, 'suspension cable', { x: 42, y: 121 });
  g.edge(saddle, eastTower, 'suspension cable', { x: 78, y: 121 });
  g.edge(eastTower, eastAnchor, 'anchor cable', { x: 115, y: 109 });
  g.edge(saddle, deck, 'vertical hanger');
}

function windmill(g) {
  const axle = g.node(60, 88);
  const leftFoot = g.node(34, 214);
  const rightFoot = g.node(86, 214);
  g.path([g.hub, leftFoot, axle, rightFoot, g.hub], 'mill tower');

  // Two canvas sails close a loop. The two open-framed sails have detachable
  // tips, so a cut at the axle behaves differently on alternating blades.
  const northeast = g.node(104, 34);
  const eastHem = g.node(114, 57);
  g.path([axle, northeast, eastHem, axle], 'canvas sail');
  const southeast = g.node(109, 135);
  const southHem = g.node(90, 154);
  g.path([axle, southeast, southHem], 'sail frame');
  const southwest = g.node(15, 141);
  const westHem = g.node(5, 117);
  g.path([axle, southwest, westHem, axle], 'canvas sail');
  const northwest = g.node(11, 42);
  const northHem = g.node(36, 30);
  g.path([axle, northwest, northHem], 'sail frame');
}

function glasshouse(g) {
  const sill = g.node(60, 205);
  const westFoot = g.node(12, 205);
  const eastFoot = g.node(108, 205);
  const westEave = g.node(12, 125);
  const eastEave = g.node(108, 125);
  const tie = g.node(60, 125);
  const hook = g.node(36, 125);
  const ridge = g.node(60, 51);
  const pot = g.node(36, 156);
  const sprig = g.node(28, 179);

  g.edge(g.hub, sill, 'glasshouse foundation');
  g.path([westFoot, sill, eastFoot], 'glasshouse sill');
  g.edge(westFoot, westEave, 'glasshouse column');
  g.edge(eastFoot, eastEave, 'glasshouse column');
  g.edge(westEave, ridge, 'glass roof', { x: 19, y: 79 });
  g.edge(ridge, eastEave, 'glass roof', { x: 101, y: 79 });
  g.path([westEave, hook, tie, eastEave], 'glazing bar');
  g.path([ridge, tie, sill], 'glasshouse mullion');
  g.edge(hook, pot, 'planter chain');
  g.edge(pot, sprig, 'trailing plant', { x: 38, y: 172 });
}

function stoneAqueduct(g) {
  const west = g.node(8, 163);
  const center = g.node(60, 163);
  const east = g.node(112, 163);
  const centerFoot = g.node(60, 217);
  const westFoot = g.node(8, 206);
  const eastFoot = g.node(112, 206);
  const westCourse = g.node(8, 90);
  const centerCourse = g.node(60, 90);
  const eastCourse = g.node(112, 90);
  const westLip = g.node(8, 66);
  const eastLip = g.node(112, 66);

  g.path([g.hub, centerFoot, center], 'central stone pier');
  g.edge(west, westFoot, 'outer stone pier');
  g.edge(east, eastFoot, 'outer stone pier');
  g.edge(west, center, 'stone arch', { x: 34, y: 61 });
  g.edge(center, east, 'stone arch', { x: 86, y: 61 });
  g.edge(west, westCourse, 'stone spandrel');
  g.edge(center, centerCourse, 'stone spandrel');
  g.edge(east, eastCourse, 'stone spandrel');
  g.path([westCourse, centerCourse, eastCourse], 'water channel');
  g.path([westCourse, westLip, eastLip, eastCourse], 'aqueduct parapet');
}

export const structureMaps = [
  { id: 'suspension-bridge', name: 'Suspension bridge', build: suspensionBridge },
  { id: 'windmill', name: 'Windmill', build: windmill },
  { id: 'glasshouse', name: 'Glasshouse', build: glasshouse },
  { id: 'stone-aqueduct', name: 'Stone aqueduct', build: stoneAqueduct },
];
