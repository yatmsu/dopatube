const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { createI18n } = require("./i18n-helper.cjs");
const source = (file) => readFileSync(resolve(__dirname, "..", file), "utf8");
const catalogs = Object.fromEntries(["en", "ja"].map((locale) => [locale, JSON.parse(source(`_locales/${locale}/messages.json`))]));

test("all message references exist in both catalogs with matching substitutions", () => {
  assert.deepEqual(Object.keys(catalogs.ja).sort(), Object.keys(catalogs.en).sort());
  for (const [key, { message }] of Object.entries(catalogs.en)) {
    assert.ok(message.trim(), key);
    assert.ok(catalogs.ja[key].message.trim(), key);
    assert.deepEqual(catalogs.ja[key].message.match(/\$\d/g), message.match(/\$\d/g), key);
  }
  for (const file of ["popup.html", "options.html", "settings.js", "popup.js", "options.js", "content.js"]) {
    for (const match of source(file).matchAll(/(?:data-i18n="|getMessage\(")([\w]+)"/g)) {
      assert.ok(catalogs.en[match[1]], `${file}: ${match[1]}`);
    }
  }
  const manifest = JSON.parse(source("manifest.json"));
  assert.equal(manifest.default_locale, "en");
  for (const match of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) assert.ok(catalogs.en[match[1]]);
});

for (const locale of ["ja-JP", "en-US", "fr"]) {
  test(`localizes popup and options text in ${locale} without removing controls`, () => {
    const i18n = createI18n(locale);
    for (const file of ["popup.html", "options.html"]) {
      const html = source(file);
      const elements = Array.from(html.matchAll(/data-i18n="(\w+)"/g), ([, key]) => ({ dataset: { i18n: key }, textContent: "" }));
      const document = { documentElement: {}, querySelectorAll: () => elements };
      vm.runInNewContext(source("localize.js"), { document, chrome: { i18n } });
      assert.equal(document.documentElement.lang, locale.startsWith("ja") ? "ja" : "en");
      elements.forEach((element) => assert.equal(element.textContent, i18n.getMessage(element.dataset.i18n)));
      assert.ok(html.indexOf('src="localize.js"') < html.indexOf('src="settings.js"'));
      assert.doesNotMatch(html, /<[^>]+data-i18n="[^>]+>\s*<(?:input|button)/);
    }
  });

  test(`localizes validation errors in ${locale}`, () => {
    const i18n = createI18n(locale);
    const context = vm.createContext({ chrome: { i18n } });
    vm.runInContext(source("settings.js"), context);
    const validate = context.DopaTubeSettings.validate;
    for (const [speeds, action, message] of [
      [[1], "cycle", "errorSpeedCount"], [[0.2, 1], "cycle", "errorSpeedRange"],
      [[1.01, 2], "cycle", "errorSpeedStep"], [[1, 1], "cycle", "errorSpeedDuplicate"],
      [[1, 2], "invalid", "errorLogoAction"]
    ]) assert.equal(validate({ speeds, logoAction: action }), i18n.getMessage(message));
  });

  test(`popup shows the stored cycle and localized failures in ${locale}`, async () => {
    const i18n = createI18n(locale);
    const elements = Object.fromEntries(["version", "open-settings", "settings-error", "speed-cycle"].map((id) => [id, {
      textContent: "", addEventListener(event, handler) { this[event] = handler; }
    }]));
    let failRead = false;
    const chrome = {
      i18n,
      runtime: { getManifest: () => ({ version: "1.0.1" }), openOptionsPage: async () => { throw Error("unavailable"); } },
      storage: { local: { get: async () => {
        if (failRead) throw Error("unavailable");
        return { settings: { speeds: [1, 1.05, 2], logoAction: "cycle" } };
      } }, onChanged: { addListener() {} } }
    };
    const document = { getElementById: (id) => elements[id] };
    const run = async () => {
      const context = vm.createContext({ chrome, document });
      vm.runInContext(source("settings.js"), context);
      vm.runInContext(source("popup.js"), context);
      await new Promise(setImmediate);
    };
    await run();
    assert.equal(elements["speed-cycle"].textContent, "1.0 → 1.05 → 2.0 → 1.0");
    await elements["open-settings"].click();
    assert.equal(elements["settings-error"].textContent, i18n.getMessage("errorOpenSettings"));
    failRead = true;
    await run();
    assert.equal(elements["speed-cycle"].textContent, i18n.getMessage("errorLoadCycle"));
  });
}
