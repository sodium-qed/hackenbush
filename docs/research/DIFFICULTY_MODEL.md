# Cut Discrimination Index

Groundwork estimates the difficulty of choosing a cut *on this turn*. The outcome of a move assumes untimed normal play by both seats. The Cut Discrimination Index (CDI, version 1) is an original structural estimate on an integer scale from 0 to 100. Its weights are design choices. A score of 60 does not predict a 60% human error rate.

## Evidence and design

Anderson, Kleinberg and Mullainathan measured human errors in solved chess endgames and compared them with the proportion of legal moves that blunder. Their results motivate counting choices that squander a win. Guid and Bratko examined changes in chess evaluations with search depth. Groundwork’s shallow policy recognizes a win this cut and a refutation on the opponent’s next cut. The available human evidence concerns chess. [Anderson et al., KDD 2016](https://arxiv.org/abs/1606.04956) · [Guid and Bratko, Search-Based Estimation of Problem Difficulty for Humans](https://ailab.si/matej/doc/Search-Based_Estimation_of_Problem_Difficulty.pdf)

Finite normal play has no draws. A winning cut leaves a losing position for the next seat. An immediate win leaves that seat no legal cut. An immediate refutation allows the opponent to cut once and leave the original mover no legal cut. Lacking an immediate refutation says nothing by itself about the eventual winner.

## Definition

Let $n$ be the number of legal physical cuts, $w$ the number of winning cuts, $f$ the number of losses with an immediate refutation and $h=n-w-f$ the remaining losses. Parallel edges count individually because a player selects a physical branch. A terminal position scores zero. If $w=0$, both decision penalties below are zero because every cut has the same perfect-play outcome.

When $w>0$, an uninformed policy chooses uniformly and throws away a win with probability $B=(n-w)/n$. A second policy always takes an immediate win. Otherwise it discards all immediately refuted cuts and samples uniformly from what remains. Its error probability is $S=0$ if an immediate win exists, or $S=h/(w+h)$ otherwise. A genuine winning cut always survives that filter. Thus $0\le S\le B\le1$. A large $S$ measures concealed losing alternatives. This meaning of depth concerns the first two plies. A player who recognizes a nim-sum can solve a tactically concealed position immediately.

The reference mixture is $R=(B+2S)/3$. Giving two shares to shallow tactical inspection distinguishes an exposed trap from a cut requiring further reasoning. These weights fix a reproducible ruler. They have not been fitted to people.

Identify all grounded vertices as one root. Let $m$ count live edges and $m_i$ count edges of each independent summand meeting only at that root. Define $C=\sum_i m_i(m_i-1)/(m(m-1))$ for $m>1$, zero otherwise. This is the probability that two distinct edges belong to the same ground summand. Let $Y$ be the fraction of edges on a cycle including self-loops and parallel pairs. Let $A$ be the fraction of active, non-ground vertices that are articulation vertices in the ground-contracted graph, zero when there are none. Set $T=(C+CY+A)/3$. The product discounts cycles split among independent pieces. Bridge count, cycle rank, physical ground contacts and cascade sizes accompany this scalar. Lowlink tests for articulation use edge identities, so a second parallel edge can witness an alternate path. [Tarjan, SIAM Journal on Computing, 1972](https://doi.org/10.1137/0201010)

The displayed score is the nearest integer to $100[R+(1-R)T/5]$. Structural reading contributes at most 20 points, with less headroom as decision risk increases. A decided loss can still contain structure worth reading. Edge count alone contributes no points. Solver effort, running time and the size of a dyadic denominator have no coefficients. In particular, numerically tiny values can still have obvious winning cuts.

## Certification under a budget

The opening graph traversal identifies all immediate wins from exact falling-edge sets. When every active edge directly touches ground, each cut removes only itself. The Red–Blue balance and parity of the remaining green tokens then classify all options by arithmetic even with no successor budget. On other surveyed children a second traversal checks whether any legal reply removes all the first mover’s remaining cuts. An exact Green nimber classifies the continuation. On a colored graph the analyzer can establish the child’s winner by arithmetic, a certified bound or game-tree search. Its heuristic ordering cannot classify an option. A proved losing parent makes every legal choice losing. With a proved winning parent, once every candidate except one has been ruled out, the remaining candidate is a winning witness.

Write $W,L$ for the numbers of proved winning and losing cuts, $F$ for observed immediate refutations, and $H$ for proved losses with a completed screen finding no immediate refutation. If the root is winning, take

$$
w_{\min}=\max(1,W),\quad w_{\max}=n-L,\quad h_{\min}=H,\quad h_{\max}=n-F-w_{\min}.
$$

Consequently $B$ lies between $1-w_{\max}/n$ and $1-w_{\min}/n$. With no immediate win, $S$ lies between $h_{\min}/(w_{\max}+h_{\min})$ and $h_{\max}/(w_{\min}+h_{\max})$. The numerators count losses that survive the screen. The lower bound permits every unclassified candidate to win and every other unscreened loss to have an immediate refutation. The upper bound allows the fewest possible winners and hides every other candidate except a proved immediate refutation. If a root loss is still possible both lower endpoints become zero. If an immediate win exists both endpoints for $S$ become zero.

**Containment.** The score is nondecreasing in $B,S,T$ on their unit intervals. Applying the same monotone rounding function at each endpoint therefore encloses the completed integer index. This is deterministic uncertainty about unclassified cuts. It gives no statistical confidence level for a human prediction. `complete` means the rounded index has collapsed to one integer. `coverage` records the fraction of physical cuts with a certified outcome, with 1 for a terminal position. For example, one legal move has zero decision penalty even while its winner is unknown. Incomplete readouts use the rounded midpoint as a display estimate.

Exact values supply a separate sensitivity readout. For Red–Blue it includes the observed minimum and maximum child numbers and their exact dyadic difference. A partial spread is a lower bound on the final spread. Green records the number of distinct observed nimbers, since numeric distances between nimbers do not order strategic advantage. Mixed graphs can supply winning and losing cut proofs without supplying a comparable numeric spread.

The survey charges one unit per successor graph inspection and adds the child analyzer’s proof-node count. It shares the remaining allowance across the remaining sampled cuts in stable board order. A mandatory initial traversal and structural work inside each proof have their own cost. Wall-clock targets are cooperative. Work is bounded by a move limit, a node limit (at most 65,536) and a 256-edge mask limit. Above that size, the inspector retains legal counts and available external winner certificates and spans the unmeasured structural term across $[0,1]$. An interrupted sample makes no assumption about the fraction of winners in its unvisited suffix.

## Controlled experiments

Run `node scripts/difficulty-study.mjs` from the repository root for the JSON tables. Run `node --test tests/difficulty.test.mjs` for regression checks. Both procedures use the shipped rules. The small-board reference computes legal continuations by repeatedly discovering ground reachability and solves the normal-play game tree independently of the production evaluator.

### Fixed edge count, topology and color

The census covers all $2^6$ Red–Blue colorings of six specified topologies with each seat to move (768 assignments). It includes 328 winning seats. For every assignment the complete survey matched the independent winner and winning/losing cut counts. Every four-unit, two-cut survey interval contained the complete score when supplied the opening certificate. In 550 cases that interval already identified the rounded score. Among the winning seats the median remaining width was 30 points.

| Six-edge shape | Winning seats of 128 | CDI range, all seats | Median CDI, winning seats |
| --- | ---: | ---: | ---: |
| Six separate grounded edges | 44 | 0–0 | 0 |
| One stalk | 64 | 0–12 | 12 |
| Two forks | 52 | 0–13 | 5 |
| Independent stalks of heights 3, 2, 1 | 60 | 0–76 | 5 |
| One grounded ring | 56 | 0–47 | 13 |
| Two triangles meeting at one non-ground vertex | 52 | 0–22 | 15 |

Across all 128 seats per topology, the ring averaged 22.469 opening proof expansions. Its successors required zero expansions because removing a ring edge produces a forest. The two triangles averaged 44.688 opening and 38.563 successor proof expansions. All four acyclic families required zero expansions beyond structural evaluation. On winning seats, CDI’s rank correlations with opening and successor proof expansions were 0.482 and 0.356. The generator, proof order and graph arithmetic affect these work counts.

On the 3, 2, 1 forest read each stalk from its base. With Blue to move, `BBR / RR / B` has value $1/2$ and one winning cut of three. Both losing alternatives survive the immediate reply screen, giving CDI 68. On the same graph `BRR / BR / B` has value $7/4$ and all three Blue cuts win, giving CDI 5. Both exact values follow from forest arithmetic with zero search expansions. A higher denominator did not imply a harder decision in this pair.

| Green stalk heights | Winning / legal cuts | Losing cuts refuted next reply | CDI |
| --- | ---: | ---: | ---: |
| 4 | 1 / 4 | 3 | 34 |
| 1, 1, 2 | 1 / 4 | 0 | 76 |
| 40 | 1 / 40 | 39 | 41 |
| 1, 1, 1, 1, 1 | 5 / 5 | 0 | 0 |

The height-four stalk and the four-edge forest have identical raw winning fractions. On a single stalk the base cut wins immediately. In the forest the correct cut erases the height-two stalk, leaving two singletons whose nimbers cancel. A 40-edge stalk also has a visible base cut and scores below this four-edge forest. Conditional on the same graph, color and turn, several cuts leading to equal game values may still be separate physical choices in these counts.

### Perturbations, depth and weights

Each of the 2,304 undirected one-edge recolorings (topology and seat fixed) was counted once. The perfect-play winner changed in 640 pairs. The CDI stayed fixed in 1,760, and the mean absolute change was 4.328 points. The largest change was 71 points on the 3, 2, 1 forest. Recoloring the base of the second stalk changed `RBB / BB / B` to `RBB / RB / B`. Blue remained the winner while its opening score rose from 5 to 76.

For an independent horizon check, the script also computes the shortest literal terminal proof of each cut. A terminal node costs zero plies. A winning node takes one plus the minimum witness depth, and a losing node takes one plus the largest child depth. Classifying every root choice requires the maximum over its cut-plus-child depths if using terminal play alone. Among the 328 winning seats, Spearman’s rank correlation between that all-cuts depth and CDI was 0.306. Correlation with the uniform-choice error fraction was 0.717, partly by construction. Correlation with the exact denominator exponent was 0.035. These are descriptive statistics over an exhaustive set of designed cases with ties, shared graphs and color symmetries. They represent no independent sample of human problems.

Changing the shallow policy’s weight from two thirds to 0.5 or 0.8 gave rank correlations with the original score of 0.985 and 0.979 on winning seats, with maximum score changes of 5 and 4 points. Setting the structural cap to 0.1 or 0.3 gave 0.976 in both cases, with maximum changes of 7. This establishes local sensitivity on the census. Other game families and different player strategies can change those orderings.

### Seeded game fields

The shipped version-1 botanical generator was run for `CDI-0` through `CDI-5` and the version-2 network generator for `CDI-0` through `CDI-2`. Each seed used small, standard and large sizes, both variants and both moving seats. The reproducible limits were 640 opening proof nodes, then 512 survey units and up to 24 non-immediate cuts per seat. The study uses deterministic work limits with no wall-time cutoff. Current field-by-field coverage, interval widths and search effort are emitted by the same command.

| Generated field | Seat openings | Edges | Completed scores | Mean cut-outcome coverage | Median / maximum interval width |
| --- | ---: | ---: | ---: | ---: | ---: |
| Version 1 Green | 36 | 6–22 | 36 | 1.000 | 0 / 0 |
| Version 1 Red–Blue | 36 | 6–22 | 36 | 1.000 | 0 / 0 |
| Version 2 Green | 18 | 14–45 | 10 | 0.880 | 0 / 41 |
| Version 2 Red–Blue | 18 | 14–45 | 4 | 0.366 | 81 / 83 |

Fully measured version-1 fields have an edge-count/score rank correlation of 0.269 in Green and −0.371 in Red–Blue. Both moving seats share each board. The small seeded corpus and incomplete cyclic positions limit extrapolation. A fast loss certificate can settle all cut outcomes and the strategic score even when the actual numerical value remains unresolved.

## Interpretation and untested hypotheses

The signed winner, certified child outcomes, legal counts, topology and interval-containment argument concern the rules of the game. Choosing these features and their weights defines the index. The experiments show that it responds to physical choice scarcity, the visibility of a refutation, and controlled changes of topology and color. The hypothesis that CDI predicts human error conditional on board size, game variant and player experience remains open. A suitable prospective study would hold out players and seeds and evaluate actual cut errors and decision times against edge count and uniform blunder fraction as separate baselines.

CDI describes the decision at one turn. It gives no credit for delaying an inevitable defeat or finding chances against an imperfect opponent. Repeated symmetric cuts and familiar motifs can make human choices easier than the two simple policies predict. A long, unbranched game can demand patience despite an easy opening cut. These limits matter when interpreting the rating model’s separate pre-match expectations.
