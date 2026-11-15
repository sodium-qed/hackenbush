"""Exercise rated matches and replay workers in Chromium. Requires Python Playwright."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
LEDGER = "groundwork.hackenbush.ratings"


class StaticFiles(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def ledger(page):
    return page.evaluate("(key) => JSON.parse(localStorage.getItem(key))", LEDGER)


def open_desk(page):
    page.locator("#rated-nav").click()
    expect(page.locator("#rated-dialog")).to_be_visible()


def run_browser_test(browser, url, capture):
    context = browser.new_context(viewport={"width": 1100, "height": 900}, reduced_motion="reduce")
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
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#play-daily")).to_be_visible()
    open_desk(page)
    page.locator('[data-pool="green"]').click()
    page.locator('[data-rated="level"]').select_option("easy")
    page.locator('[data-rated="start"]').click()
    expect(page.locator("#rated-receipt")).to_be_visible()
    expect(page.locator("#clock")).to_be_hidden()
    expect(page.locator("#undo")).to_be_hidden()
    active = ledger(page)["active"]
    assert active["seed"] == "48094F" and active["opening"]["information"] == "skill"
    assert active["seat"] == active["firstSide"]
    page.locator("#new-game").click()
    expect(page.locator("#map-seed")).to_be_attached()
    page.reload(wait_until="networkidle")
    open_desk(page)
    expect(page.locator('[data-rated="start"]')).to_have_text("Resume rated match")
    page.locator('[data-rated="start"]').click()
    expect(page.locator("#rated-match-rating")).to_be_visible()
    assert ledger(page)["active"]["id"] == active["id"]
    page.reload(wait_until="networkidle")
    expect(page.locator("#rated-receipt")).to_be_visible()

    # A second tab observing the same assignment must converge on one result.
    other = context.new_page()
    other.on("pageerror", lambda error: errors.append(str(error)))
    other.goto(url, wait_until="networkidle")
    open_desk(other)
    other.locator('[data-rated="start"]').click()
    expect(other.locator("#rated-receipt")).to_be_visible()
    for _ in range(23):
        page.wait_for_function("""() => !document.querySelector('#analyze-game').hidden ||
          document.querySelector('#board [data-edge-id][aria-disabled="false"]')""")
        if page.locator("#analyze-game").is_visible():
            break
        before = len(ledger(page)["active"]["game"]["moves"])
        page.locator('#board [data-edge-id][aria-disabled="false"]').first.press("Enter")
        page.wait_for_function("""([key, n]) => {
          const data = JSON.parse(localStorage.getItem(key));
          return !data.active || data.active.game.moves.length > n;
        }""", arg=[LEDGER, before])
    expect(page.locator("#analyze-game")).to_be_visible()
    expect(other.locator("#analyze-game")).to_be_visible()
    result = ledger(page)
    assert result["active"] is None and len(result["history"]) == 1
    assert result["pools"]["green"]["ratedGames"] == 1 and result["pools"]["redblue"]["games"] == 0
    assert result["history"][0]["delta"] != 0
    assert page.evaluate("localStorage.getItem('groundwork.hackenbush.match.v1')") is None
    other.close()

    page.locator("#match-ratings").click()
    expect(page.locator('[data-rated="graph"] svg')).to_be_visible()
    if capture:
        page.screenshot(path=str(capture / "rated-history.png"))
    page.get_by_role("button", name="Analyze Green match 48094F").click()
    expect(page.locator("#analyzer-dialog")).to_be_visible()
    page.wait_for_function("""() => document.querySelector('[data-analysis="value"]').textContent.includes('*') &&
      document.querySelector('[data-analysis="difficulty"]').textContent.includes('100')""")
    page.locator('[data-analysis="next"]').click()
    expect(page.locator('[data-analysis="position"]')).to_contain_text("move")
    page.get_by_label("Deep", exact=True).check(force=True)
    page.locator('[data-analysis="close"]').click()
    open_desk(page)
    page.locator('[data-pool="redblue"]').click()
    expect(page.locator('[data-rated="rating"]')).to_have_text("1000")
    page.locator('[data-rated="level"]').select_option("expert")
    page.locator('[data-rated="start"]').click()
    expect(page.locator("#rated-receipt")).to_be_visible()
    page.wait_for_function("(key) => JSON.parse(localStorage.getItem(key)).active?.variant === 'redblue'", arg=LEDGER)
    second = ledger(page)["active"]
    assert second["seed"] != active["seed"] and second["opening"]["information"] == "forced"
    assert second["expected"] == 0
    open_desk(page)
    page.locator('[data-rated="forfeit"]').click()
    page.locator('[data-rated="cancel"]').click()
    assert ledger(page)["active"]
    page.locator('[data-rated="forfeit"]').click()
    page.locator('[data-rated="accept"]').click()
    expect(page.locator('[data-rated="notice"]')).to_contain_text("Resignation recorded")
    assert ledger(page)["pools"]["redblue"]["losses"] == 1
    assert ledger(page)["history"][0]["delta"] == 0
    page.set_viewport_size({"width": 360, "height": 740})
    assert page.locator("#rated-dialog").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    if capture:
        page.screenshot(path=str(capture / "rated-mobile.png"))
    page.locator('[data-rated="reset"]').click()
    page.locator('[data-rated="accept"]').click()
    expect(page.locator('[data-rated="notice"]')).to_contain_text("reset")
    assert not ledger(page)["history"] and not ledger(page)["pools"]["green"]["games"]
    page.locator('[data-rated="close"]').click()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")

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
    page.set_viewport_size({"width": 1100, "height": 900})
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
    page.set_viewport_size({"width": 360, "height": 740})
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
    print("Passed rated play, persistence, two-tab settlement, replay workers, reset and mobile layout.")


if __name__ == "__main__":
    main()
