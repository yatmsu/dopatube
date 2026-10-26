(() => {
  const buttonId = "dopatube-header-toggle";
  const controlsId = "dopatube-header-controls";
  const { storageKey, normalize, formatRate } = DopaTubeSettings;
  let settings = normalize();
  let currentRate = 1;
  let navigating = false;

  function isPlaybackVideo(video, allowNavigation = false) {
    if ((!allowNavigation && navigating) || video.closest("#inline-preview-player")) {
      return false;
    }
    // YouTube can reuse #movie_player for a 0.4x preview on the home page.
    if (location.pathname === "/watch") {
      return Boolean(video.closest("#movie_player"));
    }
    if (location.pathname.startsWith("/shorts/")) {
      return Boolean(video.closest("#shorts-player"));
    }
    return false;
  }

  function nextRate() {
    return DopaTubeSettings.nextRate(settings.speeds, currentRate);
  }

  function applyPlaybackRate(video) {
    if (!isPlaybackVideo(video)) {
      return;
    }
    const rate = currentRate;

    if (video.defaultPlaybackRate !== rate) {
      video.defaultPlaybackRate = rate;
    }
    // Update YouTube's menu state through the page-context player adapter.
    const request = new CustomEvent("dopatube-set-playback-rate", {
      detail: rate,
      cancelable: true
    });
    if (!document.dispatchEvent(request)) {
      return;
    }
    if (video.playbackRate !== rate) {
      video.playbackRate = rate;
    }
  }

  function applyToAllVideos() {
    document.querySelectorAll("video").forEach(applyPlaybackRate);
  }

  const controls = document.createElement("div");
  controls.id = controlsId;

  const button = document.createElement("button");
  button.id = buttonId;
  button.type = "button";

  const icon = document.createElement("img");
  icon.className = "dopatube-icon";
  icon.src = chrome.runtime.getURL("assets/header-logo.png");
  icon.alt = "";
  icon.width = 256;
  icon.height = 180;
  icon.draggable = false;

  const logoFrame = document.createElement("button");
  logoFrame.type = "button";
  logoFrame.className = "dopatube-logo";
  logoFrame.append(icon);

  const speedLabel = document.createElement("span");
  speedLabel.className = "dopatube-speed";
  button.append(speedLabel);
  controls.append(logoFrame, button);

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
    if (!controls.isConnected) {
      return;
    }

    const masthead = controls.closest("ytd-masthead");
    const logo = masthead?.querySelector("#start > #logo a")
      ?? masthead?.querySelector("#start > #logo");
    const searchHost = Array.from(masthead?.querySelectorAll(
      "#center yt-searchbox, #center ytd-searchbox, #center #search-button-narrow"
    ) ?? []).find((element) => element.getBoundingClientRect().width > 0);

    const search = searchHost?.querySelector(".ytSearchboxComponentInputWrapper")
      ?? searchHost;

    if (!logo || !search) {
      observePositionElements(masthead ? [masthead] : []);
      controls.classList.remove("dopatube-centered");
      controls.style.removeProperty("left");
      controls.style.removeProperty("top");
      return;
    }

    observePositionElements([masthead, logo, search]);

    // Keep space reserved in the flex layout, then center within the visible gap.
    controls.classList.add("dopatube-centered");
    controls.style.left = "0px";
    controls.style.top = "0px";
    const logoRect = logo.getBoundingClientRect();
    const searchRect = search.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const centerX = (logoRect.right + searchRect.left) / 2;
    const centerY = searchRect.top + searchRect.height / 2;

    controls.style.left = `${centerX - (controlsRect.left + controlsRect.width / 2)}px`;
    controls.style.top = `${centerY - (controlsRect.top + controlsRect.height / 2)}px`;
  }

  window.addEventListener("resize", schedulePositionUpdate);
  document.addEventListener("yt-navigate-start", () => {
    navigating = true;
  });
  document.addEventListener("yt-navigate-finish", () => {
    navigating = false;
    applyToAllVideos();
    schedulePositionUpdate();
  });

  function updateButton() {
    const current = formatRate(currentRate);
    const next = formatRate(nextRate());

    speedLabel.textContent = current;
    button.title = chrome.i18n.getMessage("speedButtonTitle", [current, next]);
    button.setAttribute("aria-label", button.title);
    const actions = {
      cycle: "logoCycleTitle",
      reset: "logoResetTitle",
      none: "logoNoneTitle"
    };
    logoFrame.title = chrome.i18n.getMessage(actions[settings.logoAction], next);
    logoFrame.setAttribute("aria-label", logoFrame.title);
    logoFrame.disabled = settings.logoAction === "none";
  }

  function setRate(rate) {
    currentRate = rate;
    updateButton();
    applyToAllVideos();
    schedulePositionUpdate();
  }

  button.addEventListener("click", () => setRate(nextRate()));
  logoFrame.addEventListener("click", () => {
    if (settings.logoAction === "cycle") {
      setRate(nextRate());
    } else if (settings.logoAction === "reset") {
      setRate(1);
    }
  });

  // Media events do not bubble, so use capture to handle new and reused players.
  for (const eventName of ["loadedmetadata", "play", "playing"]) {
    document.addEventListener(eventName, (event) => {
      if (event.target instanceof HTMLVideoElement && isPlaybackVideo(event.target, true)) {
        // Cached navigation can start playback before yt-navigate-finish arrives.
        navigating = false;
        applyPlaybackRate(event.target);
      }
    }, true);
  }

  // Reflect changes from YouTube's controls instead of undoing them.
  document.addEventListener("ratechange", (event) => {
    if (!(event.target instanceof HTMLVideoElement)) {
      return;
    }
    const video = event.target;
    if (!isPlaybackVideo(video)) {
      return;
    }
    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const rate = video.playbackRate;
    if (!Number.isFinite(rate) || rate <= 0 || rate === currentRate) {
      return;
    }
    currentRate = rate;
    updateButton();
    schedulePositionUpdate();
  }, true);

  function insertButton() {
    if (controls.isConnected || document.getElementById(controlsId)) {
      return;
    }

    headerObserver.disconnect();
    observePositionElements([]);

    const logo = document.querySelector("ytd-masthead #start > #logo");
    if (logo) {
      logo.after(controls);
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

  function updateSettings(value) {
    settings = normalize(value);
    updateButton();
    schedulePositionUpdate();
  }

  // Do not change the playing speed when preferences are edited in another tab.
  let settingsRevision = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, storageKey)) {
      settingsRevision += 1;
      updateSettings(changes[storageKey].newValue);
    }
  });
  const initialRevision = settingsRevision;
  chrome.storage.local.get(storageKey).then((stored) => {
    if (settingsRevision === initialRevision) {
      updateSettings(stored[storageKey]);
    }
  }).catch(() => {
    console.warn("DopaTube: Could not load settings; using defaults.");
  });

  // Watch the page for new videos and header replacement, not layout updates.
  const observer = new MutationObserver((records) => {
    if (!controls.isConnected) {
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
