function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function curve(a, b, c) {
  const points = [a];
  if (c) for (let i = 1; i < 10; i++) points.push(lerp(lerp(a, c, i / 10), lerp(c, b, i / 10), i / 10));
  points.push(b);
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { a, b, c, points, left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

function distance2(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

function turn(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

function clear(route, drawing) {
  for (const other of drawing) {
    if (route.right + 8 < other.left || route.left - 8 > other.right ||
        route.bottom + 8 < other.top || route.top - 8 > other.bottom) continue;
    const shared = route.a === other.a || route.b === other.b || route.a === other.b || route.b === other.a;
    if (shared) {
      const joint = route.a === other.a || route.a === other.b ? route.a : route.b;
      const s = route.c ?? (route.a === joint ? route.b : route.a);
      const t = other.c ?? (other.a === joint ? other.b : other.a);
      const dx = s.x - joint.x, dy = s.y - joint.y, ex = t.x - joint.x, ey = t.y - joint.y;
      if (dx * ex + dy * ey > 0.91 * Math.hypot(dx, dy) * Math.hypot(ex, ey)) return false;
    }
    for (let j = 1; j < route.points.length; j++) {
      const a = route.points[j - 1], b = route.points[j];
      for (let k = 1; k < other.points.length; k++) {
        const c = other.points[k - 1], d = other.points[k];
        if (turn(a,b,c) * turn(a,b,d) < 0 && turn(c,d,a) * turn(c,d,b) < 0) return false;
        if (!shared && Math.min(distance2(a,c,d), distance2(b,c,d), distance2(c,a,b), distance2(d,a,b)) < 7.5 ** 2) return false;
        if (shared && j > 2 && j < route.points.length - 2 && distance2(b,c,d) < 6.2 ** 2) return false;
      }
    }
  }
  return true;
}

function crownPorts(stand, right) {
  const outer = right ? 1 : -1;
  const center = stand.left + stand.width / 2;
  const lowest = Math.min(stand.ports[right ? 1 : 0].y - 19, stand.top + (stand.base - stand.top) * 0.64);
  return stand.crownNodes
    .filter(n => (n.x - center) * outer > stand.width * 0.075 && n.y <= lowest)
    .sort((a, b) => outer * (b.x - a.x) - 0.16 * (b.y - a.y))
    .slice(0, 3);
}

// A crown may catch another plant at a petal, an exposed branch, a rock
// ledge or an arbor roof. Take the route only when the entire curve fits in
// open air. No authored bay or common horizontal layer connects these ports.
export function connectCrowns(field, left, right, random) {
  const shapes = field.edges.map(e => curve(field.nodes[Number(e.a.slice(1))],
    field.nodes[Number(e.b.slice(1))], e.control));
  const west = crownPorts(left, true), east = crownPorts(right, false);
  const drape = 19 + random() * 54;
  for (const a of west) for (const b of east) {
    const dx = b.x - a.x;
    if (dx < 42 || dx > 270) continue;
    for (const bend of [drape, drape * 0.30, -12]) {
      const c = { x: a.x + dx * 0.51, y: (a.y + b.y) / 2 + Math.min(bend, dx * 0.59) };
      const leftControl = lerp(a, c, 0.5), rightControl = lerp(c, b, 0.5);
      const pivot = lerp(leftControl, rightControl, 0.5);
      if (!clear(curve(a, b, c), shapes)) continue;
      const knot = field.node(pivot.x, pivot.y);
      field.link(a, knot, 'canopy vine', leftControl);
      field.link(knot, b, 'canopy vine', rightControl);
      if (dx > 68 && random() < 0.48) {
        const direction = random() < 0.5 ? -1 : 1;
        const end = { x: knot.x + 10 * direction, y: knot.y + 36 };
        const hook = { x: knot.x - 9 * direction, y: knot.y + 24 };
        if (clear(curve(knot, end, hook), shapes)) {
          const tip = field.node(end.x, end.y), mid = lerp(lerp(knot, hook, 0.5), lerp(hook, end, 0.5), 0.5);
          const bud = field.node(mid.x, mid.y);
          field.link(knot, bud, 'hanging vine', lerp(knot, hook, 0.5));
          field.link(bud, tip, 'tendril', lerp(hook, end, 0.5));
        }
      }
      return true;
    }
  }
  return false;
}
