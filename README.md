# Hackenbush

**[Play Hackenbush in your browser](https://sodium-qed.github.io/hackenbush/)**

Play **Green Hackenbush** or **Red–Blue Hackenbush** in a live ranked match, invite a friend to a private garden, or play locally against a bot. Every ranked turn gives the active player ten seconds to cut. You can also draw a board, solve the daily puzzle or practice a seed at your own pace.

## Play online

- **Ranked matchmaking** — Choose Green or Red–Blue and select **Find opponent**. The server pairs two waiting players in that ruleset. Each online rating starts at 1200. During play the server estimates the original garden’s seat advantage. A completed ranked result applies the same Elo award to both players with opposite signs.
- **Play a friend** — Select **Create room**. Your friend can type the six-character code or open the invitation and select **Join room**. Private matches leave both ratings intact.

Both players get a four-second opening look. The server checks each cut, drops unsupported branches and starts the next turn. Both screens update automatically. Reloading in the same browser reconnects to the game while the clock continues. That browser holds the key to your guest profile. Clearing its site data starts a new profile.

The public game and its multiplayer server also run together at [Groundwork Arena](https://groundwork-arena.bowenna2011.chatgpt.site/).

![The Groundwork lobby with ranked matchmaking and private rooms](media/hackenbush-table.jpg)

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

Select **Analyze game** on the winner's card to revisit the opening or any cut. Green positions display a nimber. Red–Blue positions display a signed dyadic value or certified bounds. The winner for the displayed player to move can be established before the exact value. **Quick**, **Deep** and **Research** use progressively larger search budgets. Select **Indefinite** in the analyzer to keep searching the selected position until the analysis finishes or you select **Stop search**. The analyzer remembers your selection. You can stop a search, inspect the certified endpoints, and see how much work it used. The structural difficulty estimate describes the available cuts and how easy they are to distinguish under two reference policies. The analysis assumes perfect play without a turn clock.

## Play a rated bot match

Open **Rated**, choose Green or Red–Blue and pick an opponent. Each ruleset starts you at **1200**. Nelson (1300) is the default. The named opponents run Hackenbush strategies, and their displayed Elo labels come from the corresponding Chess.com bots. Groundwork estimates your strength locally in each ruleset.

**Draw rated match** deals a full garden from the regular six-hex generator and assigns the seats. For example, `48094F` grows the same 123-branch Vine terraces in Rated and ordinary play. The bot selection changes the opponent's decisions. The seed and ruleset determine every branch, attachment and color. [Open the regular map](https://sodium-qed.github.io/hackenbush/?seed=48094F&v=5)

Rated bot matches give you a two-second opening look and ten seconds per cut. Returning to a match restores the current clock or shows the result if a clock expired. The generator uses fresh deals, and an unfinished game occupies the rated slot until it ends. If every possible sequence against that bot gives the same outcome, the result carries zero rating evidence. The opening assessment starts automatically alongside the clock. It keeps evaluating the original, uncut garden while you and the bot play. If the game ends before there is enough evidence to price the result, the receipt shows **Elo pending**. Returning to the game resumes unfinished work, and the rating history updates when the evidence is ready.

The result card shows your change. Open **Rated** to see the progression chart, uncertainty band, recent opponents and replays. **Practice a seed** lets you enter a six-hex code and face the selected bot. You can also open the same board and bot directly from a completed match. On Green `48094F` you open as Blue and have a winning move against Noam. [Try this unrated challenge](https://sodium-qed.github.io/hackenbush/?seed=48094F&v=5&rules=green&bot=noam)

Practicing leaves your rating intact. Earlier matches stay in your history on their original boards, with ratings translated to the new 1200 starting scale.

### Research and reproducibility

| Topic | Documentation |
|---|---|
| Nimber and number arithmetic, graph complexity | [Mathematical foundations](docs/research/MATHEMATICAL_FOUNDATIONS.md) |
| Certified search, worker budgets and cancellation | [Analyzer architecture](docs/research/ANALYZER_ARCHITECTURE.md) |
| Skill, opening advantage and uncertainty | [Rating model](docs/research/RATING_MODEL.md) |
| Named opponents, paired full-garden matches and the historical calibration | [Bot calibration](docs/research/BOT_CALIBRATION.md) |
| Strategic cut choices and controlled position experiments | [Difficulty model](docs/research/DIFFICULTY_MODEL.md) |
| Exact oracle and comparison with the previous analyzer | [Validation results](docs/research/VALIDATION_RESULTS.md) |
| Limits of the measurements and open questions | [Open problems](docs/research/OPEN_PROBLEMS.md) |

## Practice, color, and sound

Try the sunflower in the untimed **Practice garden** before drawing seats. Open the edge of a petal to see its color peel away. Cut through its last support to see intact petals fall with the flower head. Red and blue ownership stays visible on the outlines. **How to play** lets you predict what falls from a single support, two supports or a petal loop, then play a three-branch endgame against the computer.

Open **Sound** in the top bar to preview a leaf snip, wood snap, glass ping, stone chip, cable twang, falling branches, or a match cue. Adjust the volume or turn on garden ambience. The settings are remembered on this device.

## Play asynchronously with turn links

For correspondence play, open **Turn links**, enter both players’ names and choose yours under **On this device** before the draw. If you draw the first turn, make the opening cut after your two-second look. If the other player opens, send the opening invitation. Their device gives them a fresh two-second look at the board and assignments before starting their clock.

After each cut, send the next link to your opponent. On later turns, the recipient’s 10 seconds start when they open the link. Time in transit is free. Each link carries the board, players, draw and move history. If your clock expires on your device, send the result link to share the timeout.

## Run locally

Use Node.js 22.13 or later. Start the game and its multiplayer API together from this checkout.

```sh
npm ci
npm start
```

Open <http://localhost:5173>. Two different browser profiles can play together. For two devices on a local network, start with `npm start -- --host 0.0.0.0` and open the host computer’s LAN address on both devices. Matches and ratings are stored in `.local/arena.sqlite`. Set `ARENA_DB` to use another database file.

```sh
npm test
npm run build
```

The build produces a self-contained Worker in `dist/server/index.js`. The Worker serves both the game and `/api/`, using a D1 binding named `DB` and the SQL migrations in `drizzle/`. The tracked public files in `dist/` also run on GitHub Pages. The Pages client connects to the multiplayer origin declared in `dist/index.html`.

Reproduce the analyzer benchmark, structural study and calibrated ladder from the repository root.

```sh
node scripts/benchmark-analyzer.mjs
node scripts/difficulty-study.mjs
node scripts/calibration.mjs --check
node scripts/validate-ratings.mjs
node scripts/full-garden-study.mjs
```

With Python Playwright and Chromium installed, `python3 scripts/smoke-browser.py` also plays a full rated game through the interface, opens the same game in two tabs, checks the rating chart and exercises the replay workers.

Local play and correspondence links work on a static host. Live rooms and the ranked queue use the multiplayer server. The typefaces in `dist/fonts` include their Open Font Licenses.
