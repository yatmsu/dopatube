(() => {
  const defaults = { speeds: [1, 1.5, 2], logoAction: "cycle" };
  const storageKey = "settings";

  function validate(settings) {
    const speeds = settings?.speeds;
    if (!Array.isArray(speeds) || speeds.length < 2 || speeds.length > 5) {
      return "再生速度は2〜5個で設定してください。";
    }
    if (speeds.some((rate) => typeof rate !== "number" || !Number.isFinite(rate)
      || rate < 0.25 || rate > 4)) {
      return "再生速度は0.25〜4.0倍で入力してください。";
    }
    if (speeds.some((rate) => Math.abs(rate * 20 - Math.round(rate * 20)) > 1e-8)) {
      return "再生速度は0.05倍刻みで入力してください。";
    }
    if (new Set(speeds.map((rate) => Math.round(rate * 100))).size !== speeds.length) {
      return "同じ再生速度を重複して登録できません。";
    }
    if (!["cycle", "reset", "none"].includes(settings.logoAction)) {
      return "「ド」の動作を選択してください。";
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
