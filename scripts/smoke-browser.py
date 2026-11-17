"""Exercise rated matches and replay workers in Chromium. Requires Python Playwright."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
LEDGER = "groundwork.hackenbush.ratings"
CASUAL_MATCH = "groundwork.hackenbush.match.v1"
DESKTOP = {"width": 1100, "height": 900}
MOBILE = {"width": 360, "height": 740}
BOTS = {
    "martin": ("Martin", 250), "aron": ("Aron", 700), "emir": ("Emir", 1000),
    "nelson": ("Nelson", 1300), "isabel": ("Isabel", 1600), "wally": ("Wally", 1800),
    "li": ("Li", 2000), "noam": ("Noam", 2200),
}


class StaticFiles(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def ledger(page):
    return page.evaluate("(key) => JSON.parse(localStorage.getItem(key))", LEDGER)


def open_desk(page):
    page.locator("#rated-nav").click()
    expect(page.locator("#rated-dialog")).to_be_visible()


def check_roster(page):
    chooser = page.locator('[data-rated="level"]')
    options = chooser.locator("option").evaluate_all("rows => rows.map(row => row.value)")
    assert len(options) == len(BOTS) and set(options) == set(BOTS), options
    for key, (name, rating) in BOTS.items():
        chooser.select_option(key)
        option = chooser.locator("option:checked").inner_text()
        assert name in option and str(rating) in option.replace(",", "") and "Elo" in option, option
        source = page.locator('[data-rated="bot-source"]').get_attribute("href")
        assert urlsplit(source).hostname == "www.chess.com" and name.lower() in urlsplit(source).path.lower(), source


def rendered_branches(page):
    edges = page.locator("#board [data-edge-id]")
    expect(edges.first.locator(".hb-field__stem[d]")).to_be_attached()
    # The field fits its SVG projection to the available space after layout.
    page.evaluate("() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))")
    return edges.evaluate_all("""rows => rows.map(row => [
      row.dataset.edgeId, [...row.classList].find(name => name.startsWith('hb-field--')).slice(10),
      row.querySelector('.hb-field__stem').getAttribute('d')
    ])""")


def shared_seed_url(page, active):
    expect(page.locator("#map-code")).to_have_text(active["seed"])
    page.locator("#share-map").click()
    expect(page.locator("#share-dialog")).to_be_visible()
    url = page.locator("#share-url").input_value()
    parts = urlsplit(url)
    assert not parts.fragment and parts.netloc == urlsplit(page.url).netloc, url
    assert parse_qs(parts.query) == {
        "seed": [active["seed"]], "v": ["5"], "rules": [active["variant"]], "bot": [active["level"]],
    }, url
    page.locator("#share-dialog [data-close]").click()
    return url


def check_practice(page, assigned, branches, rated_record, play=False):
    label = page.locator("#daily-match-label")
    expect(label).to_contain_text("Unrated practice")
    expect(label).to_contain_text(BOTS[assigned["level"]][0])
    expect(page.locator("#clock")).to_be_hidden()
    expect(page.locator("#rated-receipt")).to_be_hidden()
    assert rendered_branches(page) == branches, "Practice did not reproduce the rated map"
    saved = page.evaluate("key => JSON.parse(localStorage.getItem(key))", CASUAL_MATCH)
    for field in ("seed", "variant", "seat", "firstSide", "boardVersion"):
        assert saved[field] == assigned[field], (field, saved[field], assigned[field])
    opponent = next(seat for seat in saved["players"].values() if seat["kind"] == "computer")
    assert opponent["level"] == assigned["level"] and not saved["timed"]
    assert saved["matchId"] != assigned["id"]
    if play:
        cut = page.locator('#board [data-edge-id][aria-disabled="false"]').first
        expect(cut).to_be_visible()
        edge = cut.get_attribute("data-edge-id")
        cut.press("Enter")
        page.wait_for_function("([key, id]) => JSON.parse(localStorage.getItem(key)).moves.includes(id)",
                               arg=[CASUAL_MATCH, edge])
        page.reload(wait_until="networkidle")
        expect(label).to_contain_text("Unrated practice")
        expect(page.locator(f'#board [data-edge-id="{edge}"]')).to_be_hidden()
    assert ledger(page) == rated_record, "Practice changed the rated record"


def play_ordinary_seed(page, seed, variant, branches):
    page.locator("#new-game").click()
    page.locator("#variant-" + variant).click()
    field = page.locator("#map-seed")
    if not field.is_visible():
        page.locator("#seed-entry summary").click()
    field.fill(seed)
    before = ledger(page)
    for letter, name in [("A", "Fern"), ("B", "Cedar")]:
        page.locator(f'[name="entrant{letter}Kind"]').select_option("human")
        page.locator(f'[name="entrant{letter}Name"]').fill(name)
    page.locator("#players-view button[type=submit]").click()
    expect(page.locator("#field")).to_be_visible()
    normal = rendered_branches(page)
    assert normal == branches, f"{variant} map {seed}: rated and ordinary branch IDs, colors or SVG paths differ"
    expect(page.locator("#rated-receipt")).to_be_hidden()
    expect(page.locator("#clock")).to_be_visible()
    page.locator('#board [data-edge-id][aria-disabled="false"]').first.press("Enter")
    expect(page.locator("#history-count")).to_have_text("1")
    saved = page.evaluate("key => JSON.parse(localStorage.getItem(key))", CASUAL_MATCH)
    assert saved["seed"] == seed and saved["boardVersion"] == 5 and saved["variant"] == variant
    assert saved["timed"] and len(saved["moves"]) == 1
    assert ledger(page) == before, "Ordinary play changed the rated record"


def check_shared_and_ordinary(page, url, assigned, branches, record):
    page.goto(url, wait_until="networkidle")
    check_practice(page, assigned, branches, record, play=True)
    play_ordinary_seed(page, assigned["seed"], assigned["variant"], branches)


def resume(page):
    open_desk(page)
    start = page.locator('[data-rated="start"]')
    expect(start).to_have_text("Resume rated match")
    start.click()
    expect(page.locator("#rated-receipt")).to_be_visible()


def check_assignment(page, variant, bot):
    expect(page.locator("#rated-receipt")).to_be_visible(timeout=35_000)
    expect(page.locator("#clock")).to_be_visible()
    expect(page.locator("#clock-value")).to_have_text("10")
    expect(page.locator("#undo")).to_be_hidden()
    active = ledger(page)["active"]
    assert active["variant"] == variant and active["level"] == bot
    assert active["boardVersion"] == 5 and active["difficulty"] == "expert"
    assert active["game"]["boardVersion"] == 5 and active["game"]["timed"]
    assert active["game"]["deadline"] == active["startedAt"] + 12_000
    name, rating = BOTS[bot]
    expect(page.locator("#rated-match-rating")).to_have_text(f"{name} ({rating} Elo)")
    branches = rendered_branches(page)
    assert len(branches) == active["opening"]["edges"] and len(branches) > 100
    assert {row[1] for row in branches} == ({"green"} if variant == "green" else {"red", "blue"})
    return active, branches, shared_seed_url(page, active)


def play_green_to_end(page, opening_size):
    for _ in range(opening_size + 1):
        page.wait_for_function("""() => !document.querySelector('#analyze-game').hidden ||
          !document.querySelector('#rated-retry').hidden ||
          document.querySelector('#board [data-edge-id][aria-disabled="false"]')""")
        if page.locator("#analyze-game").is_visible():
            return
        assert page.locator("#rated-retry").is_hidden(), page.locator("#board-feedback").inner_text()
        before = len(ledger(page)["active"]["game"]["moves"])
        page.locator('#board [data-edge-id][aria-disabled="false"]').first.press("Enter")
        page.wait_for_function("""([key, n]) => {
          const data = JSON.parse(localStorage.getItem(key));
          return !data.active || data.active.game.moves.length > n;
        }""", arg=[LEDGER, before])
    raise AssertionError("The game exceeded its opening number of branches")


def run_browser_test(browser, url, capture):
    context = browser.new_context(viewport=DESKTOP, reduced_motion="reduce")
    # Fix only initial deal-stream entropy. IDs still use the browser's real RNG.
    context.add_init_script("""
      const randomValues = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = values => {
        if (values instanceof Uint32Array && values.length === 2) {
          values.set([1, 1]); return values;
        }
        return randomValues(values);
      };
    """)
    errors = []
    context.on("page", lambda tab: tab.on("pageerror", lambda error: errors.append(str(error))))
    page = context.new_page()
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#play-daily")).to_be_visible()
    open_desk(page)
    expect(page.locator('[data-rated="rating"]')).to_have_text("1200")
    page.locator('[data-pool="green"]').click()
    expect(page.locator('[data-rated="rating"]')).to_have_text("1200")
    check_roster(page)
    page.locator('[data-rated="level"]').select_option("martin")
    page.locator('[data-rated="start"]').click()
    active, green_branches, green_url = check_assignment(page, "green", "martin")
    assert active["seed"] == "48094F" and active["opening"]["information"] == "skill"
    assert active["seat"] == active["firstSide"]
    if capture:
        page.screenshot(path=str(capture / "rated-garden.png"))
    page.locator('#board [data-edge-id="e100"]').press("Enter")
    page.wait_for_function("key => JSON.parse(localStorage.getItem(key)).active.game.moves[0] === 'e100'", arg=LEDGER)
    page.locator("#new-game").click()
    expect(page.locator("#map-seed")).to_be_attached()
    page.reload(wait_until="networkidle")
    resume(page)
    expect(page.locator("#rated-match-rating")).to_be_visible()
    assert ledger(page)["active"]["id"] == active["id"]
    page.reload(wait_until="networkidle")
    expect(page.locator("#rated-receipt")).to_be_visible()
    expect(page.locator('#board [data-edge-id="e100"]')).to_be_hidden()

    # A second tab observing the same assignment must converge on one result.
    other = context.new_page()
    other.goto(url, wait_until="networkidle")
    resume(other)
    play_green_to_end(page, len(green_branches))
    expect(page.locator("#analyze-game")).to_be_visible()
    expect(other.locator("#analyze-game")).to_be_visible()
    result = ledger(page)
    assert result["active"] is None and len(result["history"]) == 1
    assert result["pools"]["green"]["ratedGames"] == 1 and result["pools"]["redblue"]["games"] == 0
    green = result["history"][0]
    assert green["id"] == active["id"] and green["before"] == 1200
    assert green["after"] == result["pools"]["green"]["rating"]
    assert (1 if green["won"] else -1) * green["delta"] > 0
    assert green["game"]["moves"][0] == "e100" and len(green["game"]["moves"]) > 22
    assert page.evaluate("key => localStorage.getItem(key)", CASUAL_MATCH) is None
    # Follow the share link in a tab that had the rated result open. Reloading
    # after a practice cut must restore practice instead of the prior rated view.
    check_shared_and_ordinary(other, green_url, active, green_branches, result)
    other.close()
    page.reload(wait_until="networkidle")
    page.locator("#match-ratings").click()
    expect(page.locator('[data-rated="graph"] svg')).to_be_visible()
    expect(page.locator('[data-rated="history"] summary')).to_contain_text("Martin (250 Elo)")
    if capture:
        page.screenshot(path=str(capture / "rated-history.png"))
    page.get_by_role("button", name="Analyze Green match " + active["seed"]).click()
    expect(page.locator("#analyzer-dialog")).to_be_visible()
    page.wait_for_function("""() => document.querySelector('[data-analysis="value"]').textContent.includes('*') &&
      document.querySelector('[data-analysis="difficulty"]').textContent.includes('100')""")
    page.locator('[data-analysis="next"]').click()
    expect(page.locator('[data-analysis="position"]')).to_contain_text("move")
    page.get_by_label("Replay position").press("End")
    expect(page.locator('[data-analysis="value"]')).to_have_text("*0")
    page.get_by_label("Deep", exact=True).check(force=True)
    page.locator('[data-analysis="close"]').click()
    page.locator("#rated-practice").click()
    check_practice(page, active, green_branches, result)
    open_desk(page)
    page.locator('[data-pool="redblue"]').click()
    expect(page.locator('[data-rated="rating"]')).to_have_text("1200")
    page.locator('[data-rated="level"]').select_option("nelson")
    page.locator('[data-rated="start"]').click()
    second, colored_branches, colored_url = check_assignment(page, "redblue", "nelson")
    assert second["seed"] != active["seed"]
    # The fixture gives the bot the opener, exercising Nelson's live worker.
    page.wait_for_function("key => JSON.parse(localStorage.getItem(key)).active.game.moves.length > 0", arg=LEDGER)
    expect(page.locator('#board [data-edge-id][aria-disabled="false"]').first).to_be_visible()
    open_desk(page)
    page.locator('[data-rated="forfeit"]').click()
    page.locator('[data-rated="cancel"]').click()
    assert ledger(page)["active"]
    page.locator('[data-rated="forfeit"]').click()
    page.locator('[data-rated="accept"]').click()
    expect(page.locator('[data-rated="notice"]')).to_contain_text("Resignation recorded")
    settled = ledger(page)
    assert settled["active"] is None and len(settled["history"]) == 2
    redblue = settled["history"][0]
    assert redblue["reason"] == "forfeit" and redblue["id"] == second["id"]
    assert redblue["rated"] and redblue["before"] == 1200 and redblue["delta"] < 0
    assert settled["pools"]["redblue"]["losses"] == 1 and settled["pools"]["green"] == result["pools"]["green"]
    reference = context.new_page()
    check_shared_and_ordinary(reference, colored_url, second, colored_branches, settled)
    reference.close()
    expect(page.locator('[data-rated="history"] summary')).to_contain_text("Nelson (1300 Elo)")
    page.locator(f'[data-rated-practice="{second["seed"]}"]').click()
    check_practice(page, second, colored_branches, settled)
    open_desk(page)
    page.locator('[data-pool="redblue"]').click()
    page.set_viewport_size(MOBILE)
    assert page.locator("#rated-dialog").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    if capture:
        page.screenshot(path=str(capture / "rated-mobile.png"))
    page.locator('[data-rated="practice-seed"] summary').click()
    page.locator('[data-rated="level"]').select_option(second["level"])
    page.locator("#rated-seed").fill("oops")
    page.locator('[data-rated="practice-start"]').click()
    expect(page.locator("#rated-dialog")).to_be_visible()
    page.locator("#rated-seed").fill(second["seed"].lower())
    page.locator('[data-rated="practice-start"]').click()
    expect(page.locator("#daily-match-label")).to_contain_text("Unrated practice")
    expect(page.locator("#map-code")).to_have_text(second["seed"])
    assert ledger(page) == settled
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    if capture:
        page.screenshot(path=str(capture / "practice-mobile.png"))
    open_desk(page)
    page.locator('[data-rated="reset"]').click()
    page.locator('[data-rated="accept"]').click()
    expect(page.locator('[data-rated="notice"]')).to_contain_text("reset")
    assert not ledger(page)["history"] and not ledger(page)["pools"]["green"]["games"]
    expect(page.locator('[data-rated="rating"]')).to_have_text("1200")
    page.locator('[data-rated="close"]').click()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")

    # Read the actual clock across reload and let an untouched turn expire.
    open_desk(page)
    page.locator('[data-pool="green"]').click()
    page.locator('[data-rated="level"]').select_option("martin")
    page.locator('[data-rated="start"]').click()
    expect(page.locator("#rated-receipt")).to_be_visible(timeout=35_000)
    opening = ledger(page)["active"]
    assert opening["firstSide"] == opening["seat"]
    expect(page.locator("#clock-value")).to_have_text("9", timeout=6000)
    page.reload(wait_until="networkidle")
    assert ledger(page)["active"]["game"]["deadline"] == opening["game"]["deadline"]
    expect(page.locator("#turn-action")).to_have_text("You ran out of time.", timeout=11_000)
    result = ledger(page)
    assert result["active"] is None and len(result["history"]) == 1
    assert result["history"][0]["reason"] == "timeout" and result["pools"]["green"]["losses"] == 1
    page.reload(wait_until="networkidle")
    assert ledger(page) == result

    check_analysis_controls(page, capture)
    assert not errors, errors
    context.close()


def check_analysis_controls(page, capture):
    # A large cyclic opening and an independently priced terminal position
    # come from the same ordinary, restorable match.
    final_value = page.evaluate("""async () => {
      const {createGame, startTurnClock, playCut, saveData} = await import('./js/session.js');
      const {legalMoves} = await import('./js/rules.js');
      let game = createGame({boardVersion: 5, seed: 'A35D7E', variant: 'redblue'});
      let now = 1000;
      while (!game.victor) {
        const id = legalMoves(game.board, game.live, game.side)[0];
        game = playCut(startTurnClock(game, now), id, ++now);
      }
      localStorage.setItem('groundwork.hackenbush.match.v1', JSON.stringify(saveData(game)));
      sessionStorage.clear();
      return String(game.live.length * (game.victor === 'blue' ? 1 : -1));
    }""")
    page.set_viewport_size(DESKTOP)
    page.reload(wait_until="networkidle")
    # Deliver a queued response on the real worker port after the UI cancels.
    # This makes rejection of stale request IDs independent of CPU speed.
    page.evaluate("""() => {
      const send = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function(message, ...rest) {
        if (message.type === 'start' && message.positions) {
          window.deliverLastSlice = () => this.dispatchEvent(new MessageEvent('message', {data: {
            id: message.id, index: message.positions[0].index, type: 'update', phase: 'finished', reason: 'exact',
            result: {kind: 'green', exact: true, nimber: 3, winner: 'red', nodes: 27, durationMs: 1}
          }}));
        }
        return send.call(this, message, ...rest);
      };
    }""")
    page.locator("#analyze-game").click()
    progress = page.locator('[data-analysis="progress"]')
    value = page.locator('[data-analysis="value"]')
    effort = page.locator('[data-analysis="effort"]')
    stop = page.locator('[data-analysis="stop"]')
    slider = page.get_by_label("Replay position")
    expect(progress).to_contain_text("limit reached")
    if capture:
        page.screenshot(path=str(capture / "analyzer-desktop.png"))

    # Arrow keys select a search depth without also moving the replay.
    page.get_by_label("Quick", exact=True).press("ArrowRight")
    expect(page.get_by_label("Deep", exact=True)).to_be_checked()
    page.get_by_label("Deep", exact=True).press("ArrowRight")
    expect(page.get_by_label("Research", exact=True)).to_be_checked()
    expect(page.locator('[data-analysis="position"]')).to_have_text("Opening position")
    expect(progress).to_contain_text("Searching")
    stop.click()
    expect(progress).to_contain_text("Stopped")
    held = (value.inner_text(), effort.inner_text())
    page.evaluate("window.deliverLastSlice()")
    # Cover multiple slices, including the cancellation watchdog window.
    page.wait_for_timeout(350)
    assert (value.inner_text(), effort.inner_text()) == held
    expect(stop).to_have_text("Resume search")
    stop.click()
    expect(progress).to_contain_text("Searching")
    slider.press("End")
    expect(page.locator('[data-analysis="position"]')).to_have_text("Final position")
    expect(value).to_have_text(final_value)
    expect(progress).to_contain_text("Exact value certified")
    expect(stop).to_be_disabled()

    page.get_by_label("Quick", exact=True).check(force=True)
    slider.press("Home")
    expect(progress).to_contain_text("retained")
    stored = effort.inner_text()
    page.locator('[data-analysis="close"]').click()
    page.locator("#analyze-game").click()
    expect(progress).to_contain_text("retained")
    expect(effort).to_have_text(stored)
    page.set_viewport_size(MOBILE)
    assert page.locator("#analyzer-dialog").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    if capture:
        page.screenshot(path=str(capture / "analyzer-mobile.png"))

    page.add_init_script('Object.defineProperty(window, "Worker", {value: undefined})')
    page.reload(wait_until="networkidle")
    page.locator("#analyze-game").click()
    expect(progress).to_contain_text("unavailable")
    expect(value).to_contain_text("≤")
    expect(stop).to_be_disabled()
    slider.press("End")
    expect(value).to_have_text(final_value)
    expect(progress).to_contain_text("unavailable")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium", help="Use this Chromium executable instead of Playwright's installation.")
    parser.add_argument("--single-process", action="store_true", help="Run in Chromium's headless single-process mode.")
    parser.add_argument("--capture", type=Path, help="Optional directory for desktop and mobile screenshots.")
    args = parser.parse_args()
    if args.capture:
        args.capture.mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(StaticFiles, directory=ROOT / "dist")) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=args.chromium, headless=True,
                    args=["--single-process", "--no-zygote"] if args.single_process else [])
                try:
                    run_browser_test(browser, f"http://127.0.0.1:{server.server_port}/", args.capture)
                finally:
                    browser.close()
        finally:
            server.shutdown()
    print("Passed named bots, both 1200 rating pools, full rated/ordinary/practice maps, "
          "high-edge cuts, two-tab settlement, replay workers, shared links, reload and mobile layout.")


if __name__ == "__main__":
    main()
