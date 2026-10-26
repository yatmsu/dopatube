(() => {
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0] === "ja" ? "ja" : "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = chrome.i18n.getMessage(element.dataset.i18n);
  });
})();
