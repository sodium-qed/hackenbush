# Groundwork bot strengths

## Full gardens and named opponents

The current roster uses the names and published ratings of eight Chess.com personalities. The local game supplies every Hackenbush move. Its two player pools start at 1200. A chess label supplies the starting strength assumption for the local forecast. Human playing strength at the corresponding rating in either game has yet to be measured. [Chess.com bot roster and ratings](https://www.chess.com/forum/view/community/bot-personalities-engine-levels)

The paired full-garden study takes consecutive, reproducible seeds from `calibrationSeed(0x20000 + i)`. Each pair plays twice per opening with colors swapped and the same first color, board, and bot policies. The strong side can therefore be judged from both seats even when the draw strongly favors one seat. Run `node scripts/full-garden-study.mjs` to compare adjacent profiles and the two widest selected matchups separately for Green and Red–Blue. The script also reports opening size, turns per match, and how often each pair splits its two games.

The 64 evaluation seeds produced 85–151 branches, with a median of 111 compared with 14 on the legacy boards for those same codes. The following are wins for the first-named bot in 128 games per pairing and ruleset. Each entry includes both seats on every opening. The 2,304 games had a median of 41 turns in Green and 62.5 in Red–Blue.

| Pair | Green wins | Red–Blue wins |
| --- | ---: | ---: |
| Aron against Martin | 96/128 | 71/128 |
| Emir against Aron | 70/128 | 76/128 |
| Nelson against Emir | 80/128 | 112/128 |
| Isabel against Nelson | 82/128 | 80/128 |
| Wally against Isabel | 102/128 | 84/128 |
| Li against Wally | 103/128 | 80/128 |
| Noam against Li | 96/128 | 71/128 |
| Noam against Martin | 128/128 | 125/128 |
| Noam against Nelson | 128/128 | 110/128 |

The weaker opponents sample fewer candidate cuts. On Green, stronger profiles more often look for a zero-nimber reply, and Noam always finds one when available. On Red–Blue, stronger profiles examine replies, account for vulnerable supports and solve larger endgames. Noam also asks the bounded analyzer for a proof on promising candidates. A still-open large Red–Blue position can require a heuristic move.

To check whether a game can award points, eight additional seeds were drawn using the assigned human seats on `000000`, `A35D7E`, `A35D7F`, `90129F`, `01CAFE`, `22D301`, `FFFFFF` and `424242`. With all eight bots, Green had 60 assignments with legal lines to both outcomes and four proved losses against Noam. Red–Blue had 58 assignments with both lines and six for which the probe budget was inconclusive. These figures describe the selected seeds. The published chess labels and the 80-point opening adjustment remain provisional for human Hackenbush players.

## Historical study on version 1 gardens

The remainder of this document records the original three-policy experiment in its original 1000-point coordinates. Those gardens and policies are still used to replay or finish saved version 1 matches. Their coefficients apply to the legacy population. The numerical tables below are historical.

The original ladder estimated how often the three opponents beat one another on the small gardens issued at the time. Standard was the local reference at 1000 in each variant. The **overall ladder** compared policies before seeing the deal. The **conditional fit** predicted results once the opening, turn, opponent and eligibility were known.

## Opponents and deal population

| Opponent | Policy actually exercised in the experiment |
| --- | --- |
| Easy | Choose one standing legal cut by indexing the move list with a pseudorandom draw. In Rated play the draw is fixed by the issued seed, side and ply. A refresh at the same position therefore repeats the cut. |
| Standard | Take an immediate win if available. Otherwise rank cuts by surviving material difference, the parity of shared moves and the number of replies. Prefer a cut that avoids an immediate winning reply. Equal scores retain stable move order. |
| Expert | Use the existing graph solver and its move ordering. An exact losing position can have many equally losing cuts under perfect defense. Expert uses its ordinary first-ranked fallback there. That choice affects how well it exploits imperfect defense. |

`legacyRatedDeal` reproduces this assignment from the six-hex seed space and version 1 generator. After a bijective 24-bit permutation, one bit assigns the first color, a distinct bit assigns the human color, and the other 22 bits choose among small, standard and large. For a uniform seed the two seat bits are independent of one another and of the size stratum. The three strata differ in cardinality by at most one among the $2^{22}$ possible size words. Color placement and geometry follow the original seeded generator. The study uses the same seed for both variants, so their geometries match. They receive separate coefficients.

These untimed gardens have 6–22 standing edges in pieces of at most seven. Rated Expert completes its existing exact branch without consulting the wall clock. After identifying the ground vertices, every surviving piece after a cut is a subset of one original piece. Each remaining Red–Blue piece therefore has at most $2^7$ candidate edge subsets for its local value recurrence. The existing solver can price each legal child by adding the values of its pieces. At this size its dyadic arithmetic is exactly representable. Green uses its existing nimber calculation to find a zero option in a winning position. A proof-favored Expert always has a winning reply chain, by induction on the number of live edges. A gate verifies the size, component and purity assumptions and rejects out-of-family inputs for this clock-free path. An independent reference test checks every descendant of several small generated fields, each side and the chosen move. [Mathematical foundations](MATHEMATICAL_FOUNDATIONS.md)

For a fixed side and ply, the Easy permutation maps a uniform seed to a uniform 24-bit word. Indexing a list of $m$ moves partitions those words into bins whose sizes differ by at most one. Conditioning on the dealt geometry and previous play can induce dependence because they share a seed. Casual Easy still draws from `Math.random` and ordinary Expert keeps its wall-clock budget. The rated path supplies its deterministic draws and bounded exact search through optional arguments to the same implementations. A changed strategy, eligibility algorithm, seed distribution or generator calls for recalibration.

## Reproduce the experiment

The recorded run used Node.js v24.22.1 and the repository alone. From the repository root, run

```sh
node scripts/calibration.mjs --check
node --test tests/calibration.test.mjs
```

`--check` regenerates every move, refits both models and compares the generated browser module byte for byte. `--write` replaces that module. A shorter exploratory run is available as `node scripts/calibration.mjs --boards=64 --bootstraps=20`. The command prints design counts, percentile intervals, predictive scores and all coefficients. The browser ships only the coefficients, covariance and sample sizes.

The final sample uses 4,096 distinct seeds. For index $i=0,\ldots,4095$, use `calibrationSeed(0x4000 + i)`. The seed function combines an odd increment with the existing bijection on 24-bit words. Earlier development boards are outside this range. Every fifth index, starting at 4, is held out. Both variants and all games on one opening stay on the same side of the split. The published coefficients use only the 3,277 training openings per variant. The remaining 819 are evaluated without refitting.

Each opening has all nine ordered Blue/Red policy assignments. Each unequal matchup has a reciprocal game on the **same** colored position with the **same** first mover. All three levels also play themselves once. Easy draws are shared at matching seed, color and ply across assignments. This produces 36,864 games per variant and 73,728 games in total. There were 1,372 small, 1,364 standard and 1,360 large fields per variant, including 2,182 with a cycle after fusing the ground. Both 6- and 22-edge openings occurred.

The SHA-256 digest of the ordered seed, variant, size, opener, human seat, policies, eligibility, certified winner information, actual winner and every cut was `5e0be7be8e3c9eefb6fca44bfaccc1b9822a88fbfc35d9e905062dde082b30d2`. The fingerprint of this transcript plus the shipped calibration parameters is `gardens-1-86a747b2c483`.

## Estimators and uncertainty

Let $s$ be a policy's strength in natural log-odds units, with $s_{\mathrm{Standard}}=0$. For the overall ladder, model the probability of a Blue win by $\sigma(s_B-s_R)$, with $\sigma(z)=(1+e^{-z})^{-1}$. All nine assignments enter. Equal-policy games contribute a constant to this fit. Ratings are $1000+(400/\log 10)s$. Only independently collected cross-population data could relate this reference scale to chess or tournament ratings. [Bradley and Terry (1952)](https://doi.org/10.1093/biomet/39.3-4.324)

For the conditional fit, we run the production opening eligibility search for the **issued human seat** against each of the three fixed opposing policies, before using a result. Two terminal lines with opposite winners certify that the player's decisions can affect the result. An exhaustive constant-result proof or an exact winning Expert opponent gives a point probability. Reaching the 600-state cap without either certificate leaves eligibility unresolved. The player-rating system assigns zero change to forced and unresolved games. [Player rating model](RATING_MODEL.md)

On remaining games, let $H=+1$ if Blue has the opening perfect-play win, $-1$ otherwise. Let $T=+1$ for Blue moving first and $-1$ otherwise. Fit a second pair of policy coefficients $t$ with the same Standard anchor, plus an opening effect $h$ and a first-turn effect $f$.

$$
P(\text{Blue wins}\mid H,T,\text{policies}) = \sigma(t_B-t_R+hH+fT).
$$

For self-play validation a known, proof-favored Expert on **either** seat wins with probability 1. If that Expert occupies the human-proxy seat, the preflight can still find another line on which an imperfect human would lose. We omit these perfect-policy results from the finite-coefficient fit. The browser never treats an unverified human as perfect. A held-out diagnostic below removes the evaluator's knowledge of the proxy player's exact policy. After these exclusions, 18,591 Green games and 14,070 Red–Blue games enter the finite fit out of 29,493 training games per variant. This conditioning is essential when reading the Expert coefficients. [Turner and Firth (2012)](https://doi.org/10.18637/jss.v048.i09)

In both fits each free natural-logit coefficient has a weak independent $N(0,4^2)$ penalty. Maximizing the Bernoulli log likelihood minus $\lVert\beta\rVert^2/32$ gives a finite estimate even for a separated resample. The Newton information is $X^T W X+I/16$ with $W_{ii}=p_i(1-p_i)$. Unequal results on an opening and its reciprocal can be correlated. We resample **whole training openings**, preserving their entire slate, and refit 800 times with a fixed resampling seed. Tables give 2.5th and 97.5th bootstrap percentiles. The player model receives the joint sample covariance of conditional Easy, Expert, favored and first coefficients in rating points squared. Standard has zero coefficient uncertainty by identification. Its outcomes still vary. These intervals describe sampling over generated openings and their deterministic policies. Human transfer remains unmeasured. [Cameron and Miller (2015), section VI](https://doi.org/10.3368/jhr.50.2.317)

## Results

The visible ladder includes both seats and forced wins. The conditional coefficient applies together with the signed effects in the next table. Rounded points and 95% bootstrap intervals are shown.

| Variant | Policy | Overall ladder | Conditional rating |
| --- | --- | ---: | ---: |
| Green | Easy | 592 [578, 605] | 574 [559, 589] |
| Green | Standard | 1000 fixed | 1000 fixed |
| Green | Expert | 1167 [1160, 1175] | 1039 [1029, 1050] |
| Red–Blue | Easy | 834 [827, 842] | 731 [717, 743] |
| Red–Blue | Standard | 1000 fixed | 1000 fixed |
| Red–Blue | Expert | 1023 [1020, 1026] | 948 [939, 957] |

| Variant | $h$ for the proof-favored side | $f$ for the first mover | Openings favoring the first mover |
| --- | ---: | ---: | ---: |
| Green | +90.6 [80.0, 101.5] | −92.7 [−102.8, −82.9] | 3,380/4,096 (82.5%) |
| Red–Blue | +194.3 [184.6, 205.9] | −40.8 [−50.1, −31.7] | 1,789/4,096 (43.7%) |

The signs refer to the side whose result is forecast. Moving second reverses $f$ and starting in the perfect-play losing seat reverses $h$. For example, among finite-model Green cases of equal conditional skill, the favored first mover has a net offset of about −2 points and the favored second mover has about +183. First mover and theoretical favorite are correlated in this bank. Across all nine assignments before conditioning, the first mover won 20,789/36,864 Green games (56.4%) and 15,640/36,864 Red–Blue games (42.4%). The fitted negative first-turn effect describes the selected positions at a fixed theoretical advantage.

| Variant | Higher policy vs lower | Higher policy wins | Paired win rate, approximate 95% interval |
| --- | --- | ---: | ---: |
| Green | Standard vs Easy | 7,498/8,192 | 91.53% [90.93%, 92.13%] |
| Green | Expert vs Standard | 5,903/8,192 | 72.06% [71.30%, 72.82%] |
| Green | Expert vs Easy | 7,917/8,192 | 96.64% [96.26%, 97.03%] |
| Red–Blue | Standard vs Easy | 6,003/8,192 | 73.28% [72.48%, 74.08%] |
| Red–Blue | Expert vs Standard | 4,448/8,192 | 54.30% [53.87%, 54.73%] |
| Red–Blue | Expert vs Easy | 6,053/8,192 | 73.89% [73.12%, 74.65%] |

Each comparison averages the two results on each of 4,096 openings. Its descriptive interval is the paired mean ±1.96 times the standard error of the board-level means (0, ½ or 1). Both adjacent gaps are distinguishable in this population. The Red–Blue Expert–Standard gap is much smaller than the Green gap. Red–Blue Expert always converted a favored opening but often chose an unhelpful cut when all cuts lost under perfect defense. On all 12,288 mathematically favored Red–Blue assignments for each level, Easy converted 6,941, Standard 11,432 and Expert 12,288. The corresponding Green counts were 2,690, 8,761 and 12,288. The direct policy results and the conditional regression explain how a 1023 overall Red–Blue Expert can have a 948 conditional strength.

For the issued human seat, the same opening can be eligible against one policy and forced against another. Each table row counts 4,096 board–opponent assignments.

| Variant | Opponent | Two outcomes witnessed | Forced | Unresolved |
| --- | --- | ---: | ---: | ---: |
| Green | Easy | 4,085 | 11 | 0 |
| Green | Standard | 3,664 | 432 | 0 |
| Green | Expert | 2,089 | 2,007 | 0 |
| Red–Blue | Easy | 3,358 | 711 | 27 |
| Red–Blue | Standard | 2,612 | 1,451 | 33 |
| Red–Blue | Expert | 1,678 | 2,400 | 18 |

## Held-out prediction

The comparison model is refitted on the same finite training cells with the two policy effects only. Both models use the same certified point probabilities and exclusion rules. Brier score averages $(p-y)^2$. Log loss averages $-\log P(y)$ using natural logarithms. Smaller values indicate better predictive performance.

| Variant and held-out set | Games | With opening terms, Brier / log loss | Skills only, Brier / log loss |
| --- | ---: | ---: | ---: |
| Green, finite-coefficient cases | 4,659 | 0.15183 / 0.46061 | 0.15644 / 0.47135 |
| Green, all scoreable games, treating the proxy as a player | 5,892 | 0.14825 / 0.45048 | 0.15813 / 0.47355 |
| Green, all resolved bot outcomes | 7,371 | 0.09597 / 0.29114 | 0.09888 / 0.29792 |
| Red–Blue, finite-coefficient cases | 3,599 | 0.18359 / 0.54414 | 0.21677 / 0.62316 |
| Red–Blue, all scoreable games, treating the proxy as a player | 4,668 | 0.15444 / 0.47669 | 0.25041 / 0.69732 |
| Red–Blue, all resolved bot outcomes | 7,326 | 0.09019 / 0.26732 | 0.10649 / 0.30614 |

In the proxy-as-player rows, a favored Expert in the player seat receives the finite forecast for its estimated skill. Only the fixed opponent is known to the forecaster. This tests the likelihood with simulated players of known policy and omits the human posterior uncertainty and difficulty allowance.

Among resolved held-out Red–Blue slates, the model predicted Expert would beat Standard 56.14% of the time and observed 54.79%. The Green figures were 73.18% predicted and 71.43% observed. The favorable results against the skills-only baseline coexist with residual matchup error.

## Scope and open questions

- Deterministic games on a fixed seed are repeats. The statistical sample is the collection of boards. Nearby or mathematically equivalent configurations can recur across visually distinct seeds. The uncertainty calculation treats different generated seeds as representative draws and uses the seed as its sole grouping variable.
- The single paired-comparison coefficient per policy summarizes its slate. Opponent-specific mistakes, losing-position tie breaks and differences among seemingly equivalent mathematical positions can produce residual matchup effects. The exact conditional coefficient for a particular human or board is unknown.
- Human skill transfer, forecast calibration for novice or expert people, and the difficulty-dependent uncertainty allowance require human observations. The measured participants were the three software policies. Seeded Easy can be simulated by a motivated user. Local browser state can be inspected, altered or deleted.
- These results apply to the specified untimed, version 1 bank and the documented policies. Large woven worlds, custom fields, daily puzzles and modified policies require fresh data because their board distributions, play conditions or strategies differ.
