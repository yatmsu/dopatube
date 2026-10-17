const { version } = chrome.runtime.getManifest();

document.getElementById("version").textContent = version;

document.getElementById("open-settings").addEventListener("click", async () => {
  try {
    await chrome.runtime.openOptionsPage();
  } catch {
    document.getElementById("settings-error").textContent = "設定画面を開けませんでした。ポップアップを開き直してください。";
  }
});

const { storageKey, normalize, formatRate } = DopaTubeSettings;
function showCycle(value) {
  const { speeds } = normalize(value);
  document.getElementById("speed-cycle").textContent = [...speeds, speeds[0]].map(formatRate).join(" → ");
}
chrome.storage.local.get(storageKey).then((stored) => showCycle(stored[storageKey])).catch(() => {
  document.getElementById("speed-cycle").textContent = "設定を読み込めませんでした。";
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.hasOwn(changes, storageKey)) {
    showCycle(changes[storageKey].newValue);
  }
});
