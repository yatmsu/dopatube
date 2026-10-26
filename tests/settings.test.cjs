const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { createI18n } = require("./i18n-helper.cjs");
const root = resolve(__dirname, "..");
const source = (name) => readFileSync(resolve(root, name), "utf8");

function loadSettings() {
  const context = vm.createContext({ chrome: { i18n: createI18n() } });
  vm.runInContext(source("settings.js"), context);
  return context.DopaTubeSettings;
}
const settings = loadSettings();
const valid = (speeds, logoAction = "cycle") => ({ speeds, logoAction });

test("accepts 2–5 speeds and preserves the requested order", () => {
  for (const speeds of [[1, 1.25], [2, 1, 1.25], [0.25, 1.15, 1.3, 2], [4, 0.25, 1.05, 2.35, 3.95]]) {
    assert.equal(settings.validate(valid(speeds)), "");
    assert.equal(JSON.stringify(settings.normalize(valid(speeds)).speeds), JSON.stringify(speeds));
  }
});

test("rejects wrong counts, invalid values, duplicates and off-step values", () => {
  for (const speeds of [[], [1], [1, 1.25, 1.5, 2, 2.5, 3], [NaN, 1], [Infinity, 1], ["1", 2], [0.2, 1], [4.05, 1], [1, 1], [1.01, 2], [1.125, 2]]) {
    assert.notEqual(settings.validate(valid(speeds)), "", JSON.stringify(speeds));
  }
  assert.notEqual(settings.validate(valid([1, 2], "invalid")), "");
});

test("uses independent defaults for missing or corrupt storage", () => {
  const first = settings.normalize();
  first.speeds.push(3);
  assert.equal(JSON.stringify(settings.normalize(null)), '{"speeds":[1,1.5,2],"logoAction":"cycle"}');
  assert.equal(settings.normalize({ speeds: [1] }).speeds.length, 3);
});

test("cycles in configured order and handles speeds outside the cycle", () => {
  assert.equal(settings.nextRate([2, 1, 1.25], 2), 1);
  assert.equal(settings.nextRate([2, 1, 1.25], 1.25), 2);
  assert.equal(settings.nextRate([1, 1.25, 2], 1.1), 1.25);
  assert.equal(settings.nextRate([1, 1.25, 2], 3), 1);
  assert.equal(settings.nextRate([2, 1, 1.25], 1.1), 2);
});

test("handles decimal rounding without rejecting 0.05 increments", () => {
  assert.equal(settings.validate(valid([1.1 + 0.05, 2])), "");
  assert.equal(settings.normalize(valid([1.1 + 0.05, 2])).speeds[0], 1.15);
  assert.equal(settings.formatRate(1), "1.0");
  assert.equal(settings.formatRate(1.05), "1.05");
});

async function loadContent(stored = valid([1, 1.5, 2]), rejectRead = false, locale = "en") {
  const elements = [], handlers = {}, storageListeners = [];
  const location = { pathname: "/watch" };
  let resolveRead;
  class Video {
    constructor() {
      this.playbackRate = 1;
      this.defaultPlaybackRate = 1;
      this.preview = false;
      this.visible = true;
      this.player = "movie_player";
    }
    closest(selector) {
      if (selector === "#inline-preview-player") return this.preview ? {} : null;
      if (selector === "#movie_player") return this.player === "movie_player" ? {} : null;
      if (selector === "#shorts-player") return this.player === "shorts-player" ? {} : null;
      return null;
    }
    getBoundingClientRect() { return { width: this.visible ? 640 : 0, height: this.visible ? 360 : 0 }; }
  }
  const video = new Video();
  const videos = [video];
  const document = {
    createElement(tag) {
      const element = {
        tag, children: [], listeners: {}, style: {}, isConnected: true,
        classList: { add() {}, remove() {} },
        append(...children) { this.children.push(...children); },
        setAttribute() {},
        addEventListener(name, fn) { this.listeners[name] = fn; }
      };
      elements.push(element);
      return element;
    },
    querySelectorAll: () => videos, documentElement: {},
    addEventListener(name, fn) { (handlers[name] ??= []).push(fn); },
    dispatchEvent(event) {
      handlers[event.type]?.forEach((fn) => fn(event));
      return !event.defaultPrevented;
    }
  };
  class CustomEvent {
    constructor(type, options) { this.type = type; Object.assign(this, options); }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  }
  const Observer = class { observe() {} disconnect() {} };
  const context = vm.createContext({
    document, location, chrome: {
      i18n: createI18n(locale),
      runtime: { getURL: (path) => path },
      storage: {
        onChanged: { addListener(fn) { storageListeners.push(fn); } },
        local: { get: () => rejectRead ? Promise.reject(Error("read failed")) : new Promise((resolve) => { resolveRead = resolve; }) }
      }
    },
    window: { addEventListener() {} }, console: { warn() {} },
    ResizeObserver: Observer, MutationObserver: Observer,
    requestAnimationFrame: () => 1, HTMLVideoElement: Video, CustomEvent
  });
  vm.runInContext(source("settings.js"), context);
  vm.runInContext(source("content.js"), context);
  const button = elements.find((e) => e.id === "dopatube-header-toggle");
  const logo = elements.find((e) => e.className === "dopatube-logo");
  const label = elements.find((e) => e.className === "dopatube-speed");
  const change = (value) => storageListeners.forEach((fn) => fn({ settings: { newValue: value } }, "local"));
  return {
    video, button, logo, label, change, location,
    onPlayerRequest: (listener) => document.addEventListener("dopatube-set-playback-rate", listener),
    addVideo: () => { const added = new Video(); videos.push(added); return added; },
    finishRead: async () => { resolveRead?.({ settings: stored }); await Promise.resolve(); await Promise.resolve(); },
    fire: (name, target = video) => handlers[name]?.forEach((fn) => fn({ target }))
  };
}

test("loads custom settings, cycles five entries, and synchronizes native speeds", async () => {
  const app = await loadContent(valid([1, 1.05, 1.25, 1.5, 2]));
  await app.finishRead();
  for (const rate of [1.05, 1.25, 1.5, 2, 1]) {
    app.button.listeners.click();
    app.fire("ratechange");
    assert.equal(app.video.playbackRate, rate);
    assert.equal(app.label.textContent, settings.formatRate(rate));
  }
  app.video.playbackRate = 1.75;
  app.fire("ratechange");
  assert.equal(app.label.textContent, "1.75");
  app.fire("play");
  app.fire("loadedmetadata");
  assert.equal(app.video.playbackRate, 1.75);
  app.button.listeners.click();
  assert.equal(app.video.playbackRate, 2);
});

test("supports logo cycle, reset outside the loop, and no-op", async () => {
  const app = await loadContent();
  await app.finishRead();
  app.logo.listeners.click();
  assert.equal(app.video.playbackRate, 1.5);
  app.change(valid([1.25, 2], "reset"));
  assert.equal(app.video.playbackRate, 1.5, "saving must not change current playback");
  app.logo.listeners.click();
  assert.equal(app.video.playbackRate, 1);
  app.button.listeners.click();
  assert.equal(app.video.playbackRate, 1.25);
  app.change(valid([1.25, 2], "none"));
  assert.equal(app.logo.disabled, true);
  app.logo.listeners.click();
  assert.equal(app.video.playbackRate, 1.25);
  app.button.listeners.click();
  assert.equal(app.video.playbackRate, 2);
});

test("does not overwrite new settings with a stale initial read", async () => {
  const app = await loadContent(valid([1, 1.5, 2]));
  app.change(valid([1, 1.25], "cycle"));
  await app.finishRead();
  app.button.listeners.click();
  assert.equal(app.video.playbackRate, 1.25);
});

test("recovers defaults after storage removal or read failure", async () => {
  const app = await loadContent(valid([1, 1.25]));
  await app.finishRead();
  app.change(undefined);
  app.button.listeners.click();
  assert.equal(app.video.playbackRate, 1.5);
  const failed = await loadContent(undefined, true);
  await failed.finishRead();
  failed.button.listeners.click();
  assert.equal(failed.video.playbackRate, 1.5);
});

test("keeps current playback speed separate between tabs", async () => {
  const one = await loadContent(), two = await loadContent();
  await one.finishRead();
  await two.finishRead();
  one.button.listeners.click();
  one.change(valid([1, 2]));
  two.change(valid([1, 2]));
  assert.equal(one.video.playbackRate, 1.5);
  assert.equal(two.video.playbackRate, 1);
});

test("ignores the preview player's 0.4 rate without changing the main video's speed", async () => {
  const app = await loadContent();
  await app.finishRead();
  const preview = app.addVideo();
  preview.preview = true;
  preview.playbackRate = 0.4;
  preview.defaultPlaybackRate = 0.4;
  app.fire("ratechange", preview);
  assert.equal(app.label.textContent, "1.0");
  app.fire("play");
  assert.equal(app.video.playbackRate, 1);
  app.button.listeners.click();
  assert.equal(app.video.playbackRate, 1.5);
  assert.equal(preview.playbackRate, 0.4);
  app.fire("loadedmetadata", preview);
  app.fire("play", preview);
  assert.equal(preview.playbackRate, 0.4);
  app.fire("ratechange", preview);
  assert.equal(app.label.textContent, "1.5");
});

test("ignores hidden stale videos but accepts native changes on the visible video", async () => {
  const app = await loadContent();
  await app.finishRead();
  const hidden = app.addVideo();
  hidden.visible = false;
  hidden.playbackRate = 0.4;
  app.fire("ratechange", hidden);
  assert.equal(app.label.textContent, "1.0");
  app.video.playbackRate = 1.25;
  app.fire("ratechange");
  assert.equal(app.label.textContent, "1.25");
});

test("keeps the selected speed when a visible movie_player becomes a home preview", async () => {
  const app = await loadContent();
  await app.finishRead();
  app.location.pathname = "/";
  app.video.playbackRate = 0.4;
  app.fire("ratechange");
  assert.equal(app.label.textContent, "1.0");
  app.fire("play");
  assert.equal(app.video.playbackRate, 0.4, "do not control the home preview");
  app.location.pathname = "/watch";
  app.fire("yt-navigate-finish");
  assert.equal(app.video.playbackRate, 1);
  assert.equal(app.label.textContent, "1.0");
});

test("ignores transitional rates and reapplies the selected speed after navigation", async () => {
  const app = await loadContent();
  await app.finishRead();
  app.button.listeners.click();
  app.fire("yt-navigate-start");
  app.video.playbackRate = 0.4;
  app.fire("ratechange");
  assert.equal(app.label.textContent, "1.5");
  app.fire("yt-navigate-finish");
  assert.equal(app.video.playbackRate, 1.5);
  app.video.playbackRate = 1.25;
  app.fire("ratechange");
  assert.equal(app.label.textContent, "1.25", "native speed controls still work");
});

test("only synchronizes the shorts player on a Shorts page", async () => {
  const app = await loadContent();
  await app.finishRead();
  app.location.pathname = "/shorts/example";
  app.video.playbackRate = 0.4;
  app.fire("ratechange");
  assert.equal(app.label.textContent, "1.0", "ignore the stale watch player");
  const short = app.addVideo();
  short.player = "shorts-player";
  short.playbackRate = 1.25;
  app.fire("ratechange", short);
  assert.equal(app.label.textContent, "1.25");
});

test("applies the selected speed when cached playback starts before navigation finishes", async () => {
  for (const event of ["loadedmetadata", "play", "playing"]) {
    const app = await loadContent();
    await app.finishRead();
    app.button.listeners.click();
    app.fire("yt-navigate-start");
    app.video.playbackRate = 1;
    app.fire(event);
    assert.equal(app.video.playbackRate, 1.5, event);
    app.video.playbackRate = 1.25;
    app.fire("ratechange");
    assert.equal(app.label.textContent, "1.25", event);
  }
});

test("requests the native player state update, including custom speed steps", async () => {
  const app = await loadContent(valid([1, 1.05, 1.25]));
  await app.finishRead();
  const requests = [];
  app.onPlayerRequest((event) => {
    requests.push(event.detail);
    app.video.playbackRate = event.detail;
    event.preventDefault();
  });
  app.button.listeners.click();
  assert.equal(app.video.playbackRate, 1.05);
  assert.deepEqual(requests, [1.05]);
  app.location.pathname = "/";
  app.button.listeners.click();
  assert.deepEqual(requests, [1.05], "home previews must not receive requests");
});

test("page adapter updates the correct native player and rejects untrusted payloads", () => {
  let handle;
  let rate = 1;
  let calls = 0;
  let selector;
  const location = { pathname: "/watch" };
  const player = {
    getPlaybackRate: () => rate,
    setPlaybackRate(value) { rate = value; calls += 1; }
  };
  const document = {
    addEventListener(name, fn) { assert.equal(name, "dopatube-set-playback-rate"); handle = fn; },
    querySelector(value) { selector = value; return player; }
  };
  vm.runInNewContext(source("player.js"), { document, location });
  const send = (detail) => {
    const event = { detail, preventDefault() { this.accepted = true; } };
    handle(event);
    return event.accepted;
  };
  assert.equal(send(1.05), true);
  assert.equal(rate, 1.05);
  assert.equal(selector, "#movie_player");
  assert.equal(send(1.05), true);
  assert.equal(calls, 1, "do not reapply an unchanged native rate");
  for (const value of ["2", null, {}, NaN, Infinity, 0, 4.05]) {
    assert.equal(send(value), undefined);
  }
  assert.equal(calls, 1);
  location.pathname = "/";
  assert.equal(send(2), undefined);
  assert.equal(calls, 1);
  location.pathname = "/shorts/example";
  assert.equal(send(2), true);
  assert.equal(selector, "#shorts-player");
  player.setPlaybackRate = () => { throw Error("player unavailable"); };
  assert.equal(send(1), undefined);
});

for (const locale of ["en", "ja"]) {
  test(`localizes header tooltips and logo actions in ${locale}`, async () => {
    const i18n = createI18n(locale);
    const app = await loadContent(valid([1, 1.25]), false, locale);
    await app.finishRead();
    assert.equal(app.button.title, i18n.getMessage("speedButtonTitle", ["1.0", "1.25"]));
    assert.equal(app.logo.title, i18n.getMessage("logoCycleTitle", "1.25"));
    app.change(valid([1, 1.25], "reset"));
    assert.equal(app.logo.title, i18n.getMessage("logoResetTitle"));
    app.change(valid([1, 1.25], "none"));
    assert.equal(app.logo.title, i18n.getMessage("logoNoneTitle"));
  });
}
