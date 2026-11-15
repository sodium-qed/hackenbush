import test from 'node:test';
import assert from 'node:assert/strict';
import { referencePolicyStudy, syntheticRecovery } from '../scripts/validate-ratings.mjs';

test('stationary simulated skills are recovered from both sides of the prior', () => {
  const { groups } = syntheticRecovery(96, 60);
  for (const result of Object.values(groups)) {
    assert.ok(Math.abs(result.meanError) < 20);
    assert.ok(result.rmse < 85);
    assert.ok(result.meanRd < 100 && result.coverage196 > 0.9);
  }
});

test('on disjoint seeded gardens the forecast classifies built-in policy results before play', () => {
  const study = referencePolicyStudy(48);
  for (const result of Object.values(study.results)) {
    assert.equal(result.skill + result.forced + result.unresolved, study.boardsPerVariant * study.levelsPerBoard);
    assert.ok(result.skill > 0 && result.forced > 0);
    assert.ok(result.fullBrier < result.overallOnlyBrier);
  }
});
