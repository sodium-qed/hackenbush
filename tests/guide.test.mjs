import assert from 'node:assert/strict';
import test from 'node:test';
import { beginLesson, guideVariants, lessonQuestion, takeLessonCut } from '../dist/js/guide-lessons.js';
import { legalMoves, winner } from '../dist/js/rules.js';
import { chooseMove } from '../dist/js/strategy.js';

test('practice supports and petal loops follow alternating legal cuts, including their second prediction', () => {
  for (const variant of Object.keys(guideVariants)) {
    for (const mode of ['one', 'two', 'flower']) {
      const opening = beginLesson(mode, variant);
      const first = takeLessonCut(opening, opening.target, mode === 'one');
      assert.equal(first.side, 'red');
      assert.match(first.feedback, /Correct/);
      assert.deepEqual(opening.live, opening.board.edges.map(edge => edge.id));
      if (mode === 'one') {
        assert.equal(first.finished, true);
        assert.deepEqual(first.lastCut.fallen, ['left', 'right']);
        continue;
      }
      assert.equal(first.finished, false);
      assert.deepEqual(first.lastCut.fallen, []);
      assert.ok(legalMoves(first.board, first.live, first.side).includes(first.target));
      assert.match(lessonQuestion(first), mode === 'two' ? /remaining support/ : /stem/);
      const second = takeLessonCut(first, first.target, false);
      assert.equal(second.finished, true);
      assert.deepEqual(second.lastCut.fallen, ['left', 'right']);
      assert.deepEqual(second.live, []);
      assert.doesNotMatch(second.feedback, /Correct/);
      assert.equal(takeLessonCut(second, opening.target), null);
    }
  }
});

test('branch exploration follows the chosen color and the surviving support', () => {
  const reversed = takeLessonCut(beginLesson('two', 'green'), 'secondary');
  assert.equal(reversed.target, 'primary');
  assert.match(reversed.feedback, /left support/);
  assert.deepEqual(takeLessonCut(reversed, reversed.target).lastCut.fallen, ['left', 'right']);
  const flower = beginLesson('flower', 'redblue');
  assert.equal(takeLessonCut(flower, 'secondary'), null);
  const open = takeLessonCut(flower, 'right');
  assert.equal(open.target, 'secondary');
  assert.equal(takeLessonCut(open, 'primary'), null);
  assert.deepEqual(takeLessonCut(open, open.target).lastCut.fallen, ['primary', 'left']);
});

test('in each endgame the left tip wins in three plies, while taking the short stem loses to a legal reply', () => {
  for (const variant of Object.keys(guideVariants)) {
    const opening = beginLesson('endgame', variant);
    const choices = legalMoves(opening.board, opening.live, opening.side);
    assert.deepEqual(choices, variant === 'green' ? ['left-support', 'left-tip', 'right-stem'] : ['left-tip', 'right-stem']);
    for (const id of choices) {
      let game = takeLessonCut(opening, id);
      assert.equal(game.finished, false);
      assert.equal(game.side, 'red');
      const reply = chooseMove(game.board, game.live, game.side);
      game = takeLessonCut(game, reply.edgeId);
      if (id === 'left-tip') {
        assert.equal(game.finished, false);
        assert.equal(game.side, 'blue');
        const [last] = legalMoves(game.board, game.live, game.side);
        game = takeLessonCut(game, last);
        assert.equal(game.victor, 'blue');
        assert.equal(game.turn, 3);
      } else {
        assert.equal(game.victor, 'red');
        assert.equal(game.turn, 2);
      }
      assert.equal(game.finished, true);
      assert.equal(game.victor, winner(game.board, game.live, game.side));
      assert.deepEqual(legalMoves(game.board, game.live, game.side), []);
      assert.equal(opening.turn, 0);
    }
  }
});
