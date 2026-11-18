import { assessRatedOpening } from './rating-opening.js?v=13';
import { ratedBotMove } from './rated-deal.js?v=11';

self.onmessage = async ({data}) => {
  try {
    const { operation, game } = data;
    let result;
    if (operation === 'prepare') {
      result = await assessRatedOpening(game, { settleWhenReady: data.settleWhenReady,
        onProgress: (progress, opening) => self.postMessage({progress, opening}) });
    } else if (operation === 'move') {
      if (data.clockBudget) self.postMessage({ searchStarted: true });
      const start = performance.now();
      result = ratedBotMove(game.board, game.live, game.side, game.players[game.side].level, game.seed, game.moves.length);
      result = { ...result, elapsedMs: performance.now() - start };
    } else throw new RangeError('Unknown rated operation.');
    self.postMessage({ok: true, result});
  } catch { self.postMessage({ok: false}); }
};
