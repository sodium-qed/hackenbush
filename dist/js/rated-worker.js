import { prepareRatedOpening } from './rating-opening.js?v=10';
import { ratedBotMove } from './rated-deal.js?v=10';

self.onmessage = ({data}) => {
  try {
    const { operation, game } = data;
    let result;
    if (operation === 'prepare') result = prepareRatedOpening(game);
    else if (operation === 'move') {
      result = ratedBotMove(game.board, game.live, game.side, game.players[game.side].level, game.seed, game.moves.length);
    } else throw new RangeError('Unknown rated operation.');
    self.postMessage({ok: true, result});
  } catch {
    self.postMessage({ok: false});
  }
};
