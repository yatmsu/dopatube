# Release automation

The Release workflow uses Chrome Web Store API v2 and OAuth refresh-token authentication, adapted from Re:bookmarks. It creates a GitHub Release and submits the extension for review when a stable version tag is pushed. Google publishes the update after approval. Store descriptions, screenshots, and privacy declarations remain managed in the Chrome Web Store Developer Dashboard.

## Credentials

The `webstore` job references the `chrome-web-store` GitHub Environment and receives these Actions secrets only in its final API step:

| Secret | Value |
| --- | --- |
| `CWS_CLIENT_ID` | OAuth client ID |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | Refresh token authorized by the publisher account |
| `CWS_PUBLISHER_ID` | Publisher ID from the Web Store dashboard |
| `CWS_EXTENSION_ID` | `kjaphodjmimipehdghlmcpecnchfcoii` (DopaTube) |

Repository-level Actions secrets are also available to this job. If the same names exist in the Environment, the Environment values take precedence. The five repository-level secret names were confirmed during implementation; their values and live store authentication were not inspected or tested.

Use a Google account with two-step verification and the Chrome Web Store API enabled. If configuring new credentials, follow the [official API guide](https://developer.chrome.com/docs/webstore/using-api) using the `https://www.googleapis.com/auth/chromewebstore` scope. For an external OAuth app used for ongoing releases, use the OAuth app's In production status; refresh tokens for external Testing apps generally expire after seven days for this scope. This OAuth setting is separate from publishing the extension.

Keep credentials out of source files, command arguments, issues, and logs. The workflow generates and masks access tokens at runtime. The extension itself receives no release credentials. The publisher script rejects a different extension ID before any HTTP request, preventing an accidental release to Re:bookmarks or another item.

## First-run verification

1. Commit and push the workflow, scripts, lockfile, tests, and documentation to `main`.
2. In GitHub Actions, open **Release → Run workflow**, select `main`, choose `package`, and leave `tag` empty. Verify that the ZIP and checksum artifact is available.
3. Run again with `status`. This exchanges the OAuth token and reads the store status; it performs no store upload or review submission. The prerequisite package/test job still runs.
4. Use a new manifest version and tag for the first automated submission. Do not recreate or move an old release tag.

Local validation alone does not prove that GitHub or Google authentication succeeds. The workflow must be pushed before manual runs are available. No live upload, submission, GitHub Release creation, or workflow run was performed during local implementation.

## Normal release

1. Update the `version` in root `manifest.json`. It is the only extension version authority; npm metadata is tooling-only.
2. Add a matching nonempty `## MAJOR.MINOR.PATCH` section to `CHANGELOG.md`, moving the applicable Unreleased changes into it.
3. Validate locally using the Node.js version in `.node-version`:

   ```sh
   npm ci --ignore-scripts
   npm test
   npm run release:package
   git diff --check
   ```

4. Commit the release changes and push `main`. Create and push the corresponding tag. For example, only after setting the manifest and changelog to `1.1.1`:

   ```sh
   git push origin main
   git tag -a v1.1.1 -m "Release v1.1.1"
   git push origin refs/tags/v1.1.1
   ```

5. The Release workflow verifies tag/version agreement and that the commit belongs to `origin/main`, runs all tests, and creates a deterministic ZIP from source resources.
6. The `github_release` job downloads the artifact by its exact artifact ID, verifies its SHA-256 and all source bytes, and creates or verifies the GitHub Release with the ZIP and checksum. Existing assets with different bytes are never overwritten.
7. The `webstore` job verifies the same artifact, authenticates, checks the current store state, uploads, waits for processing, and submits for review using `DEFAULT_PUBLISH`, `skipReview: false`, and `blockOnWarnings: true`.
8. Check the Actions summary and Developer Dashboard for the outcome. **Workflow success means review submission was accepted or the version was already submitted/published; it does not mean Google has completed review.**

Normal branch pushes and pull requests run CI with no store credentials or publication. GitHub Release creation precedes the store submission, so a visible GitHub Release is not proof that a store update was accepted.

## Manual modes

Run from `main` or a release tag. The `tag` input must name an existing stable tag contained in `origin/main`; its version must match the manifest.

| Mode | Tag required | GitHub Release | Store operation |
| --- | --- | --- | --- |
| `package` | No | None | None; ZIP/checksum artifact only |
| `status` | No | None | OAuth token exchange and status read only |
| `upload` | Yes | None | Upload and wait for processing; no review submission |
| `publish` | Yes | Create or verify | Upload and submit for review |

Tag pushes select `publish` automatically. Manual `publish` also uploads the ZIP; it is not a submit-only command for an existing dashboard draft. Manual `status` checks the existing published DopaTube item, regardless of the local version.

## Packaging rules

- `manifest.json` is at the ZIP root. Resources are collected from the manifest, local HTML/CSS references, and `_locales/*/messages.json`; LICENSE is included.
- Popup, options page, icons, content scripts, styles, web-accessible logo, and locale files must exist. HTTPS navigation links such as **Open YouTube** are permitted; remote HTML/CSS resource loads and unsupported URL schemes are rejected.
- Tests, docs, npm files, scripts, source artwork, prior archives, credentials, hidden files, and symlink resources are not packaged. Only referenced runtime assets and locale catalogs are collected from the source tree.
- The archive is deterministic across source timestamps and time zones. Downloading jobs check its SHA-256 and compare every included file to the checked-out source before making an external write.
- Local output is `releases/dopatube-VERSION.zip`, its `.sha256`, and `releases/release-notes.md`. CI artifacts are retained for 30 days; publishing also attaches the ZIP/checksum to the GitHub Release.

## Failures and retries

- Releases are serialized without cancelling active writes. Failed-job reruns download the original successful package artifact by ID.
- The same version already pending review, staged, or published is treated as already submitted; no new upload or submission is made. A staged version is left staged.
- Conflicting pending submissions, rejected/cancelled target versions, newer store versions, policy warnings, and validation warnings stop the operation. Check the dashboard and resolve the underlying issue before retrying; do not disable the warnings guard merely to make the workflow pass.
- Upload processing has an overall five-minute limit. HTTP/network errors and ambiguous write outcomes are not retried automatically. Use `status` and the dashboard to determine what happened first.
- If upload succeeded but submission failed, inspect the existing draft and dashboard validation messages. You can finish required listing/privacy fields and submit the draft manually; there is no need to blindly upload again.
- `invalid_grant` means the refresh token expired or was revoked. Replace `CWS_REFRESH_TOKEN` in the appropriate secret scope. API response bodies are deliberately not dumped to logs because they can include sensitive information; inspect dashboard validation details when a request fails.

## Workflow maintenance

All third-party Actions are pinned to full commit SHAs and checkout credentials are not persisted. Only `github_release` has `contents: write`; the packaging and store jobs have `contents: read`. Dependabot checks Action pins and release-tooling dependencies weekly. Behavioral workflow tests evaluate the actual YAML conditions using GitHub's expression parser.

Run `actionlint .github/workflows/*.yml` when a compatible version is available. The local actionlint 1.7.12 used during implementation does not yet recognize GitHub's documented `concurrency.queue: max`. Its other checks were run with only that diagnostic ignored; the queue setting is also asserted by the workflow tests. See [GitHub concurrency syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).
