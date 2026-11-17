import { prepareRatedOpening } from './rating-opening.js?v=11';
import { ratedBotMove } from './rated-deal.js?v=11';

self.onmessage = ({data}) => {
  try {
    const { operation, game } = data;
    let result;
    if (operation === 'prepare') result = prepareRatedOpening(game);
    else if (operation === 'move') {
      if (data.clockBudget) self.postMessage({ searchStarted: true });
      const start = performance.now();
      result = ratedBotMove(game.board, game.live, game.side, game.players[game.side].level, game.seed, game.moves.length);
      result = { ...result, elapsedMs: performance.now() - start };
    } else throw new RangeError('Unknown rated operation.');
    self.postMessage({ok: true, result});
  } catch {
    self.postMessage({ok: false});
  }
};
