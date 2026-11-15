# Hackenbush

**[Play Hackenbush in your browser](https://sodium-qed.github.io/hackenbush/)**

Play **Green Hackenbush** or **Red–Blue Hackenbush** on any of **16,777,216** seeded Expert maps. Each player has 10 seconds per turn to cut one eligible branch.

![A Hackenbush match in the browser](media/hackenbush-table.jpg)

## Start a match

1. Choose the rules. In Green, either player can cut any branch. In Red–Blue, Blue cuts blue branches and Red cuts red branches.
2. Before seeing the board, enter the human players’ names. On one device, choose a human or computer controller for each entrant. Computers can use their suggested nicknames.
3. Select **Draw seats & reveal**. In Red–Blue, one random draw assigns the colors and an independent draw chooses who opens. In Green, only the opener is drawn.
4. The assignments and board appear together for a two-second opening look. Play then starts automatically with 10 seconds for the opener.

## Make a cut

Click or tap a branch. On a keyboard, tab to the board, use the arrow keys to select a branch, and press Enter or Space to cut it. A player who starts a turn with no eligible branch loses, even if other branches are standing. If the clock reaches zero, the active player loses even with a legal cut available. The clock keeps running in a background tab and while **How to play** is open.

## Play a map by seed

Each of the six hexadecimal digits picks one playable landmark, in order from left to right. There are 16 choices in each slot, giving 16⁶ different ordered layouts. All six digits also shape the scenery and its framing. The 16 illustrated settings range from glacial fjords to moonlit estuaries.

Try the [wildflower meadow A35D7E](https://sodium-qed.github.io/hackenbush/?seed=A35D7E), then change the final digit to visit the [lily pond A35D7F](https://sodium-qed.github.io/hackenbush/?seed=A35D7F). The last landmark changes from a saguaro cactus to a sunflower. Cutting through a cactus arm and opening a flower loop have different consequences.

| Digit | Landmark | Digit | Landmark |
| --- | --- | --- | --- |
| 0 | Willow | 8 | Suspension bridge |
| 1 | Bamboo | 9 | Windmill |
| 2 | Fiddlehead fern | A | Glasshouse |
| 3 | Mangrove | B | Stone aqueduct |
| 4 | Waterwheel | C | Spiderweb |
| 5 | Water lily | D | Mushroom colony |
| 6 | Reed bed | E | Saguaro cactus |
| 7 | Coral fan | F | Sunflower |

Open **Map seed** during setup to enter a code, or leave it blank for a random map. **Rematch** deals new seats on the same map. During a match, select **Seed** beneath the board to share that layout with fresh players and clocks.

After a cut, every branch that loses its path to the ground falls. Trace both colors through loops and shared supports before cutting. Open **How to play** to try a support cut or open one side of a petal.

## Play on two devices

In **Turn links**, enter both players’ names and choose yours under **On this device** before the draw. If you draw the first turn, make the opening cut after your two-second look. If the other player opens, send the opening invitation. Their device gives them a fresh two-second look at the board and assignments before starting their clock.

After each cut, send the next link to your opponent. On later turns, the recipient’s 10 seconds start when they open the link. Time in transit is free. Each link carries the board, players, draw and move history. If your clock expires on your device, send the result link to share the timeout.

## Run locally

Serve the static files with Python 3 and open the local address.

```sh
python3 -m http.server 8000 --directory dist
```

Open <http://localhost:8000>. Run the game tests with Node.js 20 or later.

```sh
node --test tests/*.test.mjs
```

The game runs in the browser. Turn links work without accounts or a game server. The typefaces in `dist/fonts` include their Open Font Licenses.
