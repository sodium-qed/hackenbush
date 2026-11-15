import { prepareRatedOpening } from './rating-opening.js?v=9';
import { ratedBotMove } from './rated-deal.js?v=9';

self.onmessage = ({data}) => {
  try {
    const game = data.game;
    const result = data.operation === 'prepare' ? prepareRatedOpening(game) :
      ratedBotMove(game.board, game.live, game.side, game.players[game.side].level, game.seed, game.moves.length);
    self.postMessage({ok: true, result});
  } catch {
    self.postMessage({ok: false});
  }
};
