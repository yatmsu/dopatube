(() => {
  const buttonId = "dopatube-header-toggle";
  const controlsId = "dopatube-header-controls";
  const values = [1, 1.5, 2];
  let currentRate = 1;

  function nextRate() {
    return values.find((rate) => rate > currentRate) ?? values[0];
  }

  function formatRate(rate) {
    return Number.isInteger(rate) ? rate.toFixed(1) : String(rate);
  }

  function applyPlaybackRate(video) {
    const rate = currentRate;

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

  const controls = document.createElement("div");
  controls.id = controlsId;

  const button = document.createElement("button");
  button.id = buttonId;
  button.type = "button";

  const icon = document.createElement("img");
  icon.className = "dopatube-icon";
  icon.src = chrome.runtime.getURL("assets/header-logo.png");
  icon.alt = "DopaTube";
  icon.width = 256;
  icon.height = 180;
  icon.draggable = false;

  const logoFrame = document.createElement("span");
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
  document.addEventListener("yt-navigate-finish", schedulePositionUpdate);

  function updateButton() {
    const current = formatRate(currentRate);
    const next = formatRate(nextRate());

    speedLabel.textContent = current;
    button.title = `DopaTube: 再生速度 ${current} 倍（クリックで ${next} 倍）`;
    button.setAttribute("aria-label", button.title);
  }

  button.addEventListener("click", () => {
    currentRate = nextRate();
    updateButton();
    applyToAllVideos();
  });

  // Media events do not bubble, so use capture to handle new and reused players.
  for (const eventName of ["loadedmetadata", "play"]) {
    document.addEventListener(eventName, (event) => {
      if (event.target instanceof HTMLVideoElement) {
        applyPlaybackRate(event.target);
      }
    }, true);
  }

  // Reflect changes from YouTube's controls instead of undoing them.
  document.addEventListener("ratechange", (event) => {
    if (!(event.target instanceof HTMLVideoElement)) {
      return;
    }
    const rate = event.target.playbackRate;
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
