# Hackenbush

**[Play Hackenbush in your browser](https://sodium-qed.github.io/hackenbush/)**

Play **Green Hackenbush** or **Red–Blue Hackenbush** on a generated garden, draw your own board, or take on the daily puzzle. Each player has 10 seconds per turn to cut one eligible branch.

![A Hackenbush match in the browser](media/hackenbush-table.jpg)

## Start a match

1. Choose the rules. In Green, either player can cut any branch. In Red–Blue, Blue cuts blue branches and Red cuts red branches.
2. Before seeing the board, enter the human players’ names. On one device, choose a human or computer controller for each entrant. Each computer has its own difficulty. Easy picks a random legal branch, Standard looks for immediate wins and replies, and Expert uses the game's strongest search.
3. Select **Draw seats & reveal**. In Red–Blue, one random draw assigns the colors and an independent draw chooses who opens. In Green, only the opener is drawn.
4. The assignments and board appear together for a two-second opening look. Play then starts automatically with 10 seconds for the opener.

## Make a cut

Click or tap a branch. On a keyboard, tab to the board, use the arrow keys to select a branch, and press Enter or Space to cut it. A player who starts a turn with no eligible branch loses, even if other branches are standing. If the clock reaches zero, the active player loses even with a legal cut available. The clock keeps running in a background tab and while **How to play** is open.

## Play the Daily Challenge

Choose Easy, Standard or Expert, then select **Play challenge**. The garden grows from the local calendar date in the form `DAILY-MM-DD-YYYY`. Everyone who plays that date gets the same board and seats at every difficulty. Your starting seat has a forced win with perfect play. On some dates that means the computer opens.

Beat the computer to record a solve on this device at the selected difficulty. **Replay challenge** starts a fresh attempt on the same board. **Share puzzle** gives a friend that exact date to play, even after midnight. [Play today’s challenge](https://sodium-qed.github.io/hackenbush/?daily=today).

## Play a map by seed

A six-character code selects one of **16,777,216** Expert landscapes. The generator mixes all six digits before it grows the board. Changing one digit can replace a sheltered canopy with an open wetland, move the roots, and change which branches share a second path to the ground.

For comparison, [A35D7E](https://sodium-qed.github.io/hackenbush/?seed=A35D7E&v=5) opens a wildflower meadow and [A35D7F](https://sodium-qed.github.io/hackenbush/?seed=A35D7F&v=5) opens an alpine pass. Both the ground attachments and the network above them change.

Open **Map seed** before drawing seats. Leave it blank for a random six-digit hexadecimal code, or enter a word or phrase of up to 64 characters to generate a garden from the whole text. Words are case-sensitive. The substring `DAILY` in any letter case is reserved for the daily puzzle. The random deal visits each six-digit code once per cycle on the same browser. **Rematch** draws fresh seats on the same board. Use **Seed** under a revealed board to share its layout. Turn links also carry the generator version and the moves already played. Toggle **Scenery** beneath the board to switch between the illustrated landscape and plain paper.

## Build a board

Choose a ruleset and select **Build a board** in match setup. Connect dots to draw branches, choose their color in Red–Blue, and connect every branch to the ground line. Give the board a name and select **Use this board** to bring it to the table. A custom board works with local players, computer opponents, rematches, and turn links. **Share board** opens the starting layout for a fresh match.

## Review a finished match

Select **Analyze game** on the winner's card to revisit the opening or any cut. Green positions display a nimber. Red–Blue positions display a signed value or certified bounds when the exact value takes longer to compute. The analysis describes perfect play without the turn clock, including when a timeout ended the actual match.

## Practice, color, and sound

Try the sunflower in the untimed **Practice garden** before drawing seats. Open the edge of a petal to see its color peel away. Cut through its last support to see intact petals fall with the flower head. Red and blue ownership stays visible on the outlines. **How to play** lets you predict what falls from a single support, two supports or a petal loop, then play a three-branch endgame against the computer.

Open **Sound** in the top bar to preview a leaf snip, wood snap, glass ping, stone chip, cable twang, falling branches, or a match cue. Adjust the volume or turn on garden ambience. The settings are remembered on this device.

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
