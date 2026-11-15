import { isDailySeed, TEXT_BOARD_VERSION } from './map-seed.js';
import { normalizeComputerLevel } from './opponents.js';
import { otherSide } from './rules.js';

function progressKey(seed, level) {
  return `groundwork.hackenbush.daily.v1.${seed}.${normalizeComputerLevel(level)}`;
}

export function dailyProgress(seed, level) {
  if (!isDailySeed(seed)) return null;
  const key = progressKey(seed, level);
  try {
    if (localStorage.getItem(key + '.won') === '1') return { won: true };
    if (localStorage.getItem(key + '.lost') === '1') return { won: false };
  } catch { /* Progress is optional when browser storage is unavailable. */ }
  return null;
}

export function recordDailyResult(game) {
  if (!game?.victor || game.boardVersion !== TEXT_BOARD_VERSION || game.opponent !== 'computer' || !isDailySeed(game.seed)) return;
  const computerSide = otherSide(game.seat);
  const computer = game.players?.[computerSide];
  if (game.players?.[game.seat]?.kind !== 'human' || computer?.kind !== 'computer') return;
  if (game.victor !== game.seat && game.victor !== computerSide) return;
  if (game.timedOut === computerSide) return;

  // Separate markers keep a loss in another tab from overwriting an earned win.
  const key = progressKey(game.seed, computer.level);
  try {
    localStorage.setItem(key + (game.victor === game.seat ? '.won' : '.lost'), '1');
  } catch { /* The finished match can still be shown with storage disabled. */ }
}
