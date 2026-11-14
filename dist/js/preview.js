// A restored page uses the original preview end so refreshing cannot buy extra time.
export function timeBoardPreview(onSecond, onEnd, remainingMs = 2000) {
  const remaining = Math.max(0, Math.min(2000, remainingMs));
  onSecond(Math.ceil(remaining / 1000));
  let halfway;
  if (remaining > 1000) halfway = setTimeout(() => onSecond(1), remaining - 1000);
  const end = setTimeout(onEnd, remaining);
  return () => {
    clearTimeout(halfway);
    clearTimeout(end);
  };
}
