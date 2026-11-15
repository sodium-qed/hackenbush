# Verification and measured performance

## Reproduce the experiments

From a checkout that contains baseline commit `b6a054dc50840cea8033ab54ad70e85c63b99d15`, run the following with Node.js 20 or later. The benchmark extracts the baseline analyzer **and its own strategy and rules modules** from that commit into a temporary module directory. It runs them against the same boards and live edge lists as the current code. No network connection or package install is required.

```sh
node --test tests/analyzer.test.mjs tests/analyzer-oracle.test.mjs
node scripts/benchmark-analyzer.mjs --budget-ms=220 --repetitions=3
node scripts/benchmark-analyzer.mjs --budget-ms=220 --repetitions=3 --json
node scripts/difficulty-study.mjs
node scripts/calibration.mjs --check
node scripts/validate-ratings.mjs
node scripts/full-garden-study.mjs
npm test
```

The JSON benchmark output includes every unrounded interval, opening fingerprint, mover, elapsed time, winner claim, and the updated engine's proof counters. The development checkout must include the pinned commit in its Git history. [Benchmark runner](../../scripts/benchmark-analyzer.mjs)

## Numerical and winner correctness

The independent oracle uses no game modules. It keeps physical ground vertices separate and repeatedly scans surviving edges for newly reachable vertices after a cut. It evaluates Red–Blue games using reduced arbitrary-precision fractions and descends the Conway sign-expansion tree to select the simplest legal number. The production solver uses shared-denominator arithmetic, bridge analysis, structural reductions and threshold searches. A separate oracle recurrence alternates the mover and checks whether some legal turn makes the opponent lose. Its answers do not depend on the computed number. Green values use exhaustive mex of legal child values. [Reference implementation](../../tests/helpers/hackenbush-oracle.mjs)

| Corpus | What was checked |
| --- | --- |
| All 729 absent/Blue/Red assignments to six labeled slots, each with one or two grounded vertices | 1,458 inputs and 2,916 opener comparisons. Slots include a triangle, a parallel edge and two self-loops. Each exact fraction and specified-starter winner agreed. Distinct input labelings can represent the same game. |
| All 128 colorings of a seven-edge double cycle | 256 sessions across both starters. Every intermediate certificate sampled at successive node caps contained the exact rational, strict endpoints were respected, a claimed winner agreed with independent minimax, and ample work returned the exact value. |
| 96 deterministic multigraphs, seed `0x7a11cafe` | An opening and a one-cut follower per graph, each from both seats, produced 384 additional session checks. Tree backbones ensure grounding, while extra sampled edges permit loops and parallel edges. |
| Ten-edge Green network, with alternate ground markings | All 133 and 438 distinct reachable edge sets respectively. Mex and both mover outcomes agreed in every case. |
| 210 mixed Green/colored labelings of a five-edge graph | Both starters, at an early cutoff and after the search completed. All claimed winners agreed with direct minimax. |
| Direct examples and resource limits | Empty game, grounded or floating loops, trees, independent forests, grounded bridges, positive/negative dyadics, exact zeros, color reversal, a non-ground pendant substitution and a 42-edge winner with unresolved value. A 16-entry cache test checks that eviction preserves the published certificate. The older 82-edge forest fixture checks dyadic precision beyond a binary64 mantissa. |

All 19 tests in the two analyzer files passed in the reported run. The original test file also checks replay cascades and the distinction between a time loss and an untimed result. The large map openings discussed below have no independent full-value answers in this experiment. The comparison checks every applicable hand-derived or oracle value and checks winners against each other when both engines return one. The finite tests can reveal counterexamples and implementation regressions. Proofs of the general rules are in [Mathematical foundations](MATHEMATICAL_FOUNDATIONS.md).

## Fresh-call benchmark

The reported run used Node.js v24.22.1, Linux x64 and an AMD EPYC 9V74. Both solvers had a 220 ms wall budget for each fresh call. The updated one-shot entry also has its normal 12,000-checkpoint limit. Each got one warm-up call. Their measurement order alternated across repeats and positions. The timer surrounded the public one-shot function, including its preprocessing. The table gives **previous / updated** counts out of three calls per engine. Width is the median numerical distance between certified endpoints, rounded here only for display. A width of zero denotes an exact value in this sample. Exact dyadic endpoints are used for all correctness checks.

The first six geometric fixtures exercise specific algorithms. The four prespecified version-5 Expert map openings use the two example seeds from the README and the two endpoints of the six-hex seed range. Starting with Blue, the two replay endgames take the first legal smallest-cascade cut each turn until at most 13 edges remain. A fifth seed, C0FFEE, was added after a reachability bound proved its winner during development. It is shown as a targeted example, separate from the four prespecified map openings.

| Position | Live edges | Exact calls old / new | Winner calls old / new | Median width old / new | Median ms old / new |
| --- | ---: | ---: | ---: | ---: | ---: |
| 96-edge forest | 96 | 3 / 3 | 3 / 3 | 0.0000 / 0.0000 | 0.27 / 0.44 |
| 24-edge ring | 24 | 3 / 3 | 3 / 3 | 0.0000 / 0.0000 | 0.99 / 2.58 |
| Color-reflected knot | 22 | 0 / 3 | 0 / 3 | 20.0000 / 0.0000 | 220.25 / 1.25 |
| Parallel-edge knot | 22 | 0 / 3 | 3 / 3 | 22.0000 / 0.0000 | 59.55 / 0.19 |
| 11-edge knot | 11 | 3 / 3 | 3 / 3 | 0.0000 / 0.0000 | 7.79 / 5.00 |
| Knot with pendant stalks | 23 | 0 / 3 | 3 / 3 | 5.9998 / 0.0000 | 207.27 / 4.96 |
| Map A35D7E | 129 | 0 / 0 | 0 / 0 | 20.9831 / 19.4950 | 220.14 / 220.25 |
| Endgame A35D7E | 13 | 3 / 3 | 3 / 3 | 0.0000 / 0.0000 | 0.07 / 0.04 |
| Map A35D7F | 105 | 0 / 0 | 0 / 0 | 40.6992 / 33.7212 | 220.17 / 220.11 |
| Endgame A35D7F | 11 | 3 / 3 | 3 / 3 | 0.0000 / 0.0000 | 0.02 / 0.08 |
| Map 000000 | 112 | 0 / 0 | 0 / 0 | 35.5560 / 33.4407 | 220.10 / 220.09 |
| Map FFFFFF | 107 | 0 / 0 | 0 / 3 | 23.6810 / 21.7344 | 220.20 / 220.10 |
| Map C0FFEE | 99 | 0 / 0 | 0 / 3 | 30.6169 / 17.0010 | 220.12 / 220.22 |

The updated engine returned exact values in 24 of 39 calls, compared with 15 of 39 on the baseline. All three newly solved shapes were above the old 20-edge gate for a single high-cycle-rank component. The reflected knot equals its color reversal. The parallel-edge knot is independently zero by exhaustive option recursion with memoized counts for identical endpoint/color edge classes. The 23-edge fixture has three pairs of opposite half-stalks on one non-ground attachment. Its value equals that of the 11-edge core, independently valued at −1/2.

Among the four prespecified whole maps, the updated engine narrowed every median interval and newly proved Red on FFFFFF. One of its three certificates there was `(-87/4, -1)`. The others had the weaker, still strictly negative upper endpoint `-268435457/17179869184`. The baseline upper endpoint was positive. The supplementary C0FFEE example produced `(-20481/1024, -3)` on all three updated calls. Neither engine priced any of the five complete map openings exactly. A35D7E, A35D7F and 000000 still had no certified winner at this budget.

The 96-edge forest and 24-edge ring were slower in this sample. Both already had cheap exact solutions. Some endgame timing differences are hundredths of a millisecond. A deadline can be crossed while a structural operation is in progress, and timing varies with CPU load, runtime warm-up and garbage collection. The repetitions measure the same fixed inputs and do not estimate success rates across all generated positions.

## One uninterrupted proof session

The 11-edge cyclic fixture has 5 Blue edges and 6 Red edges. Give the **same** session successive deterministic node allowances with an infinite wall budget. The table shows selected cumulative readings for Blue to move. Parentheses exclude an endpoint, square brackets include it. A checkpoint is a charged generator yield. Different solver operations charge at different granularity. The old analyzer exposes no matching count.

| Cumulative checkpoints | Certified value or interval | Proved winner | Stop reason |
| ---: | --- | --- | --- |
| 0 | `(-1, 4]` | unknown | node-limit |
| 21 | `(-1, 1/2)` | unknown | node-limit |
| 53 | `(-31/32, 1/2)` | unknown | node-limit |
| 117 | `[-1/2, 1/2)` | unknown | node-limit |
| 245 | `[-1/2, 1/2)` | unknown | node-limit |
| 501 | `[-1/2, 0)` | red | node-limit |
| 938 | `-1/2` | red | exact |

The two readings at 117 and 245 show further computation with no stronger certificate. By 501 the excluded upper endpoint at zero proves Red wins, although the lower endpoint −1/2 could still be the value. At 938 the search establishes that it is. The full tree oracle returns −1/2 and Red for either starting seat.

## Full-garden rated play

The session tests compare complete board objects across seeds, variants, named opponents and resumed games. Browser checks exercise this through the ordinary map form, a rated deal and the shared practice link. Green `48094F` opens with 123 branches and Red–Blue `90129F` with 133. Their rendered edge identifiers, ownership and paths agree across all three entry points, including the cut of `e100` on the Green board. Paired games compare opponent strength separately for each ruleset. [Full-garden results](BOT_CALIBRATION.md)

## Position difficulty and historical bot calibration

* The six-edge study evaluated six topologies, every two-color assignment and both starters. The 768 full cut censuses matched the independent minimax counts. A four-node, two-physical-cut survey enclosed the completed index in all 768 cases, and 550 intervals were already singletons. Two colorings of the same three-stalk topology offered Blue three legal cuts each. One winning cut out of three scored 68, while three winning cuts out of three scored 5. Across the 328 winning seats the score's rank correlation with dyadic denominator exponent was 0.035 and with root proof effort was 0.482. These are descriptive associations for the constructed corpus. No human decisions or response times were observed. [Design, sensitivity experiments and generated-map results](DIFFICULTY_MODEL.md)
* The calibration experiment replayed 73,728 bot games over 4,096 seeds. Held-out boards were kept together across seat assignments. In finite-coefficient test cases, incorporating opening information reduced Brier score from 0.15644 to 0.15183 on Green and from 0.21677 to 0.18359 on Red–Blue. This calibration covers the original version 1 gardens with 6–22 edges. The named opponents on full gardens have their own paired evaluation. Human rating accuracy and transfer to other graph families remain open. [Calibration design, fitted ladder, uncertainty and held-out results](BOT_CALIBRATION.md) · [Player rating model](RATING_MODEL.md)
* The player filter was separately checked against independent two-dimensional integration. In the model-based simulation, 512 stationary synthetic players at each of three skills completed 80 informative games. Mean final errors were −1.99, −0.59 and +1.88 points at true skills 800, 1000 and 1200. These results test recovery when the opening-generation and response assumptions hold. The fresh-garden Standard-policy experiment also measures misspecification outside those simulated response assumptions. [Player-filter validation and limitations](RATING_MODEL.md)
