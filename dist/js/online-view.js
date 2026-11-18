function icon(name, className = 'icon') {
  return '<svg class="' + className + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
}

function playerCard(who, title) {
  return `<div class="ol-seat" data-online="${who}-seat">
    <span class="ol-seat-mark" aria-hidden="true"></span>
    <div><span class="ol-seat-label">${title}<span data-online="${who}-side"></span></span>
      <strong dir="auto" data-online="${who}-name"></strong></div>
    <span class="ol-seat-rating" data-online="${who}-rating"></span>
  </div>`;
}

export function mountOnlineDialog(dialog) {
  dialog.innerHTML = `
    <header class="ol-header">
      <div class="ol-heading"><span class="ol-heading-mark">${icon('branch')}</span>
        <h2 id="online-title" tabindex="-1" autofocus>Online play</h2></div>
      <div class="ol-header-actions"><span class="ol-connection" data-online="connection" role="status"></span>
        <button class="ol-close" type="button" data-online="close" aria-label="Close online play" title="Close online play">${icon('close')}</button></div>
    </header>
    <div class="ol-scroll">
      <div class="ol-notice" data-online="notice-box" hidden>
        <p role="status" aria-live="polite" data-online="notice"></p>
        <button type="button" class="ol-link-button" data-online="retry" hidden>Retry connection</button>
      </div>
      <div data-online="lobby">
        <nav class="ol-modes" aria-label="Online play mode" data-online="modes">
          <button type="button" data-mode="ranked" aria-pressed="true">${icon('trophy')} Ranked</button>
          <button type="button" data-mode="rooms" aria-pressed="false">${icon('people')} Private rooms</button>
        </nav>
        <div class="ol-lobby-grid">
          <div class="ol-main">
            <section data-online="setup" aria-labelledby="online-setup-title">
              <h3 id="online-setup-title" class="ol-title"></h3>
              <p class="ol-intro" data-online="intro"></p>
              <fieldset class="ol-variants" data-online="variant-picker">
                <legend>Ruleset</legend>
                <div class="ol-variant-options">
                  <button type="button" data-variant="redblue" aria-pressed="true">
                    ${icon('rule-redblue', 'ol-rule-icon')}<span><strong>Red–Blue</strong><small>Cut your color</small></span>
                    <i class="ol-choice" aria-hidden="true"></i></button>
                  <button type="button" data-variant="green" aria-pressed="false">
                    ${icon('rule-green', 'ol-rule-icon')}<span><strong>Green</strong><small>Cut any branch</small></span>
                    <i class="ol-choice" aria-hidden="true"></i></button>
                </div>
              </fieldset>
              <div data-online="ranked-controls">
                <button class="ol-primary ol-wide" data-online="find" type="button">Find opponent ${icon('arrow')}</button>
              </div>
              <div data-online="room-controls" hidden>
                <button class="ol-primary ol-wide" data-online="create" type="button">Create room ${icon('arrow')}</button>
                <form class="ol-join" data-online="join-form">
                  <label for="online-room-code">Join with a code</label>
                  <div class="ol-input-row"><input id="online-room-code" data-online="code" type="text"
                    placeholder="Room code" autocapitalize="characters" autocomplete="off" spellcheck="false" required
                    enterkeyhint="go" aria-describedby="online-code-error">
                    <button class="ol-secondary" type="submit" data-online="join">Join room ${icon('arrow')}</button></div>
                  <p class="ol-input-error" id="online-code-error" data-online="code-error" hidden></p>
                </form>
                <button class="ol-link-button" type="button" data-online="create-instead" hidden>Create a new room instead</button>
              </div>
            </section>
            <section class="ol-wait" data-online="queue" hidden aria-labelledby="online-search-title">
              <div class="ol-wait-mark" aria-hidden="true">${icon('people')}</div>
              <h3 class="ol-title" id="online-search-title">Finding an opponent</h3>
              <p class="ol-intro" data-online="queue-info"></p>
              <div class="ol-ticket"><span><i class="ol-pulse" aria-hidden="true"></i> In the queue</span>
                <output data-online="queue-clock" aria-label="Time in queue" aria-live="off">0:00</output></div>
              <button type="button" class="ol-secondary" data-online="cancel-queue">Cancel search</button>
            </section>
            <section class="ol-wait" data-online="room" hidden aria-labelledby="online-room-title">
              <h3 class="ol-title" id="online-room-title">Invite a friend</h3>
              <p class="ol-intro" data-online="room-info"></p>
              <div class="ol-room-ticket"><span class="ol-label">Room code</span>
                <strong data-online="room-code"></strong><span><i class="ol-pulse" aria-hidden="true"></i> Waiting for a guest</span></div>
              <label class="ol-label" for="online-invite">Invitation link</label>
              <div class="ol-input-row"><input id="online-invite" type="text" readonly data-online="invite">
                <button type="button" class="ol-secondary" data-online="copy">${icon('copy')} Copy link</button></div>
              <p class="ol-copy-note" data-online="copy-note" role="status"></p>
              <button type="button" class="ol-link-button" data-online="cancel-room">Cancel room</button>
            </section>
          </div>
          <aside class="ol-profile" aria-labelledby="online-profile-title">
            <div class="ol-profile-head">
              <span class="ol-label" id="online-profile-title">Player profile</span>
              <div class="ol-profile-name"><strong dir="auto" data-online="display-name">Guest</strong>
                <button type="button" data-online="edit" class="ol-edit" aria-label="Edit display name" title="Edit display name">${icon('draw')}</button></div>
              <form class="ol-edit-form" data-online="edit-form" hidden>
                <label for="online-name">Display name</label>
                <div class="ol-input-row"><input id="online-name" data-online="name" autocomplete="nickname" type="text" dir="auto" required>
                  <button class="ol-secondary" data-online="save-name" type="submit">Save</button></div>
                <button type="button" class="ol-link-button" data-online="cancel-name">Cancel</button>
              </form>
            </div>
            <div class="ol-profile-ratings"><h3>Human Elo</h3>
              <dl><div><dt><span class="ol-pool-mark ol-pool-rb" aria-hidden="true"></span>Red–Blue</dt><dd data-online="elo-redblue">—</dd></div>
                  <div><dt><span class="ol-pool-mark ol-pool-green" aria-hidden="true"></span>Green</dt><dd data-online="elo-green">—</dd></div></dl>
              <p>Earn Elo in ranked matches against other players.</p>
            </div>
          </aside>
        </div>
        <footer class="ol-lobby-foot">
          <span>${icon('time')} 10 seconds per turn</span><span>${icon('eye')} 4-second opening look</span>
        </footer>
      </div>
      <section class="ol-game" data-online="game" hidden aria-label="Live match">
        <div class="ol-scoreboard">
          ${playerCard('home', 'You')}<span class="ol-versus" aria-hidden="true">vs.</span>${playerCard('away', 'Opponent')}
        </div>
        <div class="ol-turn" data-online="turn-panel">
          <div><strong data-online="turn" role="status" aria-live="polite"></strong><p data-online="turn-help"></p></div>
          <div class="ol-timing" role="timer" aria-live="off" aria-label="Seconds remaining">${icon('time')}
            <strong data-online="clock"></strong><span>s</span></div>
          <div aria-hidden="true" class="ol-time-track"><i data-online="time-bar"></i></div>
        </div>
        <div class="ol-result" data-online="result" hidden>
          <span class="ol-result-mark">${icon('trophy')}</span>
          <div><h3 data-online="result-title" role="status" tabindex="-1"></h3><p data-online="result-reason"></p><strong data-online="result-rating"></strong></div>
          <button type="button" class="ol-secondary" data-online="analyze">Analyze game</button>
          <button type="button" class="ol-primary" data-online="done">Back to lobby ${icon('arrow')}</button>
        </div>
        <div class="ol-field">
          <div class="ol-field-head"><span class="ol-field-name">${icon('field')}<strong data-online="garden"></strong></span>
            <span data-online="branches"></span></div>
          <div class="board-scroll ol-board-scroll" data-online="board-scroll" tabindex="-1"><div data-online="board"></div></div>
          <div class="ol-field-foot"><span data-online="board-meta"></span>
            <button type="button" class="ol-link-button" data-online="zoom" aria-pressed="false">${icon('zoom')} Zoom board</button></div>
        </div>
        <p class="ol-intro" data-online="opening-assessment" hidden></p>
        <div class="ol-game-foot" data-online="game-foot"><span data-online="cut-count"></span>
          <button type="button" class="ol-link-button" data-online="resign">Resign match</button></div>
        <div class="ol-confirm" data-online="confirm" hidden>
          <p>Resigning gives your opponent the win. Resign this match?</p><div>
            <button type="button" class="ol-secondary" data-online="keep-playing">Keep playing</button>
            <button type="button" class="ol-danger" data-online="confirm-resign">Resign match</button></div>
        </div>
      </section>
    </div>`;
  return Object.fromEntries([...dialog.querySelectorAll('[data-online]')].map(node => [node.dataset.online, node]));
}
