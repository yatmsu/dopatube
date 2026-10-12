(() => {
  const buttonId = "dopatube-header-toggle";
  const values = ["1.0", "1.5", "2.0"];
  let valueIndex = 0;

  function applyPlaybackRate(video) {
    const rate = Number(values[valueIndex]);

    if (video.defaultPlaybackRate !== rate) {
      video.defaultPlaybackRate = rate;
    }
    if (video.playbackRate !== rate) {
      video.playbackRate = rate;
    }
  }

  function applyToAllVideos() {
    document.querySelectorAll("video").forEach(applyPlaybackRate);
  }

  const button = document.createElement("button");
  button.id = buttonId;
  button.type = "button";

  let positionFrame = null;
  let observedElements = [];
  const resizeObserver = new ResizeObserver(schedulePositionUpdate);
  const headerObserver = new MutationObserver(schedulePositionUpdate);

  function observePositionElements(elements) {
    if (elements.length === observedElements.length
      && elements.every((element, index) => element === observedElements[index])) {
      return;
    }

    resizeObserver.disconnect();
    observedElements = elements;
    elements.forEach((element) => resizeObserver.observe(element));
  }

  function schedulePositionUpdate() {
    if (positionFrame !== null) {
      return;
    }
    positionFrame = requestAnimationFrame(() => {
      positionFrame = null;
      updateButtonPosition();
    });
  }

  function updateButtonPosition() {
    if (!button.isConnected) {
      return;
    }

    const masthead = button.closest("ytd-masthead");
    const logo = masthead?.querySelector("#start > #logo a")
      ?? masthead?.querySelector("#start > #logo");
    const search = Array.from(masthead?.querySelectorAll(
      "#center yt-searchbox, #center ytd-searchbox, #center #search-button-narrow"
    ) ?? []).find((element) => element.getBoundingClientRect().width > 0);

    if (!logo || !search) {
      observePositionElements(masthead ? [masthead] : []);
      button.classList.remove("dopatube-centered");
      return;
    }

    observePositionElements([masthead, logo, search]);

    // Remove the button from the flex layout before measuring the available gap.
    button.classList.add("dopatube-centered");
    const logoRect = logo.getBoundingClientRect();
    const searchRect = search.getBoundingClientRect();
    const gap = searchRect.left - logoRect.right;

    if (gap < button.getBoundingClientRect().width + 16) {
      button.classList.remove("dopatube-centered");
      return;
    }

    button.style.left = `${(logoRect.right + searchRect.left) / 2}px`;
    button.style.top = `${searchRect.top + searchRect.height / 2}px`;
  }

  window.addEventListener("resize", schedulePositionUpdate);
  document.addEventListener("yt-navigate-finish", schedulePositionUpdate);

  function updateButton() {
    const current = values[valueIndex];
    const next = values[(valueIndex + 1) % values.length];

    button.textContent = current;
    button.title = `DopaTube: 再生速度 ${current} 倍（クリックで ${next} 倍）`;
    button.setAttribute("aria-label", button.title);
  }

  button.addEventListener("click", () => {
    valueIndex = (valueIndex + 1) % values.length;
    updateButton();
    applyToAllVideos();
  });

  // Media events do not bubble, so use capture to handle new and reused players.
  for (const eventName of ["loadedmetadata", "play", "ratechange"]) {
    document.addEventListener(eventName, (event) => {
      if (event.target instanceof HTMLVideoElement) {
        applyPlaybackRate(event.target);
      }
    }, true);
  }

  function insertButton() {
    if (button.isConnected || document.getElementById(buttonId)) {
      return;
    }

    headerObserver.disconnect();
    observePositionElements([]);

    const logo = document.querySelector("ytd-masthead #start > #logo");
    if (logo) {
      logo.after(button);
      headerObserver.observe(logo.closest("ytd-masthead"), {
        childList: true,
        subtree: true
      });
      schedulePositionUpdate();
    }
  }

  updateButton();
  insertButton();
  applyToAllVideos();

  // Watch the page for new videos and header replacement, not layout updates.
  const observer = new MutationObserver((records) => {
    if (!button.isConnected) {
      insertButton();
    }
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }
        if (node.matches("video")) {
          applyPlaybackRate(node);
        }
        node.querySelectorAll("video").forEach(applyPlaybackRate);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
