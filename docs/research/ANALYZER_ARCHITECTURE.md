# Position analysis and proof certificates

The analyzer answers two different questions about the current standing edges under untimed normal play. A value describes the game in sums with other games. A winner names the player who wins from the recorded side to move. A broad interval can settle the second question before it settles the first.

## The previous search

At base revision `b6a054d`, the analyzer already used exact BigInt arithmetic, priced forests, split independent attachments at ground, and followed one cut sequence per color to bound difficult positions. Its 220 ms default assigned up to 52% of the time to exact pricing, up to 82% to numeric work, and the remainder to a fresh bot winner search. A cyclic component entered exhaustive pricing only with at most 20 edges or cycle rank at most two. A new invocation rebuilt all its analysis state. The worker sent one reply per replay frame.

The fixed thresholds, loss of earlier work and duplicate graph preparation were implementation choices. Exponential game trees and the known hardness of general Red–Blue pricing remain mathematical obstacles. A particular graph can still admit an inexpensive certificate even with many cycles. See [Berlekamp's discussion of Red–Blue Hackenbush and redwood beds](https://math.berkeley.edu/~berlek/pubs/temperatures-combinatorial-games.pdf).

## Entry points and resource limits

`createAnalysisSession(board, live, side, variant, {maxEntries})` creates one position's proof. Its `refine({budgetMs, nodeLimit})` method is resumable. Each allowance applies to that call. The initial structural pass counts toward the first call's time. Passing zero obtains the structural certificate immediately. For reproducible experiments, use a finite node limit and `budgetMs: Infinity`. `analyzePosition(..., {stats: true})` creates a one-shot session. Without the stats option it preserves the former serialized result shape.

| Mode | Cumulative value-search time per position | Cumulative search checkpoints per position |
| --- | ---: | ---: |
| Quick | 220 ms | 3,000 |
| Deep | 2,500 ms | 50,000 |
| Research | 15,000 ms | 300,000 |

The worker publishes partial results between slices of up to 65 ms and schedules another slice automatically until the requested mode limit or a completed proof. A higher mode can continue a lower mode's work. Changing replay positions or pressing Stop supersedes the previous job. A nonresponding worker can be terminated. The optional cut-difficulty pass has its own smaller budget. Its score never acts as evidence for a value.

| Result field | Meaning |
| --- | --- |
| `kind`, `exact`, `number`, `nimber` | The game class and any fully proved value. Numeric values use reduced fraction strings. |
| `lower`, `upper`, `lowerOpen`, `upperOpen` | Endpoints and strictness for the Red–Blue numeric summand. A separate Green nimber, when present, is reported independently. |
| `winner` | A proved winner with the supplied mover, or `null`. |
| `nodes`, `cacheHits` | Cumulative proof checkpoints and successful table lookups. A checkpoint represents a search-state visit, candidate edge examination or symmetry-mapping step. A state may be revisited. Direct graph arithmetic costs time and consumes zero search checkpoints. |
| `durationMs`, `searchEdges` | Cumulative active analysis time including setup and structural work, and the number of edges presented to the search after any numeric compression. Idle time between slices is excluded. |
| `status` | `exact`, `time-limit`, `node-limit` or `search-complete`. The last status can describe a fully decided interwoven mixed outcome whose game form remains unknown. |

Node limits are hard for these counted checkpoints. Wall-clock limits are cooperative. One mandatory structural pass, a graph traversal within a checkpoint, OS scheduling or garbage collection can extend elapsed time. A stopped calculation preserves only certificates already published. A flat interval at successive checkpoints genuinely means that the extra effort yielded no tighter public bound.

## Game classes and exact structural work

All grounded vertices become one root. A depth-first lowlink traversal finds which edges fall on each cut. A bridge removes itself and its detached side. Parallel edges preserve alternate support. A grounded-to-grounded edge becomes a loop that can be removed independently. Separate root attachments form a disjunctive sum.

Green components use fusion on cycles, addition of one nimber unit below a rooted branch, and XOR across independent branches. For interwoven historical three-color positions a separate search alternates legal moves of the two players. One losing reply position proves a winning move. Declaring a loss requires refuting every legal move up to verified interchangeable parallel edges. Detachable Green and colored parts yield a number plus a nimber. At nonzero numeric value the sign decides. At numeric zero a nonzero nimber favors the mover and a zero nimber favors the other side. [Green Hackenbush lecture notes](https://www.cs.cmu.edu/afs/cs/academic/class/15859-s05/www/lecture-notes/green-hackenbush.html)

For a Red–Blue forest, sum the rooted branches as ordinary numbers. A Blue support below a value $x$ evaluates to $1+x$ for $x\ge0$. For $x<0$ put $m=\lfloor-x\rfloor$. Its value is $(1+(x+m)/2)/2^m$. A Red support gives the reflection $-B(-x)$. Both maps are strictly increasing, so certified intervals propagate through a single support, including their strict endpoints. A monochrome component is its signed edge count. Its owner can remove cycle edges first and then outer leaves, spending every edge. [Bartlett, *A Short Guide to Hackenbush*](https://www.math.uchicago.edu/~may/VIGRE/VIGRE2006/PAPERS/Bartlett.pdf)

### Replacing a pendant forest inside a cyclic graph

The preprocessing pass peels non-ground leaves while retaining the cyclic core and its grounding paths. A self-loop at a vertex is a one-edge game attached at that vertex. Accumulate the exact value of every removed branch at its surviving attachment. If the whole pendant forest can be represented by a shorter stalk, insert that stalk in the private proof graph. A zero forest disappears. The physical board, replay and legal player cuts retain their original branches and IDs.

**Proof of substitution.** Let $G[H]$ be the core with $H$ attached only at $v$, and suppose $H=K$ as rooted games. In the difference $G[H]+(-G[K])$, the second player mirrors each core cut in the opposite copy. After the reply the two cores agree with colors exchanged. If the cut disconnected $v$, both attachments have fallen and the residual paired cores cancel. If the attachment survives, all moves in $H$ and $-K$ are still available as moves in their own sum. Against a move in either attachment, use the second-player strategy of the zero game $H-K$. This maintains a second-player win there as long as the cores preserve $v$. Every turn decreases the finite edge count, so the strategy wins playing second from either side. The difference is zero. This explains why an arbitrary core with cycles can support the substitution. The notes describe this argument as the colon principle. [Colon principle and proof](https://www.cs.cmu.edu/afs/cs/academic/class/15859-s05/www/lecture-notes/green-hackenbush.html)

The stalk constructor writes an integer as consecutive edges of one color. For $n<x<n+1$ with $x>0$, use $n+1$ Blue edges, a Red edge worth $-1/2$, then successive signs of weights $1/4,1/8,\ldots$ until the dyadic remainder vanishes. Reflect negative values. For example, two Blue-supported Red twigs at the same articulation each contribute $1/2$. Their four edges can be replaced by one Blue edge there.

## Certified intervals before deep search

The following bounds are derived here from legal play. Let $b,r$ count all Blue and Red edges. Let $s_B,s_R$ count edges reachable from the current base along an entirely Blue or entirely Red path, respectively. For a grounded position containing both colors,

$$
-s_R < V < s_B,\qquad s_B-r \le V \le b-s_R .
$$

**First pair.** Cut only Blue until no Blue remains. The remaining Red graph is exactly the one reachable using Red paths in the original position. Such paths never disappear in this sequence. Any Red edge that survives must have such a path. This terminal Red graph has value $-s_R$. Every Blue cut strictly decreases the value, so this is a strict lower endpoint. Interchange the colors for the upper endpoint.

**Second pair.** Blue can guarantee $s_B$ Blue moves by removing cycle edges and then leaves of the secured Blue subgraph. Red cannot disconnect any still-preserved Blue path. Red can make at most $r$ board moves. Add an independent integer game $r-s_B$ to balance the two move counts. If it is positive, Blue gets extra moves. If negative, Red gets extra moves. Blue can answer every Red move when Red starts, which proves $V+(r-s_B)\ge0$. Reflect colors for the other inequality. These waiting-move bounds are weak inequalities, and can be equalities. The solver intersects them with the strict bounds.

Additional one-color paths stop earlier whenever a structurally priced follower provides a better witness. Two move orders try cycle cuts first or prioritize the difference between opposing and friendly material dropped. Ordering only chooses legal paths. Each lower or upper endpoint follows from real cuts or a separately proved inequality.

## Comparing with a dyadic and obtaining an exact price

For a canonical dyadic $q$, Conway comparison gives

$$
G\ge q\ \Longleftrightarrow\ (\forall G^R,\ G^R\not\le q)
\ \land\ (\forall q^L,\ G\not\le q^L).
$$

Exchange inequalities, colors and options for the other direction. An odd numerator $p/2^k$ has canonical neighbors $(p\pm1)/2^k$. A nonzero integer has just the neighbor one step toward zero, and zero has no options. Each recursive test either decreases the graph or simplifies the threshold. An already proved interval can answer immediately. A single counterexample refutes a universal test. Because pure Red–Blue games are numbers, failure of $G\ge q$ proves $G<q$ strictly. If all but one independent summand are priced, subtract their exact sum from the threshold and search the residual game. [Game order and second-player wins, Larsson's lecture notes, Theorem 9](https://www.ieor.iitb.ac.in/sites/default/files/LectureNotesCombGameIE619_Spring2025_OrganizedSections5April_0.pdf)

Search interleaves the zero comparisons, tests of the simplest candidate in the current interval, value search and small-depth lookahead. For example, Blue to move in a pure number wins exactly when $G>0$. A proof of $G\le0$ is sufficient to award the win to Red. When the exact number is still unknown, the engine can issue that winner together with an interval having a closed zero endpoint.

For full pricing, use the largest Blue option $L$ and smallest Red option $R$. Their game is the simplest dyadic strictly between them. An option whose entire certified range cannot improve the known extremum may be discarded. Parallel edges with the same endpoints and color are interchangeable by an explicit edge permutation. Other moves remain eligible. Complete extrema, opposing comparisons that pin the same number, a structural equality, or an interval containing only one admissible lattice point can certify an exact value. Running out of work yields a partial interval. [Simplicity rule and Red–Blue values](https://math.berkeley.edu/~berlek/pubs/temperatures-combinatorial-games.pdf)

The one-, two- and three-ply lookahead first propagates every available child's interval. Each Blue child lower endpoint is a strict lower bound on its parent. Each Red child upper endpoint is a strict upper bound. There is a further bound after checking all options. Write $s(L,R)$ for the simplest number in a valid open interval. This function is nondecreasing in both endpoints whenever both pairs are valid. If raising both endpoints caused the simplest number to fall, both distinct numbers would belong to both intervals, contradicting uniqueness of the simplest. Consequently $s(\max L_{lo},\min R_{lo})$ is a weak lower bound whenever these approximants are ordered and the working grid contains an interior point. The upper-endpoint pair works identically. Overlapping approximants are skipped.

A separate equality proof checks for a rooted color-reversing graph bijection. Four color-refinement rounds only prune candidates. A successful mapping must preserve each vertex pair's edge multiplicities, loops and root, after color reflection. A self-matching numeric component satisfies $V=-V$, hence $V=0$. Two independent components matched against each other's color reflections cancel. A capped mapping attempt with no match yields no certificate.

## Dyadic precision, caching and reproducibility

With $E$ edges, a position's birthday is at most $E$ since every move removes at least one edge. A noninteger dyadic of reduced denominator $2^k$ has birthday $1+\lfloor |x|\rfloor+k$. All numeric operations therefore fit on the integer lattice scaled by $2^E$, including addition of extremely small fractions to large whole components. An $e$-edge follower has grid spacing at least $2^{-\max(0,e-1)}$. If its certified interval contains only one grid point, its value is exact. Support-map bounds round outward when an artificial endpoint exceeds the working precision. Display decimals also round outward and preserve the original fractions for inspection.

The session pins the opening interval. Further facts intersect it, preserving strictness at equal endpoints. Valid sum and support changes propagate from child certificates. Position caches use BigInt masks and the rebased root, with the graph topology private to the session. The numeric value table defaults to 4,096 entries and is capped at 16,384. Much smaller shape and cancellation tables have separate caps, including an edge-count-dependent limit on stored drop arrays. Suspending a generator retains its current proof path. Eviction can cost work, while the opening's public sequence of bounds continues to narrow or stay equal. The worker keeps four sessions. The replay UI bounds its cache at three boards with 64 snapshots each and intersects retained certificates if a worker must restart.

Use `node --test tests/analyzer.test.mjs tests/analyzer-oracle.test.mjs` for direct checks. The oracle independently rediscovers grounded edges, enumerates options and finds the simplest rational by a different construction. Tests exercise intermediate bounds, both starting sides, short slices, cache eviction, equivalent pendants and full exact answers. Hardware affects wall-clock results. A fixed sequence of node allowances with unlimited benchmark time reproduces the search checkpoints. The comparison against the previous implementation and remaining unresolved positions are in [Validation results](VALIDATION_RESULTS.md).
