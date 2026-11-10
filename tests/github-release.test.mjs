import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRelease } from "../scripts/github-release.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "github-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = join(directory, "dopatube-0.10.0.zip");
  await writeFile(archive, "same zip");
  await writeFile(`${archive}.sha256`, "checksum");
  return {
    tag: "v0.10.0",
    archive,
    notes: "notes.md",
    repository: "yatmsu/dopatube",
    token: "test-token",
  };
}

test("missing GitHub Release is created against an existing tag with both assets", async (t) => {
  const options = await fixture(t);
  const calls = [];
  assert.equal(
    await ensureRelease({
      ...options,
      fetchImpl: async () => new Response("", { status: 404 }),
      gh: (args) => calls.push(args),
    }),
    "created",
  );
  assert.deepEqual(calls[0].slice(0, 5), [
    "release",
    "create",
    options.tag,
    options.archive,
    `${options.archive}.sha256`,
  ]);
  assert.ok(calls[0].includes("--verify-tag"));
});

test("existing equal assets are verified and never re-uploaded", async (t) => {
  const options = await fixture(t);
  const calls = [];
  const result = await ensureRelease({
    ...options,
    fetchImpl: async () =>
      Response.json({
        assets: [
          { name: "dopatube-0.10.0.zip" },
          { name: "dopatube-0.10.0.zip.sha256" },
        ],
      }),
    gh: (args) => {
      calls.push(args);
      const name = args[args.indexOf("--pattern") + 1];
      writeFileSync(
        join(args.at(-1), name),
        name.endsWith(".sha256") ? "checksum" : "same zip",
      );
    },
  });
  assert.equal(result, "verified");
  assert.ok(calls.every((args) => args[1] === "download"));
});

test("different existing asset fails without overwriting it", async (t) => {
  const options = await fixture(t);
  const calls = [];
  await assert.rejects(
    ensureRelease({
      ...options,
      fetchImpl: async () =>
        Response.json({ assets: [{ name: "dopatube-0.10.0.zip" }] }),
      gh: (args) => {
        calls.push(args);
        writeFileSync(
          join(args.at(-1), "dopatube-0.10.0.zip"),
          "different zip",
        );
      },
    }),
    /will not be overwritten/,
  );
  assert.equal(calls.length, 1);
});

test("permission errors cannot be mistaken for a missing release", async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    ensureRelease({
      ...options,
      fetchImpl: async () => new Response("", { status: 403 }),
      gh: () => assert.fail("must not mutate"),
    }),
    /HTTP 403/,
  );
});
