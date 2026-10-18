(() => {
  // This page-context script only updates YouTube's own player state.
  // It has no access to extension storage or other extension APIs.
  document.addEventListener("dopatube-set-playback-rate", (event) => {
    const rate = event.detail;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0.25 || rate > 4) {
      return;
    }
    const selector = location.pathname === "/watch" ? "#movie_player"
      : location.pathname.startsWith("/shorts/") ? "#shorts-player" : null;
    if (!selector) {
      return;
    }
    const player = document.querySelector(selector);
    if (typeof player?.setPlaybackRate !== "function" || typeof player.getPlaybackRate !== "function") {
      return;
    }
    try {
      if (player.getPlaybackRate() !== rate) {
        player.setPlaybackRate(rate);
      }
      if (player.getPlaybackRate() === rate) {
        event.preventDefault();
      }
    } catch {
      // The isolated content script retains a media-element fallback.
    }
  });
})();
