// Values are signed BigInt multiples of 2^-E for E edges in the original board.
// Number birthdays are at most E, so exact game values lie on this lattice.
export function fraction(value, denominator) {
  if (!value) return '0';
  while (denominator > 1n && !(value & 1n)) {
    value /= 2n;
    denominator /= 2n;
  }
  return denominator === 1n ? String(value) : value + '/' + denominator;
}

export function dyadicChange(before, after) {
  const [a, b = 1n] = before.split('/').map(BigInt);
  const [c, d = 1n] = after.split('/').map(BigInt);
  const common = b > d ? b : d;
  const difference = c * (common / d) - a * (common / b);
  return (difference > 0n ? '+' : '') + fraction(difference, common);
}

export function fixed(value) {
  return { lo: value, hi: value, loOpen: false, hiOpen: false };
}

export function sumOf(a, b) {
  return { lo: a.lo + b.lo, hi: a.hi + b.hi,
    loOpen: a.loOpen || b.loOpen, hiOpen: a.hiOpen || b.hiOpen };
}

// Only a strict certificate can remove an endpoint still allowed by the other.
export function intersect(a, b) {
  const lo = a.lo > b.lo ? a.lo : b.lo;
  const hi = a.hi < b.hi ? a.hi : b.hi;
  const loOpen = (a.lo === lo && a.loOpen) || (b.lo === lo && b.loOpen);
  const hiOpen = (a.hi === hi && a.hiOpen) || (b.hi === hi && b.hiOpen);
  if (lo > hi || (lo === hi && (loOpen || hiOpen))) {
    throw new RangeError('Inconsistent Red–Blue value certificates.');
  }
  return { lo, hi, loOpen, hiOpen };
}

// The simplest number strictly between two option extrema (null = unbounded).
export function simplest(left, right, unit) {
  if ((left === null || left < 0n) && (right === null || right > 0n)) return 0n;
  if (right !== null && right <= 0n) return -simplest(-right, left === null ? null : -left, unit);
  for (let step = unit; step; step >>= 1n) {
    const candidate = (left / step + 1n) * step;
    if (right === null || candidate < right) return candidate;
  }
  throw new RangeError('Red–Blue options exceed the position’s dyadic resolution.');
}

// Canonical left or right option of a short number. At +/- integers one of
// these is absent. For an odd reduced numerator its low bit is the grid step.
export function numberOption(value, left, unit) {
  if (value % unit === 0n) {
    if (left ? value <= 0n : value >= 0n) return null;
    return left ? value - unit : value + unit;
  }
  const step = value & -value;
  return left ? value - step : value + step;
}

function support(color, value, unit, upward) {
  if (color === 'red') return -support('blue', -value, unit, !upward);
  if (value >= 0n) return unit + value;
  const numerator = 2n * unit + value % unit;
  const denominator = 1n << (1n - value / unit);
  return (numerator + (upward ? denominator - 1n : 0n)) / denominator;
}

// Adding one support is strictly increasing. Rounding a derived endpoint
// outward remains valid even if a trial threshold exhausted the grid precision.
export function supported(color, bounds, unit) {
  return { lo: support(color, bounds.lo, unit, false), hi: support(color, bounds.hi, unit, true),
    loOpen: bounds.loOpen, hiOpen: bounds.hiOpen };
}

// A nonintegral dyadic with denominator 2^k has birthday >= k+1. In an
// e-edge follower, two or more lattice points must remain for it to be unknown.
export function onlyLatticePoint(bounds, edges, unit) {
  if (bounds.lo === bounds.hi) return bounds;
  const step = unit >> BigInt(Math.max(0, edges - 1));
  let first = (bounds.lo / step) * step;
  let last = (bounds.hi / step) * step;
  if (first < bounds.lo || (bounds.loOpen && first === bounds.lo)) first += step;
  if (last > bounds.hi || (bounds.hiOpen && last === bounds.hi)) last -= step;
  if (first > last) throw new RangeError('No dyadic value satisfies the proof interval.');
  return first === last ? fixed(first) : bounds;
}
