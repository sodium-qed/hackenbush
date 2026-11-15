import { analyzePosition } from './analysis-values.js?v=8';

self.onmessage = ({ data: { board, variant, positions } }) => {
  for (const { index, live, side } of positions) {
    const result = analyzePosition(board, live, side, variant);
    self.postMessage({ index, result });
  }
};
