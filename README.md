# DopaTube

A Chrome extension that lets you change YouTube playback speed with a single click from the header.

![DopaTube logo](assets/logo-preview.jpg)

## Features

- Adds a playback speed button between the YouTube logo and the search box.
- Cycles through **1.0× → 1.5× → 2.0× → 1.0×** by default.
- Supports 2–5 custom speeds from 0.25× to 4.0× in 0.05× increments, in your chosen order.
- Lets you choose whether clicking the logo advances the cycle, resets to 1.0×, or does nothing.
- Keeps the selected speed when switching videos within the same page.
- Centers the logo and speed control between the YouTube logo and the search box as the window resizes.

Works on `https://www.youtube.com/` in desktop Chrome.

## Installation

Install [DopaTube from the Chrome Web Store](https://chromewebstore.google.com/detail/dopatube/kjaphodjmimipehdghlmcpecnchfcoii), then open YouTube. If YouTube is already open, reload the page.

## Usage

Click the numbered button in the YouTube header.
The number displayed is the playback speed applied to videos on that page.

The default speed is `1.0×`. Reloading the page or opening a new tab resets the speed to `1.0×`.
Each tab maintains its own current speed. The current speed is neither saved nor synced across tabs.

YouTube's built-in speed controls also work. DopaTube displays the speed you select, including values such as `1.25×`.
Clicking the number advances to the next entry in your configured cycle. If the current speed is not in the cycle, the next click selects the first higher speed in the configured order, or the first entry if none is higher.

### Settings

Open the extension popup and click **設定を開く** (Open settings). Add or remove speed entries to keep 2–5 distinct values, in 0.05× increments between 0.25× and 4.0×. Entries cycle from top to bottom; edit the values to change the order.

Choose the logo click action: advance to the next speed (default), reset to 1.0×, or do nothing. The number always advances the cycle. Resetting to 1.0× works even when 1.0× is not in the cycle.

Click **保存** (Save) to apply preferences to open YouTube tabs without changing their current playback speed. Preferences are stored locally and survive browser restarts. **初期設定に戻す** (Restore defaults) immediately saves the default cycle and logo action.

## Privacy and Site Access

DopaTube does not collect, store, or transmit personal information, watch history, or search history.
It does not use analytics or communicate with external servers.

The content script runs only on `https://www.youtube.com/*` to add the header button and change video playback speed.
The `storage` permission is used only to save the speed cycle and logo action on your device. No `host_permissions` are declared, and preferences are not synced to your Google account.

See the [Privacy Policy](PRIVACY.md) for details.

## Development

Built with Manifest V3 and HTML, CSS, and JavaScript.
No dependency installation or build step is required.

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

Run `node --test tests/*.test.cjs` to check settings validation, speed cycling, and content script behavior.

## Support

Report bugs and suggest features through [GitHub Issues](https://github.com/yatmsu/dopatube/issues).
For bug reports, include your Chrome version, steps to reproduce the issue, and the expected and actual behavior.

## License

[MIT License](LICENSE)
