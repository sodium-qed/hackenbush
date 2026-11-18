# Opening-Conditioned Rating

## Current full-garden ladder

Green and Red–Blue each begin at **1200** with a rating deviation (RD) of **200**. Each named opponent has a Chess.com rating label and a separate Hackenbush move policy. Groundwork uses the label as a provisional prior, with 200 points of standard deviation. With a certified perfect-play winner, the initial forecast adds 80 points in favor of that seat. An unknown winner supplies zero signed adjustment. These constants are design assumptions. Paired games on full gardens measure how the deployed policies actually compare. [Bot study](BOT_CALIBRATION.md)

Rating eligibility is established for the human's actual seat and the chosen bot. Two legal continuations ending in opposite results demonstrate that human decisions can change the outcome. A proof that the outcome is fixed, or a manual start before eligibility is established, gives zero rating change. A certified Green win for a perfectly playing Noam is one such fixed outcome. A Red–Blue opening can have two witnessed results against a fallible bot even when its perfect-play winner is unknown.

The live assessment retains its search between slices. After six targeted playouts it alternates seeded exploration with a depth-first traversal of legal human cuts and the bot's fixed reply at each ply. Completing that traversal with only one witnessed result proves the outcome is forced. Evicting a previously completed subtree from the bounded cache can repeat work without losing the active search path.

Automatic mode starts once eligibility is settled and the opening cuts have received their tactical survey, or once every rating input is already settled. Indefinite mode can continue the Red–Blue opening and child proofs to narrow the structural allowance and establish the favored seat. It waits for **Play now** when the result is forced or when both outcomes, the favored seat and the model's rounded difficulty score are all settled. Only the completed match updates the rating. The turn clock starts after the forecast is frozen.

The filter below still uses Gaussian uncertainty, drift and numerical integration. In a full-garden game the opponent prior and certified-seat adjustment supply the forecast offset. The structural allowance is combined with the named bot's uncertainty. Finishing or resigning an eligible game applies the forecast frozen at the deal. A practice game uses the same board and playing policy and carries no rating weight.

Saved tiny-garden games retain their original bot, map version and forecast. On upgrade, absolute player and legacy bot ratings move up 200 points, including both endpoints of every history entry. This carries forward every previous rating change and win probability. The two pools continue to retain their own counts, uncertainty and match history.

## Historical small-garden model

The following experiments, examples, fitted coefficients and initial ratings are recorded in their original 1000-point coordinate system. Standard was the reference on these legacy gardens. The later full-garden generation does not reuse those coefficients. The synthetic recovery script now centers the same inputs on 1200, so the three simulated skill levels are 1000, 1200 and 1400 with the same relative errors.

## Paired comparisons and the choice of model

The Bradley–Terry model assigns additive log odds to a difference in strength. With the familiar Elo-sized unit, a 400-point advantage gives odds of 10 to 1 in a neutral contest between known strengths. The usual fixed-gain update adds $K(y-p)$ for result $y$ and prediction $p$. This uses the same gain for a well-established player and a first-time visitor when $K$ is fixed. A neutral-field assumption also misses the effect of the opening graph. [Bradley and Terry (1952)](https://doi.org/10.1093/biomet/39.3-4.324)

Glickman models changing strength with uncertainty. Glicko-2 also estimates volatility across rating periods. TrueSkill models uncertain skills and performances with approximate Bayesian inference, including team results. Our setting has one human, one stationary policy, no draws and explicit constraints on what results the human can achieve. We use a scalar Gaussian skill estimate, a logistic likelihood with opening effects fitted in bot play, and direct numerical integration. All formulae and policy thresholds below define Groundwork's model. [Glickman (1999)](https://www.glicko.net/ratings/glicko.pdf) · [Glicko-2](https://www.glicko.net/glicko/glicko2.pdf) · [Herbrich, Minka and Graepel](https://www.microsoft.com/en-us/research/publication/trueskilltm-a-bayesian-skill-rating-system/)

## Which games provide evidence?

Perfect-play analysis says which seat has a winning strategy. It does not specify how often a human will find that strategy or an imperfect opponent will allow recovery. Before the first cut, Groundwork certifies the perfect-play winner on the rated garden and separately asks whether the human could achieve each result against **this particular seeded bot policy**.

| Opening classification | Certificate | Forecast and rating treatment |
| --- | --- | --- |
| Both outcomes reachable | Two legal human continuations reach opposite terminal winners, with the same bot and random tape. | Use the statistical win forecast and update from the result. |
| Forced | Every examined branch of the complete reachable tree gives the same winner, or a certified winning Expert can maintain its strategy against every human reply. | Show the exact policy win probability, 0 or 1. Record the game with zero change in rating and RD. |
| Unresolved | Only one winner has been witnessed when the exhaustive-search budget ends. | Show the statistical forecast as an estimate. Record the game with zero change in rating and RD. |

Twelve bounded playouts first try to construct the two witnesses. The human plays Expert on the first probe and follows deterministic exploratory choices on the others. If needed, a depth-first traversal expands at most 600 distinct `(standing edges, ply)` states. The ply fixes the side and the bot's random draw. At human turns all legal cuts are available. At bot turns only the assigned policy's move is available. Each cut reduces the number of standing edges. Induction on that number establishes the completeness of an exhausted traversal. A cutoff cannot establish constancy. The rated deal family has at most 22 edges and at most seven per grounded component, so its clock-independent Expert returns a certified decision at every turn. [Bot policy and calibration evidence](BOT_CALIBRATION.md)

This eligibility rule protects a player who cannot avoid losing, and also a player who cannot fail to win. It differs from simply giving the theorem-favored seat reduced points. For example, in Green `000000` Red opens with a theoretical win against Standard. There are witnessed wins and losses for Red. In Green `90129F` Blue's Expert can force a win against Red, so Red's loss carries zero evidence.

## An opening-specific likelihood

Let $R$ be the human's unknown skill, $B$ the fitted conditional bot rating, $F=+1$ if the human is the theoretical winner and $F=-1$ otherwise. Let $T=+1$ when the human opens and $T=-1$ otherwise. Define

$$
o=-B+F\beta_F+T\beta_T,\qquad q=\frac{\ln 10}{400},\qquad P(\text{win}\mid R,E)=\frac{1}{1+\exp[-q(R+o+E)]}.
$$

The coefficients $\beta_F$ and $\beta_T$ are fitted separately for each ruleset on controlled bot contests. An empirical opening coefficient measures a practical advantage in those contests. The signed proof supplies a predictor whose effect must be estimated from play. The UI's overall paired-seat bot rating includes forced games. The conditional $B$ prices games where a human decision can change the result. These are different populations. For example, Red–Blue Expert has overall rating 1022.8 and conditional rating 948.1. Its perfect conversion when it already holds a forced win contributes to the former. In scoreable seats its deterministic tie-break can miss opportunities to exploit mistakes. [Corpus, held-out results and coefficient estimates](BOT_CALIBRATION.md)

Two uncertainties contribute to the zero-mean nuisance term $E$. The calibration run supplies a seed-cluster bootstrap covariance $C$ for Easy, Expert, opening favor and first mover in squared rating points. For a human facing bot $b$, use $x=(-\mathbf1_{b=\mathrm{Easy}},-\mathbf1_{b=\mathrm{Expert}},F,T)$, giving variance $x^\mathsf{T}Cx$. Standard is fixed by definition. This contrast retains covariance between strength and opening effects.

The second term represents possible board-specific variation in transferring a bot-based model to a human. Let $d$ be the structural difficulty midpoint and $[l,u]$ the range allowed by the opening survey, all on the Cut Discrimination Index's 0–100 scale. We set $t=0.5d+0.75(u-l)$ rating points and take $E\sim N(0,\eta^2)$ with $\eta^2=x^\mathsf{T}Cx+t^2$. The first contribution allows up to 50 points for measured complexity, while a completely unknown structural range allows another 75. These magnitudes are design assumptions. Centering this effect at zero keeps it symmetric between seats. Integrating it makes a noisy encounter less discriminating and does not apply a difficulty bonus to the winner. The structural measure describes the opening player even when the human moves second. The experiment below isolates this term. [Difficulty definition and known limits](DIFFICULTY_MODEL.md)

## Posterior update and uncertainty

Before an informative result, the prior is $R\sim N(m,v)$ with $v=\mathrm{RD}^2+12^2$. The 12-point per-game random walk is a declared allowance for changing skill. It preserves responsiveness as the record grows. Idle time and zero-information deals add no variance. The prior center remains $m$. The nuisance variable is modeled independently of this player's conditional skill.

Set $s=\sqrt{v+\eta^2}$ and let $Z$ be standard normal. The latent performance margin is $D=m+o+sZ$. Let $L_1(D)$ be the logistic win probability above and $L_0(D)=1-L_1(D)$. Integrating $L_1$ yields the displayed prediction. For the observed outcome $y$, define

$$
a=\mathbb E[L_y(D)],\qquad h_1=\frac{\mathbb E[Z L_y(D)]}{a},\qquad h_2=\frac{\mathbb E[Z^2 L_y(D)]}{a}.
$$

Since $R$ and $D$ are jointly Gaussian, conditioning on $Z$ gives skill mean $m+gZ$ and variance $v-g^2$ with $g=v/s$. Taking expectation and variance over the posterior for $Z$ gives

$$
m'=m+gh_1,\qquad \mathrm{RD}'=\sqrt{v-g^2+g^2(h_2-h_1^2)}.
$$

Implementation uses 19-point Gauss–Hermite quadrature. Win and loss probabilities are computed separately for numerical stability in the tails. After each informative game we carry the two posterior moments into the next Gaussian prior. The moment formulas follow from the model. The quadrature and the repeated Gaussian projection are approximations. An independent two-dimensional grid integral in the tests checks forecasts and posterior moments.

Under the model, $p\,m'_\mathrm{win}+(1-p)m'_\mathrm{loss}=m$ by total expectation. Thus an assigned game offers zero expected gain to a player whose outcomes follow its predictive distribution. A particular winning streak, a systematic mismatch, or selective resignations may produce drift. Bot ratings stay fixed. Players' total points need not sum to a constant. A player remains provisional until at least ten **informative** results and RD at most 110. The chart band is one model RD. Both the initial prior and the provisional thresholds are design choices pending population evidence.

### Example deal receipts

All three examples begin at $1000\pm200$. Deltas use the unrounded filter and are shown rounded for display.

| Variant and seed | Human seat and opponent | Opening result | Predicted human win | Change on win | Change on loss |
| --- | --- | --- | ---:| ---:| ---:|
| Green `000000` | Red opens against Standard | Perfect play favors Red, both results reachable | 49.8% | +91 | −90 |
| Red–Blue `000006` | Red opens against Easy | Perfect play favors Red, both results reachable | 87.8% | +24 | −175 |
| Green `90129F` | Red moves second against Expert | Expert can force a Blue win | 0% | Inaccessible in play | 0 |

## Local records and interruption

- A cryptographically seeded cursor traverses the existing bijection of 24-bit map numbers with an odd step. Addition by an odd number visits every residue modulo $2^{24}$ before repeating. The permutation preserves that property. A single cursor covers both variants, and drawing stops before wraparound. The seed assigns the size, first mover and human seat. The user selects only the ruleset and policy.
- An assignment becomes visible only after its identity, opening proof, reachability classification, forecast, bot calibration version and initial session snapshot have been written together. Preparation runs in a Worker. If preparation fails there is no visible deal to shop. One pending assignment spans both variants and survives switching to other modes, browser suspension or a refresh. A resignation is a recorded loss. An informative resignation uses the already-frozen loss update. This policy prices abandonment and makes no inference about the player's motive.
- Each cut must extend the saved legal move list by one, or exactly repeat the stored checkpoint. The store regenerates the board, verifies the legal move and rechecks seeded computer play. Only a matching issued ID, seed, ruleset, seat assignment, board version, clock setting and opponent policy qualify. The terminal outcome is recomputed. Local, daily and custom game results cannot be submitted through the ordinary controls. Replaying a receipt cannot create a second update.
- An origin-wide Web Lock serializes short mutations. A read/write IndexedDB transaction provides an alternative exclusive guard. In a storage-only environment that supplies neither coordination API, writes are queued within the current JavaScript context and independent tabs cannot be guaranteed to serialize. The ledger itself is one `localStorage` item. A rejected write leaves the last durable snapshot available for retry. [Web Locks specification](https://www.w3.org/TR/web-locks/) · [Indexed Database transaction scheduling](https://www.w3.org/TR/IndexedDB-3/#transaction-scheduling)
- The ledger keeps lifetime counts and full-precision moments for each pool plus the last 40 receipts per variant. Each receipt contains its seed, session snapshot, bot, human color, opener, opening metrics, expectation, outcome and before/after rating and RD. A current-format reset clears both pools and invalidates pending writers. A supported v1 interchange layout with per-pool receipt lists migrates on the next successful edit. Groundwork had no published rating profile before this feature. Existing game saves have independent keys. Invalid current-format data remains available until explicit reset. An unrecognized newer version is preserved. Previously issued numerical forecasts use their frozen calibration, including after a compatible calibration update.

Local data and the application are under the browser owner's control. Clearing storage starts a fresh record. Developer tools, external analysis and knowledge of future seeded moves can affect results. The estimate describes play on this device under these conventions and has no mapping to chess Elo or a cross-user competitive leaderboard.

## Reproducible checks

Run `node --test tests/rating*.test.mjs` and `node scripts/validate-ratings.mjs` from the repository root. The latter uses a fixed generator stream for each experiment.

**Recovery with known synthetic skills.** For each true rating, 512 independent stationary players complete 80 informative games. An opening offset is sampled uniformly from −1300 to −700 points and a nuisance SD uniformly from 10 to 110. Outcomes come from the declared logistic-normal model. Every filter starts at $1000\pm200$ and knows the challenge parameters. The simulation holds true skills fixed while the filter allows drift.

| True rating | Mean final error | Final RMSE | Mean final RD | Within 1.96 RD |
| ---:| ---:| ---:| ---:| ---:|
| 800 | −1.99 | 53.67 | 72.48 | 99.2% |
| 1000 | −0.59 | 50.84 | 69.43 | 99.2% |
| 1200 | +1.88 | 55.11 | 72.58 | 99.0% |

The filter recovers these stationary skills with small signed average error. The wide empirical coverage shows that its drift allowance is conservative in this particular simulation. It does not establish frequentist coverage for human players.

**Reference policy on fresh gardens.** For each variant, `calibrationSeed(0x9000 + i)` for $0\le i<384$ gives a seed outside the calibration corpus. Standard occupies the assigned human seat against each of the three production policies, providing 1,152 results per variant. The reference skill is fixed at 1000 with zero incoming RD and the model's 12-point per-game process allowance. Brier scores average squared probability error over the same informative assignments. Predictions for the three policies on the same seed are correlated.

| Variant | Informative / forced / unresolved | Observed / predicted wins on informative deals | Brier, full model | Brier, structural allowance set to zero | Brier, overall bot Elo alone |
| --- | ---:| ---:| ---:| ---:| ---:|
| Green | 925 / 227 / 0 | 69.08% / 67.61% | 0.16485 | 0.16487 | 0.19606 |
| Red–Blue | 745 / 398 / 9 | 77.72% / 73.62% | 0.12569 | 0.12572 | 0.23191 |

Every forced prediction matched the actual policy result. Conditional opening forecasts reduced squared error against the overall-ladder baseline in this sample. Red–Blue still underpredicted the reference's win rate by 4.1 percentage points. Removing the structural term made a negligible difference. These experiments supply no evidence that the chosen structural transfer variance predicts human performance. Multiple play styles, real human learning rates, calibration revision effects, and the irreducible uncertainty shared by repeatedly facing the same fitted policy remain open. Treating calibration uncertainty as fresh nuisance variation at each update approximates a persistent parameter error and can understate long-run uncertainty. [Remaining research questions](OPEN_PROBLEMS.md)
