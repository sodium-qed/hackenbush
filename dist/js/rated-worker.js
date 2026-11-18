import { assessRatedOpening } from './rating-opening.js?v=12';
import { ratedBotMove } from './rated-deal.js?v=11';

const finishAssessment = new AbortController();

self.onmessage = async ({data}) => {
  try {
    const { operation, game } = data;
    let result;
    if (operation === 'finish-assessment') { finishAssessment.abort(); return; }
    if (operation === 'prepare') {
      result = await assessRatedOpening(game, { indefinite: data.indefinite, finishSignal: finishAssessment.signal,
        onProgress: progress => self.postMessage({progress}) });
    }
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
