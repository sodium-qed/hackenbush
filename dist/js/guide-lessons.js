import { cutEdge, initialEdges, otherSide, winner } from './rules.js';

export const guideVariants = {
  green: {
    note: 'In Green, the draw decides who opens.',
    primary: 'green', left: 'green', right: 'green', secondary: 'green',
  },
  redblue: {
    note: 'The opening draw is independent of the color draw.',
    primary: 'blue', left: 'red', right: 'blue', secondary: 'red',
  },
  mixed: {
    note: 'Both players can cut green branches in this match.',
    primary: 'green', left: 'red', right: 'blue', secondary: 'red',
  },
};

const lessonTitles = {
  one: 'One support', two: 'Two supports', flower: 'Flower loop', endgame: 'Endgame',
};

function makeBoard(mode, colors) {
  const groundY = 142;
  const frame = { height: 161, groundY };
  function edge(id, a, b, color, part, x, y) {
    return { id, a, b, color, part, control: { x, y } };
  }
  if (mode === 'endgame') {
    return {
      ...frame,
      nodes: [
        { id: 'left-root', x: 386, y: groundY, ground: true },
        { id: 'joint', x: 399, y: 83 }, { id: 'tip', x: 379, y: 21 },
        { id: 'right-root', x: 513, y: groundY, ground: true },
        { id: 'short-tip', x: 530, y: 83 },
      ],
      edges: [
        edge('left-support', 'left-root', 'joint', colors.secondary, 'left support', 397, 113),
        edge('left-tip', 'joint', 'tip', colors.primary, 'left tip', 399, 51),
        edge('right-stem', 'right-root', 'short-tip', colors.right, 'right stem', 512, 111),
      ],
    };
  }
  if (mode === 'flower') {
    return {
      ...frame,
      nodes: [
        { id: 'ground', x: 449, y: groundY, ground: true },
        { id: 'base', x: 445, y: 99 }, { id: 'bend', x: 414, y: 69 },
        { id: 'tip', x: 460, y: 16 },
      ],
      edges: [
        edge('primary', 'base', 'bend', colors.primary, 'lower-left petal edge', 416, 93),
        edge('left', 'bend', 'tip', colors.left, 'upper-left petal edge', 407, 40),
        edge('right', 'tip', 'base', colors.right, 'right petal edge', 491, 62),
        edge('secondary', 'ground', 'base', colors.secondary, 'stem', 442, 122),
      ],
    };
  }
  const nodes = [
    { id: 'ground-left', x: 398, y: groundY, ground: true },
    { id: 'fork', x: 450, y: 84 }, { id: 'left-tip', x: 408, y: 26 },
    { id: 'right-tip', x: 509, y: 39 },
  ];
  const edges = [
    edge('primary', 'ground-left', 'fork', colors.primary, mode === 'two' ? 'left support' : 'support', 420, 106),
    edge('left', 'fork', 'left-tip', colors.left, 'upper-left branch', 438, 50),
    edge('right', 'fork', 'right-tip', colors.right, 'upper-right branch', 487, 68),
  ];
  if (mode === 'two') {
    nodes.push({ id: 'ground-right', x: 509, y: groundY, ground: true });
    edges.push(edge('secondary', 'ground-right', 'fork', colors.secondary, 'right support', 482, 104));
  }
  return { ...frame, nodes, edges };
}

export function beginLesson(mode, variant) {
  const board = makeBoard(mode, guideVariants[variant]);
  return {
    mode, variant, board, title: lessonTitles[mode], live: initialEdges(board), side: 'blue', turn: 0,
    target: mode === 'endgame' ? null : 'primary', finished: false, victor: null, feedback: '',
  };
}

export function lessonQuestion(lesson) {
  if (lesson.finished) return '';
  if (lesson.mode === 'endgame') {
    if (lesson.side === 'red') return 'How will the computer reply?';
    return lesson.turn ? 'Which branch can you cut now?' : 'Which first cut will give you the last move?';
  }
  if (lesson.mode === 'one') return 'If you cut the only support, what happens to the two upper branches?';
  if (lesson.mode === 'two') return lesson.turn
    ? 'If you cut the remaining support now, what happens to the upper branches?'
    : 'If you cut the left support, what happens to the two upper branches?';
  return lesson.turn
    ? 'If you cut the stem now, what happens to the open petal?'
    : 'If you cut the lower-left edge of the petal, what happens to its tip?';
}

function explainExample(lesson, id, move) {
  if (lesson.mode === 'flower') {
    if (id === 'secondary') return move.fallen.length === 3
      ? 'The whole petal fell. Its stem was its only path to the ground.'
      : 'Both remaining petal edges fell. The stem was their last connection to the ground.';
    if (lesson.turn) return move.fallen.length
      ? 'Another petal edge fell with the cut. It had lost its last path to the stem.'
      : 'Only that edge came away. The remaining petal edge still touches the stem.';
    return 'The petal opened, but its tip stayed. A path around the other side still connects it to the stem.';
  }
  if (move.fallen.length) return 'Both upper branches fell. Their last path to the ground ran through that support.';
  if (id === 'primary' || id === 'secondary') {
    const remaining = id === 'primary' ? 'right' : 'left';
    return `Both upper branches stayed. The ${remaining} support still connects them to the ground.`;
  }
  return 'Only the cut branch came away. The other branches still have a path to the ground.';
}

function explainEndgame(lesson, edge, move, victor) {
  const green = lesson.variant === 'green';
  const actor = lesson.side === 'blue' ? 'You' : green ? 'The computer' : 'Red';
  let text = `${actor} cut the ${edge.part}.`;
  if (move.fallen.length) text += ' The left tip fell with its support.';
  if (victor === 'blue') return text + (green
    ? ' The two single stems gave the computer one cut and left the last one for you.'
    : ' Keeping a separate blue stem gave you a move after Red took the left support.');
  if (victor === 'red') return text + (green
    ? ' You have no cut left. Try leaving two single stems for the computer’s turn.'
    : ' You have no legal cut left. Try saving the short blue stem for your second turn.');
  if (lesson.side === 'red') return text + ' One rooted stem remains for you.';
  if (edge.id === 'left-tip') return text + ' Each stalk now has one branch.';
  if (edge.id === 'right-stem') return text + ' The tall stalk still stands.';
  return text + ' Only the short stem remains.';
}

// In the diagrams the learner can make either player's cut. The second
// prediction follows the actual first cut, including opening a loop from the
// other side or removing the right-hand support first in Green.
function nextTarget(lesson, id) {
  if (lesson.turn) return null;
  if (lesson.mode === 'flower' && id !== 'secondary') return 'secondary';
  if (lesson.mode === 'two') {
    if (id === 'primary') return 'secondary';
    if (id === 'secondary') return 'primary';
  }
  return null;
}

export function takeLessonCut(lesson, id, predictFall = null) {
  if (lesson.finished) return null;
  const move = cutEdge(lesson.board, lesson.live, id, lesson.side);
  if (!move) return null;
  const edge = lesson.board.edges.find(branch => branch.id === id);
  const side = otherSide(lesson.side);
  const challenge = lesson.mode === 'endgame';
  const target = challenge ? null : nextTarget(lesson, id);
  const victor = challenge ? winner(lesson.board, move.live, side) : null;
  let feedback = challenge ? explainEndgame(lesson, edge, move, victor) : explainExample(lesson, id, move);
  if (predictFall !== null && id === lesson.target) {
    const prediction = predictFall ? 'You predicted a fall. ' : 'You expected the remaining branches to stay. ';
    feedback = (predictFall === (move.fallen.length > 0) ? 'Correct. ' : prediction) + feedback;
  }
  return {
    ...lesson, live: move.live, side, turn: lesson.turn + 1, target, victor, feedback,
    finished: challenge ? !!victor : !target, lastCut: { id, part: edge.part, fallen: move.fallen },
  };
}
