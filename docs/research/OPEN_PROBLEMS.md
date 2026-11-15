# Open problems and limits

## Red–Blue proof search

Large cyclic components can exhaust even the Research budget. A certified interval can remain wide, or straddle zero with neither side proved for the requested mover. A proof that one seat wins is weaker than an exact numeric value. For example, a non-strict lower bound of zero suffices for Blue when Red moves first in a pure Red–Blue position. It leaves open what happens when Blue moves first.

A useful next benchmark would stratify large, previously unseen connected components by cycle rank and ground connectivity. Measure separately the first time a winner is certified, the first exact price, and the final interval width at a fixed node cap. A cache hit on a revisited replay and a fresh solution measure different things. Finite search experiments cannot establish a worst-case running-time bound. The published hardness result concerns the exact value of general Red–Blue graphs. [Demaine and Hearn, §4.10](https://library.slmath.org/books/Book56/files/10demaine.pdf)

A mixed component with interdependent green and colored edges can be a general partizan game. A search can prove its outcome for a specified opener while the value representation remains unresolved. Extending the exported value format to arbitrary short games would require a game-tree simplification algorithm and separate validation.

## How well does the structural index predict human mistakes?

The index measures the choices offered to one mover. It treats a losing choice with no immediately winning reply differently from one with a visible tactical refutation. It does not measure a player's familiarity with a motif, visual salience, recall of a nim-sum, or the time it takes to spot a bridge. A board can have one mathematically correct cut that practically every player recognizes.

A human validation study could collect, with consent, first cuts on matched-size positions and response times in untimed play. Split by both player and seed family when evaluating predictions to avoid memorized openings appearing in the test set. Before collecting any such data, choose the target (mistake rate, response time, or both) and whether to condition on experience. The shipped game collects no remote play telemetry.

## Transfer from bots to players

The original experiment estimated relative policy strength on small gardens with Standard fixed as its reference. The current full-garden ladder uses the displayed Chess.com labels as provisional strength assumptions. Paired tests now cover the actual named policies on full maps. A change in policy or in the distribution of boards can change their relative strength. A player's displayed RD describes uncertainty inside this local model. It does not account for every mismatch between bot and human decision making.

Two witnessed lines to opposite outcomes establish that a human's choices can matter. They say nothing about how likely that person is to find either line. Unrated openings with incomplete witness searches may differ systematically from the scoreable sample. Reporting rates of forced, witnessed and unresolved games by variant, bot and size would help quantify that selection effect on a future data set.

The forecast uses a documented allowance for structural difficulty whose coefficients have not been estimated from people. Held-out bot matches test the bot fit. Establishing calibration for players would require enough independent human games to assess predicted probabilities against actual results, including by opening advantage and opponent.

## Limits of the rated format

Rated games now use the same full maps as regular six-hex seeds. Exact Green play scales to these networks. The Red–Blue solver can leave the winner unresolved on large cyclic components. The smaller historical census established its own three-policy ladder on six to twenty-two edges. Measuring the named policies against many independent human players, or extending the new ladder to timed and custom games, remains open. Whether play transfers between Green and Red–Blue is an empirical question. The current implementation keeps separate pools.

One unfinished assignment per browser prevents ordinary in-app rerolls. Browser storage can be edited, cleared or lost. Results measure play against local bots on that device. There is no cross-device identity or public ranking.
