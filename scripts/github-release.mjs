import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fail, info, withGroup, writeSummary } from "./actions.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function ensureRelease({
  tag,
  archive,
  notes,
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GH_TOKEN,
  fetchImpl = fetch,
  gh = (args) =>
    execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
}) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag ?? ""))
    throw new Error("A stable release tag is required.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") || !token)
    throw new Error("GitHub repository and token are required.");
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    },
  );
  if (response.status === 404) {
    gh([
      "release",
      "create",
      tag,
      archive,
      `${archive}.sha256`,
      "--repo",
      repository,
      "--verify-tag",
      "--title",
      tag,
      "--notes-file",
      notes,
    ]);
    return "created";
  }
  if (!response.ok)
    throw new Error(`Cannot inspect GitHub Release (HTTP ${response.status}).`);
  const release = await response.json();
  if (release.draft || release.prerelease)
    throw new Error(
      "Existing release is a draft or prerelease; resolve it before retrying.",
    );
  const directory = await mkdtemp(join(tmpdir(), "dopatube-release-"));
  try {
    for (const path of [archive, `${archive}.sha256`]) {
      const name = basename(path);
      if (release.assets.some((asset) => asset.name === name)) {
        gh([
          "release",
          "download",
          tag,
          "--repo",
          repository,
          "--pattern",
          name,
          "--dir",
          directory,
        ]);
        if (
          digest(await readFile(join(directory, name))) !==
          digest(await readFile(path))
        )
          throw new Error(
            "Existing release asset differs from this build. It will not be overwritten.",
          );
      } else {
        gh(["release", "upload", tag, path, "--repo", repository]);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return "verified";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [tag, archive, notes] = process.argv.slice(2);
  withGroup("Create or verify GitHub Release", () =>
    ensureRelease({ tag, archive, notes }),
  )
    .then(async (result) => {
      info(`GitHub Release ${result}.`);
      await writeSummary("GitHub Release", [
        ["Tag", tag],
        ["Result", result],
      ]);
    })
    .catch(async () => {
      fail(
        "GitHub Release failed. Check permissions and existing assets; no existing assets were overwritten.",
      );
      await writeSummary(
        "GitHub Release",
        [["Result", "Failed"]],
        "Check permissions and existing release assets before retrying.",
      );
    });
}
