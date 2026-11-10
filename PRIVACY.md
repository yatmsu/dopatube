# DopaTube Privacy Policy

Last updated: November 10, 2026

DopaTube is a Chrome extension that lets you change video playback speed from the YouTube header. This policy explains how the extension handles information.

## Information We Do Not Collect

DopaTube does not collect, store, or transmit personal information such as names, email addresses, account information, authentication credentials, watch history, search history, or browsing history. It does not record video titles, URLs, search terms, or comments.

The extension does not use analytics, serve advertisements, track users, or send data to external servers. The developer does not receive user information through the extension. No information is sold or shared with third parties.

## Processing Within the Page

DopaTube runs on pages matching `https://www.youtube.com/*`. It reads header elements and their positions to place its buttons, and checks the page path and player visibility to determine which player to control. It controls the main player for regular videos, live stream recordings, clips, and Shorts, as well as the visible miniplayer. It does not change the playback speed of previews on the home page or elsewhere.

Playback speed is changed through YouTube's player API within the page. If the player API is unavailable or the change cannot be confirmed, the extension changes the video element's playback speed directly. Requests to the player contain only a numeric playback speed, with no settings data or personal information. This processing takes place within your browser.

The current playback speed is kept only in the open page's memory. It is not saved or synchronized across tabs. Reloading the page or opening a new tab starts playback at 1.0×.

## Settings Storage

Your custom speed cycle and the action for clicking the “ド” logo are saved in the extension's own `chrome.storage.local` using the `storage` permission. These settings are shared by tabs using the same DopaTube installation within the same Chrome profile and are retained across browser restarts. They are not synchronized to your Google account or sent to external servers.

You can reset saved settings to their defaults by choosing **Restore defaults** on the settings page. Uninstalling the extension also removes its saved settings.

## External Services

Clicking **Open YouTube** in the popup opens YouTube in a new tab. DopaTube does not add user information or playback speed information to this link.

YouTube's own handling of information is governed by YouTube's and Google's privacy policies.

## Contact

For questions about this policy, please use [GitHub Issues](https://github.com/yatmsu/dopatube/issues). Issue posts are public, so do not include personal information or authentication credentials. Information you provide on GitHub is handled according to GitHub's privacy policy.

## Changes to This Policy

If our information handling practices change, we will update this policy and its last updated date.
