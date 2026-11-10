import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { parse } from "yaml";
import { Lexer, Parser, Evaluator, data } from "@actions/expressions";

const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
const release = parse(
  await readFile(new URL("release.yml", workflowDirectory), "utf8"),
);

function expressionData(value) {
  if (value === null || value === undefined) return new data.Null();
  if (typeof value === "string") return new data.StringData(value);
  if (typeof value === "number") return new data.NumberData(value);
  if (typeof value === "boolean") return new data.BooleanData(value);
  return new data.Dictionary(
    ...Object.entries(value).map(([key, v]) => ({
      key,
      value: expressionData(v),
    })),
  );
}

// Evaluate the expressions from the actual YAML using GitHub's own parser,
// rather than implementing a second copy of the mode/needs conditions.
function evaluate(expression, context, cancelled = false) {
  const source = expression
    .trim()
    .replace(/^\$\{\{\s*/, "")
    .replace(/\s*\}\}$/, "");
  const cancelledFunction = {
    name: "cancelled",
    minArgs: 0,
    maxArgs: 0,
    call: () => new data.BooleanData(cancelled),
  };
  const ast = new Parser(new Lexer(source).lex().tokens, Object.keys(context), [
    cancelledFunction,
  ]).parse();
  return new Evaluator(
    ast,
    expressionData(context),
    new Map([["cancelled", cancelledFunction]]),
  )
    .evaluate()
    .coerceString();
}

function context(
  mode,
  {
    event = "workflow_dispatch",
    packageResult = "success",
    githubResult = mode === "publish" ? "success" : "skipped",
    ref = "refs/heads/main",
  } = {},
) {
  return {
    github: { event_name: event, ref },
    inputs: { mode },
    needs: {
      package: { result: packageResult },
      github_release: { result: githubResult },
    },
  };
}

test("release modes select only their intended jobs", () => {
  for (const [mode, githubRelease, webstore] of [
    ["package", "false", "false"],
    ["status", "false", "true"],
    ["upload", "false", "true"],
    ["publish", "true", "true"],
  ]) {
    const ctx = context(mode);
    assert.equal(
      evaluate(release.jobs.github_release.if, ctx),
      githubRelease,
      mode,
    );
    assert.equal(evaluate(release.jobs.webstore.if, ctx), webstore, mode);
  }
  const tagPush = context("", {
    event: "push",
    githubResult: "success",
    ref: "refs/tags/v0.10.0",
  });
  assert.equal(evaluate(release.jobs.github_release.if, tagPush), "true");
  assert.equal(evaluate(release.jobs.webstore.if, tagPush), "true");
  assert.equal(
    evaluate(
      release.jobs.package.if,
      context("publish", { ref: "refs/heads/feature" }),
    ),
    "false",
  );
});

test("release concurrency keeps pending runs without cancelling active runs", () => {
  assert.equal(release.concurrency.queue, "max");
  assert.equal(release.concurrency["cancel-in-progress"], false);
});

test("manual tag input takes precedence consistently over the workflow ref", () => {
  const checkout = release.jobs.package.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  for (const { event, refType, refName, tag, expectedTag, expectedRef } of [
    {
      event: "workflow_dispatch",
      refType: "tag",
      refName: "v0.10.0",
      tag: "v0.11.0",
      expectedTag: "v0.11.0",
      expectedRef: "v0.11.0",
    },
    {
      event: "workflow_dispatch",
      refType: "branch",
      refName: "main",
      tag: "v0.11.0",
      expectedTag: "v0.11.0",
      expectedRef: "v0.11.0",
    },
    {
      event: "workflow_dispatch",
      refType: "tag",
      refName: "v0.10.0",
      tag: "",
      expectedTag: "v0.10.0",
      expectedRef: "refs/tags/v0.10.0",
    },
    {
      event: "workflow_dispatch",
      refType: "branch",
      refName: "main",
      tag: "",
      expectedTag: "",
      expectedRef: "refs/heads/main",
    },
    {
      event: "push",
      refType: "tag",
      refName: "v0.10.0",
      tag: undefined,
      expectedTag: "v0.10.0",
      expectedRef: "refs/tags/v0.10.0",
    },
  ]) {
    const ctx = {
      github: {
        event_name: event,
        ref_type: refType,
        ref_name: refName,
        ref: `refs/${refType === "tag" ? "tags" : "heads"}/${refName}`,
      },
      inputs: { tag },
    };
    assert.equal(
      evaluate(release.env.RELEASE_TAG, ctx),
      expectedTag,
      JSON.stringify(ctx),
    );
    assert.equal(
      evaluate(checkout.with.ref, ctx),
      expectedRef,
      JSON.stringify(ctx),
    );
  }
});

test("failed, skipped and cancelled dependencies cannot cause store publication", () => {
  for (const packageResult of ["failure", "cancelled", "skipped"]) {
    for (const mode of ["status", "upload", "publish"])
      assert.equal(
        evaluate(release.jobs.webstore.if, context(mode, { packageResult })),
        "false",
      );
  }
  for (const githubResult of ["failure", "cancelled", "skipped"])
    assert.equal(
      evaluate(release.jobs.webstore.if, context("publish", { githubResult })),
      "false",
    );
  for (const mode of ["status", "upload", "publish"])
    assert.equal(
      evaluate(release.jobs.webstore.if, context(mode), true),
      "false",
    );
  assert.deepEqual(release.jobs.webstore.needs, ["package", "github_release"]);
  assert.equal(release.jobs.github_release.needs, "package");
});

test("failed-job re-runs keep the successful build's Artifact ID", () => {
  const upload = release.jobs.package.steps.find(
    (step) => step.id === "upload",
  );
  assert.ok(upload.uses.startsWith("actions/upload-artifact@"));
  const artifactOutput = release.jobs.package.outputs.artifact_id;
  const firstBuildId = evaluate(artifactOutput, {
    steps: { upload: { outputs: { "artifact-id": "101" } } },
  });
  const secondBuildId = evaluate(artifactOutput, {
    steps: { upload: { outputs: { "artifact-id": "202" } } },
  });
  assert.notEqual(firstBuildId, secondBuildId);
  for (const job of [release.jobs.github_release, release.jobs.webstore]) {
    const download = job.steps.find((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    assert.equal(download.with.name, undefined);
    for (const runAttempt of [1, 2, 3]) {
      // Only a failed delivery job is retried: package outputs still describe
      // attempt 1 even though the current run_attempt has increased.
      const ctx = {
        github: { run_attempt: runAttempt },
        needs: { package: { outputs: { artifact_id: firstBuildId } } },
      };
      assert.equal(evaluate(download.with["artifact-ids"], ctx), "101");
      // Re-running the whole workflow uses the newly successful package ID.
      ctx.needs.package.outputs.artifact_id = secondBuildId;
      assert.equal(evaluate(download.with["artifact-ids"], ctx), "202");
    }
    const verify = job.steps.findIndex((step) =>
      step.run?.includes("scripts/package-release.mjs --verify"),
    );
    const mutation = job.steps.findIndex(
      (step) =>
        step.run?.includes("scripts/github-release.mjs") ||
        step.run?.includes("scripts/publish-webstore.mjs"),
    );
    assert.ok(
      verify >= 0 && verify < mutation,
      "Downloaded bytes must be verified before use",
    );
    const verifyStep = job.steps[verify];
    assert.equal(
      evaluate(verifyStep.env.ARCHIVE_SHA256, {
        needs: { package: { outputs: { sha256: "original-hash" } } },
      }),
      "original-hash",
    );
  }
});

test("write permissions and publishing secrets belong to different jobs", () => {
  assert.deepEqual(release.permissions, { contents: "read" });
  for (const [name, job] of Object.entries(release.jobs)) {
    const permissions = job.permissions ?? release.permissions;
    assert.deepEqual(permissions, {
      contents: name === "github_release" ? "write" : "read",
    });
    if (name === "webstore") assert.equal(job.environment, "chrome-web-store");
    else {
      assert.equal(job.environment, undefined);
      assert.ok(!JSON.stringify(job).includes("secrets."));
    }
  }
  const stepsWithSecrets = release.jobs.webstore.steps.filter((step) =>
    JSON.stringify(step).includes("secrets."),
  );
  assert.equal(stepsWithSecrets.length, 1);
  assert.match(stepsWithSecrets[0].run, /scripts\/publish-webstore\.mjs/);
});

test("every workflow Action is pinned to a full SHA with persistent credentials disabled", async () => {
  for (const name of await readdir(workflowDirectory)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const workflow = parse(
      await readFile(new URL(name, workflowDirectory), "utf8"),
    );
    assert.deepEqual(workflow.permissions, { contents: "read" });
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (!step.uses) continue;
        assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
        if (step.uses.startsWith("actions/checkout@"))
          assert.equal(step.with["persist-credentials"], false);
      }
    }
  }
});

test("Dependabot keeps the Action pins and release dependencies updated", async () => {
  const config = parse(
    await readFile(
      new URL("../.github/dependabot.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(config.version, 2);
  const actions = config.updates.find(
    (update) => update["package-ecosystem"] === "github-actions",
  );
  const npm = config.updates.find(
    (update) => update["package-ecosystem"] === "npm",
  );
  assert.equal(actions.directory, "/");
  assert.equal(actions.schedule.interval, "weekly");
  assert.equal(npm.schedule.interval, "weekly");
  for (const name of ["@actions/*", "adm-zip", "yaml"])
    assert.ok(npm.allow.some((item) => item["dependency-name"] === name));
});
