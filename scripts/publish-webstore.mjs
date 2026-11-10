import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { fail, info, setSecret, withGroup, writeSummary } from "./actions.mjs";

const api = "https://chromewebstore.googleapis.com";
const uploadTimeout = () =>
  new Error(
    "Upload failed or did not finish within five minutes. Check the Developer Dashboard; no publish request was sent.",
  );
const accepted = new Set([
  "PENDING_REVIEW",
  "STAGED",
  "PUBLISHED",
  "PUBLISHED_TO_TESTERS",
]);
const knownStates = new Set([...accepted, "REJECTED", "CANCELLED"]);
const versions = (revision) =>
  (revision?.distributionChannels ?? []).map((channel) => channel.crxVersion);

export function submissionDecision(status, version) {
  if (status.takenDown || status.warned)
    throw new Error(
      "Store policy warning: check the Developer Dashboard before releasing.",
    );
  const published = status.publishedItemRevisionStatus;
  const submitted = status.submittedItemRevisionStatus;
  for (const revision of [published, submitted]) {
    if (versions(revision).includes(version) && accepted.has(revision?.state))
      return revision.state;
  }
  if (submitted && ["PENDING_REVIEW", "STAGED"].includes(submitted.state))
    throw new Error(
      "Another submission is pending or staged. Resolve it in the Developer Dashboard first.",
    );
  if (
    submitted &&
    versions(submitted).includes(version) &&
    ["REJECTED", "CANCELLED"].includes(submitted.state)
  )
    throw new Error(
      "This version was rejected or cancelled. Check the Developer Dashboard and prepare a new version.",
    );
  const target = version.split(".").map(Number);
  const compare = (value) => {
    const parts = value.split(".").map(Number);
    for (let i = 0; i < Math.max(parts.length, target.length); i++) {
      const delta = (parts[i] ?? 0) - (target[i] ?? 0);
      if (delta) return delta;
    }
    return 0;
  };
  if (
    [...versions(published), ...versions(submitted)].some(
      (v) => typeof v === "string" && compare(v) >= 0,
    )
  )
    throw new Error(
      "Store already contains this version or a newer version. Use a new release version.",
    );
  return undefined;
}

export async function runWebStore({
  mode,
  version,
  archive,
  env = process.env,
  fetchImpl = fetch,
  wait = sleep,
  log = info,
  pollAttempts = 60,
  now = () => performance.now(),
}) {
  if (!["status", "upload", "publish"].includes(mode))
    throw new Error("Mode must be status, upload or publish.");
  const required = [
    "CWS_CLIENT_ID",
    "CWS_CLIENT_SECRET",
    "CWS_REFRESH_TOKEN",
    "CWS_PUBLISHER_ID",
    "CWS_EXTENSION_ID",
  ];
  for (const key of required)
    if (!env[key]?.trim())
      throw new Error(`Missing Environment secret: ${key}`);
  if (!/^[a-p]{32}$/.test(env.CWS_EXTENSION_ID))
    throw new Error("Invalid CWS_EXTENSION_ID.");
  if (!/^[A-Za-z0-9_-]+$/.test(env.CWS_PUBLISHER_ID))
    throw new Error("Invalid CWS_PUBLISHER_ID.");
  if (
    mode !== "status" &&
    (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? "") ||
      !archive)
  )
    throw new Error(
      "Upload and publish require a release version and archive.",
    );

  if (env.CWS_EXTENSION_ID !== "kjaphodjmimipehdghlmcpecnchfcoii")
    throw new Error("CWS_EXTENSION_ID must identify the published DopaTube extension.");

  const remainingTime = (deadline) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw uploadTimeout();
    return remaining;
  };

  // Do not include raw API bodies or fetch errors: either can echo credentials.
  const request = async (url, options, label, deadline = Infinity) => {
    const remaining = remainingTime(deadline);
    const signal = AbortSignal.timeout(Math.min(120_000, Math.ceil(remaining)));
    const checkDeadline = () => {
      // Account for timer rounding when this request is bounded by the overall deadline.
      if (signal.aborted && remaining <= 120_000) throw uploadTimeout();
      remainingTime(deadline);
    };
    const networkError = () =>
      new Error(
        `${label}: network error or timeout. Check store status before retrying a write.`,
      );
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        redirect: "error",
        signal,
      });
    } catch {
      checkDeadline();
      throw networkError();
    }
    checkDeadline();
    let data;
    try {
      data = await response.json();
    } catch {
      checkDeadline();
      if (signal.aborted) throw networkError();
      throw new Error(
        `${label}: invalid JSON response (HTTP ${response.status}).`,
      );
    }
    checkDeadline();
    if (!response.ok || data.error) {
      const hint =
        label === "OAuth token" && data.error === "invalid_grant"
          ? " Refresh Token expired or revoked; regenerate it and update CWS_REFRESH_TOKEN."
          : " Check API access and the Developer Dashboard.";
      throw new Error(`${label}: HTTP ${response.status}.${hint}`);
    }
    return data;
  };
  const token = await request(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      body: new URLSearchParams({
        client_id: env.CWS_CLIENT_ID,
        client_secret: env.CWS_CLIENT_SECRET,
        refresh_token: env.CWS_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    },
    "OAuth token",
  );
  if (
    typeof token.access_token !== "string" ||
    !token.access_token ||
    /[\r\n]/.test(token.access_token)
  )
    throw new Error("OAuth did not return an access token.");
  if (env.GITHUB_ACTIONS === "true") setSecret(token.access_token);
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const name = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;
  const getStatus = async (deadline) => {
    const status = await request(
      `${api}/v2/${name}:fetchStatus`,
      { headers },
      "Fetch store status",
      deadline,
    );
    if (status.itemId !== env.CWS_EXTENSION_ID || status.name !== name)
      throw new Error("Store status did not identify the expected extension.");
    for (const revision of [
      status.publishedItemRevisionStatus,
      status.submittedItemRevisionStatus,
    ]) {
      if (
        revision &&
        (!knownStates.has(revision.state) ||
          !Array.isArray(revision.distributionChannels) ||
          !versions(revision).length ||
          versions(revision).some((v) => !/^\d+(?:\.\d+){0,3}$/.test(v ?? "")))
      )
        throw new Error(
          "Unexpected revision status. Check the Developer Dashboard before releasing.",
        );
    }
    return status;
  };
  const status = await getStatus();
  const summary = (revision) => ({
    state: revision?.state ?? "NONE",
    versions: versions(revision),
  });
  log(
    `Authentication succeeded. Published: ${JSON.stringify(summary(status.publishedItemRevisionStatus))}; submitted: ${JSON.stringify(summary(status.submittedItemRevisionStatus))}.`,
  );
  if (mode === "status") return { outcome: "status-checked" };
  const existing = submissionDecision(status, version);
  if (existing) {
    log(
      `Version ${version} already has state ${existing}; no upload or submission performed.`,
    );
    return { outcome: "already-submitted", state: existing };
  }
  if (
    ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"].includes(status.lastAsyncUploadState)
  )
    throw new Error(
      "A store upload is already in progress. Wait for it to finish before retrying.",
    );
  const body = await readFile(archive);
  // A single monotonic deadline covers the upload request, response bodies,
  // poll requests and sleeps. Authentication and review submission are separate.
  const uploadDeadline = now() + 300_000;
  let upload = await request(
    `${api}/upload/v2/${name}:upload`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/zip" },
      body,
    },
    "Upload package",
    uploadDeadline,
  );
  if (
    (upload.crxVersion && upload.crxVersion !== version) ||
    (upload.uploadState === "SUCCEEDED" && upload.crxVersion !== version)
  )
    throw new Error(
      "Uploaded archive version differs from the requested version.",
    );
  let uploadState = upload.uploadState;
  // The guide also uses UPLOAD_IN_PROGRESS; accept it alongside the v2 enum.
  for (
    let i = 0;
    ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"].includes(uploadState) &&
    i < pollAttempts;
    i++
  ) {
    await wait(Math.min(5000, remainingTime(uploadDeadline)));
    remainingTime(uploadDeadline);
    upload = await getStatus(uploadDeadline);
    uploadState = upload.lastAsyncUploadState;
  }
  remainingTime(uploadDeadline);
  if (uploadState !== "SUCCEEDED") throw uploadTimeout();
  log(`Package ${version} uploaded successfully.`);
  if (mode === "upload") return { outcome: "uploaded" };
  const latest = await getStatus();
  const changed = submissionDecision(latest, version);
  if (changed) return { outcome: "already-submitted", state: changed };
  const published = await request(
    `${api}/v2/${name}:publish`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        publishType: "DEFAULT_PUBLISH",
        skipReview: false,
        blockOnWarnings: true,
      }),
    },
    "Submit for review",
  );
  if (!accepted.has(published.state))
    throw new Error(
      "Unexpected submission state. Check the Developer Dashboard before retrying.",
    );
  log(
    `Store submission accepted: ${published.state}. Review approval is managed by Google.`,
  );
  return { outcome: "submitted", state: published.state };
}

async function main() {
  const [mode, version, archive] = process.argv.slice(2);
  const result = await withGroup("Chrome Web Store operation", () =>
    runWebStore({ mode, version, archive }),
  );
  await writeSummary(
    "Chrome Web Store",
    [
      ["Mode", mode],
      ["Result", result.outcome],
      ["State", result.state ?? "N/A"],
    ],
    "A successful submission does not mean review has completed.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(async (error) => {
    fail(error.message);
    await writeSummary(
      "Chrome Web Store",
      [["Result", "Failed"]],
      "See the step log and Developer Dashboard before retrying.",
    );
  });
}
