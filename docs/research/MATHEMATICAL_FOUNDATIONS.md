# Mathematics of the Groundwork analyzer

Groundwork uses finite, undirected, grounded multigraphs. A legal cut removes one edge of the mover’s color, or a green edge available to either player. All edges that have lost every path to ground fall in the same move. The player with no legal cut loses. The mathematical analysis uses normal play without a clock. A timed match can have a different winner.

## Ground and independent components

**Proposition.** Identifying all grounded vertices with a single root preserves the game. For any set of remaining edges, a path from an edge to any original ground vertex becomes a path to the new root. Conversely, stop a path to the merged root the first time it reaches the root. Its other vertices and edges lift to a path to an original ground vertex. Therefore each cut removes exactly the same edge IDs in both representations, including cuts to loops and parallel edges.

Branches that intersect only at ground are independent. A move in one branch cannot cut the other branch’s path to ground. The full game is their disjunctive sum. An articulation above ground has a different role. A cut below it may remove several branches at once. A pendant subgraph attached at a single vertex can be valued relative to that vertex, with the rules for its attachment respected.

## Green graphs

**Established theorem.** Every finite impartial normal-play position has a Sprague–Grundy value. Write $g(P)=\mathrm{mex}\{g(P') : P\to P'\}$, where mex is the least nonnegative integer absent from the set. The empty position has value zero. Independent positions add by bitwise XOR. A nonzero value gives the mover a winning cut to zero, and a zero value leaves a win for the second player. The integers here label Nim heaps. [Sprague, 1935](https://www.jstage.jst.go.jp/article/tmj1911/41/0/41_0_438/_article) · [Conway, *On Numbers and Games*, ch. 11](https://www.routledge.com/On-Numbers-and-Games/Conway/p/book/9780429062438)

**Established Green reductions.** The colon principle allows a Green subtree with value $g$ to be replaced above the same attachment by a stalk of length $g$. For a rooted tree, each child contributes $1+g(\text{child})$, and these contributions combine by XOR. The fusion principle permits the vertices of a circuit to be identified, retaining its edges as loops. Each loop contributes a unit twig at the fused vertex. Two parallel edges form a circuit of length two. [Berlekamp, Conway & Guy, *Winning Ways*, vol. 1, ch. 7, pp. 189–196](https://www.routledge.com/Winning-Ways-for-Your-Mathematical-Plays-Volume-1/Berlekamp/p/book/9781138427587) · [Ferguson, *Game Theory*, Part I, §6](https://www.cs.umb.edu/~eb/320/FergusonGames.pdf)

For example, fuse a triangle attached to ground by one additional bridge. Its three edges become three loops at the top of the bridge. Their XOR is $1\oplus1\oplus1=1$. The bridge gives the full position nimber $1+1=2$. Fusing a Red–Blue cycle by this rule would discard ownership information and has no corresponding justification.

Groundwork identifies bridges by a depth-first traversal that tracks the earliest ancestor reachable from each subtree. Contracting non-bridge components of an undirected graph gives a bridge tree. Each non-bridge edge contributes one loop in its contracted component, and each bridge contributes an ordinary $+1$ before combining siblings by XOR. The conceptual adjacency-list algorithm uses $O(|V|+|E|)$ graph visits. JavaScript’s variable-width bit masks, bit counts and array allocation also cost time.

## Finite Red–Blue values

**Established theorem.** Every finite Red–Blue Hackenbush graph is a number. Blue plays Left and Red plays Right in Groundwork. Every Blue move strictly decreases its value and every Red move strictly increases it. If the largest Blue option is $L$ and smallest Red option is $R$, the value is the simplest dyadic strictly between them. Missing options give unbounded ends. Simplicity means earliest birth in Conway’s construction. For example, $\{0\mid1\}=1/2$ and $\{1/2\mid2\}=1$. Independent components add as ordinary numbers. Blue wins from either starting seat when $V>0$, Red wins when $V<0$, and the second player wins when $V=0$. [Conway, *On Numbers and Games*, chs. 0, 7–8](https://www.routledge.com/On-Numbers-and-Games/Conway/p/book/9780429062438) · [Berlekamp, Conway & Guy, chs. 2–3, 7](https://www.routledge.com/Winning-Ways-for-Your-Mathematical-Plays-Volume-1/Berlekamp/p/book/9781138427587)

**Finite precision bound.** Every move consumes at least one live edge. A position with $m$ live edges has game-tree height at most $m$. The earliest birthday of its value is at most that height. A noninteger reduced dyadic $p/2^k$ has birthday $1+\lfloor |p/2^k|\rfloor+k$. Thus for $m>0$, every possible value is a multiple of $2^{-(m-1)}$. An integer is born on its absolute value’s day. A common working denominator $2^E$, where $E$ is the opening’s edge count, suffices for all actual followers. If a proved interval contains only one allowed grid point, that point is the exact answer. Merely rounding both displayed endpoints to the same decimal has no such force.

### Trees, stalks and bridges

Let $B(x)$ be the value after adding a single Blue supporting edge below a rooted Red–Blue game of value $x$. Define $R(x)$ for a Red support. If $x<0$, write $-x=m+r$, $m$ a nonnegative integer and $0\le r<1$. Then

$$
B(x)=
\begin{cases}
1+x & x\ge0,\\
2^{-m}(1-r/2) & x<0,
\end{cases}
\qquad R(x)=-B(-x).
$$

The upper game can be replaced by its canonical Red–Blue stalk by the colon principle with fixed lower attachment. Prepending a Blue edge to a Blue-starting stalk adds one to its integral part. Prepending Blue to $m$ Red edges gives $2^{-m}$. Between adjacent negative integers the binary subdivision in the stalk rule produces the linear interpolation displayed above. Color reversal negates a number and gives the Red formula. For a tree, sum the supported child values at each vertex from the leaves upward. This takes one recursive evaluation per edge with exact dyadic arithmetic. The integers used in that arithmetic grow with the graph. [Berlekamp’s original number-system report](https://www2.eecs.berkeley.edu/Pubs/TechRpts/1972/28721.html) · [*Winning Ways*, ch. 3, Berlekamp’s rule for strings](https://www.cs.cmu.edu/afs/cs/academic/class/15859-s05/www/lecture-notes/WinningWays3.pdf)

A Blue edge supporting two independent Red leaves is worth $B(-2)=1/4$. Attaching a separate Red twig at ground gives $-3/4$. Two Red leaves attached **directly to ground** instead contribute $-2$. The location of their support determines the available cascades.

**Substitution at one attachment.** A pendant forest attached to a core at a single vertex can be replaced there by a stalk of equal value. To see this, add the first full graph to the negative of the replacement graph. When the first player cuts inside a top, the second follows the zero-game strategy on the two tops. When the first cuts the core, the second mirrors the core cut. Detaching the attachment discards both tops at once. Every response therefore leaves corresponding cores and a zero sum of surviving tops. This proves equality even when the core is cyclic. The argument requires the top to have only the stated attachment to the core.

## What an interrupted search proves

For an unreduced position with both colors, $-r<V<b$, where $r,b$ count its live Red and Blue edges. Repeatedly cut Blue until none remain. Each cut strictly lowers $V$, and the surviving Red-only graph has value at least $-r$. Swapping the colors gives the upper bound. In a single-color connected component, the mover can always arrange to remove one edge at a time by cutting a cycle edge or outermost leaf. This gives exactly its signed edge count.

**Ground-reachability bounds, derived here.** Let $s_B$ and $s_R$ count edges connected to ground using only edges of their own color. After cutting only Blue until none remain, exactly the $s_R$ Red edges survive. Their all-Red paths survive each Blue cut, and every surviving Red edge must have such a path in the final position. The reverse argument for Red gives the strict enclosure $-s_R<V<s_B$ when both colors are present.

There is also a closed enclosure $s_B-r\le V\le b-s_R$. Blue can spend the $s_B$ secured edges one at a time, first removing cycle edges and then outermost leaves, preserving a Blue path for each unused secured edge. Red can make at most $r$ cuts. To compare $V$ with the integer $s_B-r$, adjoin a separate stalk of value $r-s_B$. Positive waiting moves belong to Blue, negative ones to Red. In either case Blue can answer at least as many times as Red can move. Blue therefore wins **second** in the comparison game, which proves $V+(r-s_B)\ge0$. Color reversal proves the other side. Intersecting the strict and closed enclosures can identify a winner, or even a number, without recursive search.

**Using all options.** Write $S(l,r)$ for the simplest number between valid ordered endpoints. It is nondecreasing if both endpoints increase. If the new simplest number were smaller, it would still be inside the original interval, while the original simplest number would lie inside the new interval. This would make each the unique simplest choice in an interval containing both, a contradiction. Once every option has been surveyed, lower approximations to both option extrema give a lower approximation to $V=S(L,R)$ whenever the approximating interval is valid. Upper approximations give an upper bound by the same argument. A partial survey can still certify strict bounds from individual moves.

* A Blue option with certified lower bound $a$ proves $V>a$. A Red option with certified upper bound $b$ proves $V<b$. These implications hold for successive same-color cuts even though a match alternates turns.
* Adding independent intervals gives an enclosure of their sum. A strictly increasing support map preserves a valid enclosure and strictness, with any finite-grid rounding directed outward. Intersecting two valid enclosures preserves both proofs.
* Color reversal gives $-V$. A verified rooted isomorphism to the color reversal proves $V=-V=0$. Two independently grounded, oppositely isomorphic components cancel. The bijection must preserve every edge multiplicity and loop. Matching graph statistics alone supplies no certificate.
* To test a dyadic threshold, Conway’s comparison says $G\ge q$ exactly when no Red option of $G$ is $\le q$ and no canonical Left option of $q$ is $\ge G$. Reversing the inequalities exchanges Left and Right. At a fixed node one counterexample settles a universal condition. A completed negative comparison proves a strict inequality because these positions are numbers.
* For a number, $V>0$ proves a Blue win from both seats. $V\ge0$ is already sufficient when Red opens. Thus a certified interval such as $(-1,0)$ proves Red wins while leaving the exact number open. A wall-clock or work cap by itself proves nothing about the value.

For an interwoven legacy three-color graph one can still certify a **winner** by following legal turns. A position is winning for the mover exactly when some child is losing for its mover. A failing or unfinished branch is kept unresolved until the necessary replies have been decided. If the colored and Green components are independent, any nonzero number dominates a finite nimber, and at numerical zero the nimber decides the outcome. General mixed graphs can have other kinds of game values. [Conway, chs. 7, 9, 11](https://www.routledge.com/On-Numbers-and-Games/Conway/p/book/9780429062438)

## Computational limits

**Published hardness.** Exact value computation for general finite normal-play Red–Blue graphs is NP-hard. The reduction from minimum Steiner tree already applies to redwood beds, a restricted class of cyclic graphs. The connected furniture in the construction has positive value $2^{-k}$. Its sign alone does not reveal the hard exponent. An NP-completeness claim requires a specific decision language and an upper bound for that language. [*Winning Ways*, ch. 7, “Redwood Furniture” and “Redwood Beds”](https://www.routledge.com/Winning-Ways-for-Your-Mathematical-Plays-Volume-1/Berlekamp/p/book/9781138427587) · [Demaine & Hearn, “Playing Games with Algorithms,” §4.10](https://library.slmath.org/books/Book56/files/10demaine.pdf)

**Consequence for a general winner oracle.** Suppose a subroutine decides the winner for Blue to move on any Red–Blue position, including ground sums. For a dyadic $q$, append an independent stalk of value $-q$ to $G$. Blue wins first if and only if $V(G)>q$. With $m$ edges the unknown $2^mV(G)$ is an integer in $[-m2^m,m2^m]$. Binary search on these integers needs $O(m+\log(m+1))$ winner queries. The trial stalks have $O(m+1)$ edges by the stalk encoding, since both their integer part and denominator exponent are $O(m)$. Consequently exact valuation reduces to this general winner problem under polynomial-time **Turing reductions**. This does not classify the specified-starter decision problem as NP-complete or PSPACE-complete.

For a direct winner search, depth-first recursion needs polynomial working space on explicit finite graphs. A path contains at most $m$ cuts, and its edge sets, move indices and connectivity data have polynomial size. The total search time can be exponential. There are at most $2^m$ subsets of the original edges, often many fewer after grounding. An unbounded subset table can consume exponential memory. The browser limits its stored entries, work and elapsed time. A data-dependent speedup on two knots says little about the worst case.

## Difficulty, probabilities and evidence

The [Cut Discrimination Index](DIFFICULTY_MODEL.md) is a new definition for a position **and the seat to move**. It combines the chance of losing a winning move under explicit reference move policies with a graph-structure term. Quantities such as legal cuts, immediately losing replies and certified winners are reproducible. Their proposed weighting is a modeling choice. Proof search effort is recorded separately. Human errors and response times would be needed to validate an interpretation as human difficulty.

The [rating model](RATING_MODEL.md) estimates performance against specific bot policies on the issued opening distribution. A conventional Elo-sized logistic win curve expresses relative strength on a chosen scale. Glicko-2 also tracks uncertainty and volatility. TrueSkill infers uncertain performance from observed results. Groundwork represents opening advantage on its local scale, keeps a skill uncertainty, and distinguishes positions won by perfect play from positions where every legal player continuation against the fixed bot policy has the same winner. Under untimed play the latter condition makes the result independent of the player’s choices. [Glickman, Glicko-2 specification](https://glicko.net/glicko/glicko2.pdf) · [Herbrich, Minka & Graepel, “TrueSkill”](https://papers.neurips.cc/paper_files/paper/2006/file/f44ee263952e65b3610b8ba51229d1f9-Paper.pdf)

The [validation results](VALIDATION_RESULTS.md) report finite experiments. The [open problems](OPEN_PROBLEMS.md) record remaining solver and empirical questions.
