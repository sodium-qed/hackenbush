# Hackenbush

**[Play Hackenbush in your browser](https://sodium-qed.github.io/hackenbush/)**

Play **Green Hackenbush** or **Red–Blue Hackenbush** on a randomly generated board. Take turns cutting one branch. If you start a turn with no legal cut, you lose, even if the other player still has branches.

![A Hackenbush match on a board with red, blue, and green branches](media/hackenbush-table.jpg)

## Start a match

1. Choose the board size and rules. In Green, either player can cut any branch. In Red–Blue, each player cuts their own color. Turn on shared green branches to play with all three colors.
2. Press **Reveal board** when both players are ready. Study the board for two seconds. It stays hidden while you assign seats.
3. Give each player a nickname and choose a human or computer for each seat. Player 1 moves first and Player 2 moves second. In a game with red and blue branches, choose which color Player 1 takes.

## Make a cut

Click or tap a branch. On a keyboard, tab to the board, use the arrow keys to select a branch, and press Enter or Space to cut it. Every branch that loses its path to the ground falls. A branch with another path stays, even when that path uses the other player's color.

Open **How to play** to try the same cut with one support and then two. Choose **Rematch** to preview the same board again and pick seats for another game.

## Play on two devices

Choose turn links and pick your seat. If you take Player 1, make the first cut and send the resulting link to Player 2. To go second, take Player 2 and send Player 1 the opening link. After each cut, send the new link back. Each link carries the board, both nicknames and roles, the turn order, and the move history. The final link shares the result.

## Run locally

Serve the static files with Python 3 and open the local address.

```sh
python3 -m http.server 8000 --directory dist
```

Open <http://localhost:8000>. Run the rules, generator, strategy, and turn-link checks with Node.js 20 or later.

```sh
node --test tests/*.test.mjs
```

The game runs in the browser. Turn links work without accounts or a game server. The typefaces in `dist/fonts` include their Open Font Licenses.
