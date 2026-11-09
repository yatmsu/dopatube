(() => {
  // This page-context script only updates YouTube's own player state.
  // It has no access to extension storage or other extension APIs.
  document.addEventListener("dopatube-set-playback-rate", (event) => {
    const rate = event.detail;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0.25 || rate > 4) {
      return;
    }
    const mini = document.querySelector("ytd-miniplayer #movie_player.ytp-player-minimized");
    const miniRect = mini?.getBoundingClientRect();
    const activeMini = miniRect?.width > 0 && miniRect.height > 0
      && !mini.closest("#inline-preview-player");
    const selector = (location.pathname === "/watch" || location.pathname.startsWith("/live/")
      || location.pathname.startsWith("/clip/")) ? "#movie_player"
      : location.pathname.startsWith("/shorts/") ? "#shorts-player" : null;
    const player = activeMini ? mini : selector ? document.querySelector(selector) : null;
    if (!player || player.closest("#inline-preview-player")
      || (!activeMini && player.closest("ytd-miniplayer"))) {
      return;
    }
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
