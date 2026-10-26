(() => {
  const { storageKey, validate, normalize, formatRate } = DopaTubeSettings;
  const form = document.getElementById("settings-form");
  const fields = document.getElementById("settings-fields");
  const list = document.getElementById("speed-list");
  const add = document.getElementById("add-speed");
  const reset = document.getElementById("reset-settings");
  const preview = document.getElementById("cycle-preview");
  const error = document.getElementById("error-message");
  const status = document.getElementById("status-message");
  let busy = false;
  let dirty = false;

  function readForm() {
    return {
      speeds: Array.from(list.querySelectorAll("input"), (input) => input.valueAsNumber),
      logoAction: form.querySelector('input[name="logo-action"]:checked')?.value
    };
  }

  function refresh() {
    const rows = Array.from(list.children);
    rows.forEach((row, index) => {
      const input = row.querySelector("input");
      input.id = `speed-${index}`;
      row.querySelector("label").htmlFor = input.id;
      row.querySelector("label").textContent = chrome.i18n.getMessage("speedEntry", String(index + 1));
      const remove = row.querySelector("button");
      remove.disabled = rows.length <= 2;
      remove.setAttribute("aria-label", chrome.i18n.getMessage("removeSpeedLabel", String(index + 1)));
    });
    add.disabled = rows.length >= 5;
    const settings = readForm();
    preview.textContent = validate(settings) ? "" : chrome.i18n.getMessage("cyclePreview", [...settings.speeds, settings.speeds[0]].map(formatRate).join(" → "));
  }

  function markDirty() {
    dirty = true;
    error.textContent = "";
    status.textContent = chrome.i18n.getMessage("unsavedChanges");
    refresh();
  }

  function appendSpeed(value) {
    const row = document.createElement("div");
    row.className = "speed-row";
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0.25";
    input.max = "4";
    input.step = "0.05";
    input.required = true;
    input.setAttribute("aria-describedby", "speeds-help");
    input.value = String(value);
    const unit = document.createElement("span");
    unit.textContent = chrome.i18n.getMessage("speedUnit");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = chrome.i18n.getMessage("remove");
    remove.addEventListener("click", () => {
      if (busy || list.children.length <= 2) return;
      const index = Array.from(list.children).indexOf(row);
      row.remove();
      markDirty();
      list.children[Math.min(index, list.children.length - 1)].querySelector("input").focus();
    });
    row.append(label, input, unit, remove);
    list.append(row);
    return input;
  }

  function render(settings) {
    list.replaceChildren();
    settings.speeds.forEach(appendSpeed);
    form.querySelector(`input[name="logo-action"][value="${settings.logoAction}"]`).checked = true;
    refresh();
  }

  add.addEventListener("click", () => {
    if (busy || list.children.length >= 5) return;
    const used = readForm().speeds;
    const available = Array.from({ length: 76 }, (_, index) => (index + 5) / 20);
    const value = available.find((rate) => rate >= 1 && !used.includes(rate))
      ?? available.find((rate) => !used.includes(rate));
    const input = appendSpeed(value);
    markDirty();
    input.focus();
  });
  form.addEventListener("input", markDirty);

  async function save(settings, resetToDefaults = false) {
    if (busy) return;
    error.textContent = validate(settings);
    status.textContent = "";
    if (error.textContent) {
      const invalid = Array.from(list.querySelectorAll("input")).find((input) => !input.checkValidity());
      invalid?.focus();
      return;
    }
    busy = true;
    fields.disabled = true;
    try {
      const value = normalize(settings);
      await chrome.storage.local.set({ [storageKey]: value });
      render(value);
      dirty = false;
      status.textContent = resetToDefaults ? chrome.i18n.getMessage("defaultsSaved") : chrome.i18n.getMessage("settingsSaved");
    } catch {
      error.textContent = chrome.i18n.getMessage("errorSaveSettings");
    } finally {
      busy = false;
      fields.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save(readForm());
  });
  reset.addEventListener("click", () => save(normalize(), true));

  // Keep multiple settings pages consistent without discarding unsaved edits.
  let revision = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.hasOwn(changes, storageKey)) return;
    revision += 1;
    if (!dirty && !busy) render(normalize(changes[storageKey].newValue));
  });
  const initialRevision = revision;
  chrome.storage.local.get(storageKey).then((stored) => {
    if (revision === initialRevision) render(normalize(stored[storageKey]));
    fields.disabled = false;
    status.textContent = "";
  }).catch(() => {
    error.textContent = chrome.i18n.getMessage("errorLoadSettings");
    status.textContent = "";
  });
})();
