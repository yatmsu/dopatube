# DopaTube

A Chrome extension that lets you change YouTube playback speed with a single click from the header.

![DopaTube logo](assets/logo-preview.jpg)

## Features

- Supports Japanese and English, following Chrome’s display language (English fallback).
- Adds a playback speed button between the YouTube logo and the search box.
- Cycles through **1.0× → 1.5× → 2.0× → 1.0×** by default.
- Supports 2–5 custom speeds from 0.25× to 4.0× in 0.05× increments, in your chosen order.
- Lets you choose whether clicking the logo advances the cycle, resets to 1.0×, or does nothing.
- Keeps the selected speed when switching videos within the same page.
- Centers the logo and speed control between the YouTube logo and the search box as the window resizes.

Works on `https://www.youtube.com/` in desktop Chrome.
Playback speed changes apply to the main player on watch pages (`/watch`) and Shorts pages (`/shorts/…`). Home/feed previews and inline previews are left unchanged.

## Installation

Install [DopaTube from the Chrome Web Store](https://chromewebstore.google.com/detail/dopatube/kjaphodjmimipehdghlmcpecnchfcoii), then open YouTube. If YouTube is already open, reload the page.

## Usage

Click the numbered button in the YouTube header.
The number displayed is the playback speed applied to videos on that page.

The default speed is `1.0×`. Reloading the page or opening a new tab resets the speed to `1.0×`.
Each tab maintains its own current speed. The current speed is neither saved nor synced across tabs.

YouTube's built-in speed controls also work. DopaTube displays the speed you select, including values such as `1.25×`.
Changes made with DopaTube also update the playback speed shown in YouTube's settings menu.
Clicking the number advances to the next entry in your configured cycle. If the current speed is not in the cycle, the next click selects the first higher speed in the configured order, or the first entry if none is higher.

### Settings

Open the extension popup and click **Open settings**. Add or remove speed entries to keep 2–5 distinct values, in 0.05× increments between 0.25× and 4.0×. Entries cycle from top to bottom; edit the values to change the order.

Choose the logo click action: advance to the next speed (default), reset to 1.0×, or do nothing. The number always advances the cycle. Resetting to 1.0× works even when 1.0× is not in the cycle.

Click **Save** to apply preferences to open YouTube tabs without changing their current playback speed. Preferences are shared by tabs using the same DopaTube installation in the same Chrome profile, stored locally, and retained across browser restarts. **Restore defaults** immediately saves the default cycle and logo action.

## Privacy and Site Access

DopaTube does not collect, store, or transmit personal information, watch history, or search history.
It does not use analytics or communicate with external servers.

The content script runs only on `https://www.youtube.com/*` to add the header button and change video playback speed.
The `storage` permission is used only to save the speed cycle and logo action on your device. No `host_permissions` are declared, and preferences are not synced to your Google account.

See the [Privacy Policy](PRIVACY.md) for details.

## Development

Built with Manifest V3 and HTML, CSS, and JavaScript.
No dependency installation or build step is required.
`player.js` runs in the page context to update YouTube's native player state. The content script runs in an isolated world, while the popup and options page run as extension pages. The page-context adapter accepts only a finite numeric playback speed from 0.25× to 4.0× and does not access extension storage. If the native player API is unavailable or does not confirm the change, the content script falls back to setting the video element's playback speed directly.

### Install from source

1. Download and extract this repository, or clone it:

   ```sh
   git clone https://github.com/yatmsu/dopatube.git
   ```

2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select the `dopatube` folder containing `manifest.json`.
6. Open YouTube. If it is already open, reload the page.

### Reload after changes

After editing files, click the reload button for DopaTube at `chrome://extensions`, then reload the YouTube page.
Close and reopen the popup to see changes to it.

### Tests

With Node.js installed, run `node --test tests/*.test.cjs` to check settings validation, speed cycling, content script behavior, and Japanese/English localization.

These tests use simulated browser and Chrome APIs. Check the actual popup, settings page, header layout, video speed, and YouTube speed menu in Chrome separately; the automated tests do not verify the live YouTube interface or visual layout.

### Localization

User-facing text is stored in `_locales/en/messages.json` and `_locales/ja/messages.json` and resolved with `chrome.i18n`. English is the default locale.

To add a language, translate the English catalog into a new supported locale directory and keep message keys and numbered substitutions consistent. Also update the language selection in `localize.js`, which currently sets the document language to Japanese or English, and extend the locale handling and checks in `tests/i18n-helper.cjs` and `tests/i18n.test.cjs`.

Chrome Web Store descriptions and screenshots are managed separately in the developer dashboard. Updating the extension's translation files does not update the detailed store descriptions or screenshots.

## Support

Report bugs and suggest features through [GitHub Issues](https://github.com/yatmsu/dopatube/issues).
For bug reports, include your Chrome version, steps to reproduce the issue, and the expected and actual behavior.

## License

[MIT License](LICENSE)
