(() => {
  const defaults = { speeds: [1, 1.5, 2], logoAction: "cycle" };
  const storageKey = "settings";

  function validate(settings) {
    const speeds = settings?.speeds;
    if (!Array.isArray(speeds) || speeds.length < 2 || speeds.length > 5) {
      return chrome.i18n.getMessage("errorSpeedCount");
    }
    if (speeds.some((rate) => typeof rate !== "number" || !Number.isFinite(rate)
      || rate < 0.25 || rate > 4)) {
      return chrome.i18n.getMessage("errorSpeedRange");
    }
    if (speeds.some((rate) => Math.abs(rate * 20 - Math.round(rate * 20)) > 1e-8)) {
      return chrome.i18n.getMessage("errorSpeedStep");
    }
    if (new Set(speeds.map((rate) => Math.round(rate * 100))).size !== speeds.length) {
      return chrome.i18n.getMessage("errorSpeedDuplicate");
    }
    if (!["cycle", "reset", "none"].includes(settings.logoAction)) {
      return chrome.i18n.getMessage("errorLogoAction");
    }
    return "";
  }

  function normalize(settings) {
    if (validate(settings)) {
      return { speeds: [...defaults.speeds], logoAction: defaults.logoAction };
    }
    return {
      speeds: settings.speeds.map((rate) => Math.round(rate * 100) / 100),
      logoAction: settings.logoAction
    };
  }

  function nextRate(speeds, currentRate) {
    const index = speeds.findIndex((rate) => Math.abs(rate - currentRate) < 1e-8);
    if (index !== -1) {
      return speeds[(index + 1) % speeds.length];
    }
    return speeds.find((rate) => rate > currentRate) ?? speeds[0];
  }

  function formatRate(rate) {
    return Number.isInteger(rate) ? rate.toFixed(1) : String(rate);
  }

  globalThis.DopaTubeSettings = { storageKey, validate, normalize, nextRate, formatRate };
})();
