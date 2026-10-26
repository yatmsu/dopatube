const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function createI18n(locale = "en") {
  const read = (language) => JSON.parse(readFileSync(resolve(__dirname, "..", "_locales", language, "messages.json"), "utf8"));
  const fallback = read("en");
  const messages = ["ja", "en"].includes(locale.split("-")[0]) ? read(locale.split("-")[0]) : fallback;
  return {
    getUILanguage: () => locale,
    getMessage(key, substitutions = []) {
      const message = (messages[key] ?? fallback[key])?.message ?? "";
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      return message.replace(/\$(\d)/g, (_, index) => values[Number(index) - 1] ?? "");
    }
  };
}
module.exports = { createI18n };
