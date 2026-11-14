// Call after the board is on screen. The player-selection form has no timer.
export function timeBoardPreview(onSecond, onCover) {
  onSecond(2);
  const halfway = setTimeout(() => onSecond(1), 1000);
  const end = setTimeout(onCover, 2000);
  return () => {
    clearTimeout(halfway);
    clearTimeout(end);
  };
}
