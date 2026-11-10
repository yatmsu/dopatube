import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runWebStore,
  submissionDecision,
} from "../scripts/publish-webstore.mjs";

const env = {
  CWS_CLIENT_ID: "client-id",
  CWS_CLIENT_SECRET: "private-client-secret",
  CWS_REFRESH_TOKEN: "private-refresh-token",
  CWS_PUBLISHER_ID: "publisher",
  CWS_EXTENSION_ID: "kjaphodjmimipehdghlmcpecnchfcoii",
};
const version = "0.10.0";
const name = `publishers/publisher/items/${env.CWS_EXTENSION_ID}`;
const revision = (state, v = version) => ({
  state,
  distributionChannels: [{ crxVersion: v }],
});
const status = (extra = {}) => ({
  name,
  itemId: env.CWS_EXTENSION_ID,
  publishedItemRevisionStatus: revision("PUBLISHED", "0.9.0"),
  ...extra,
});
const token = { access_token: "private-access-token" };
const upload = { uploadState: "SUCCEEDED", crxVersion: version };

function client(replies) {
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    options: {
      env,
      log: (value) => logs.push(value),
      wait: async () => {},
      fetchImpl: async (url, options) => {
        calls.push({ url, ...options });
        assert.ok(replies.length, `Unexpected HTTP call: ${url}`);
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return new Response(JSON.stringify(reply.body ?? reply), {
          status: reply.http ?? 200,
        });
      },
    },
  };
}

async function archiveFor(t) {
  const directory = await mkdtemp(join(tmpdir(), "webstore-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = join(directory, "release.zip");
  await writeFile(archive, "zip fixture bytes");
  return archive;
}

test("status mode exchanges credentials and performs no store write or token logging", async () => {
  const mock = client([token, status()]);
  assert.deepEqual(await runWebStore({ mode: "status", ...mock.options }), {
    outcome: "status-checked",
  });
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(mock.calls[0].body.get("refresh_token"), env.CWS_REFRESH_TOKEN);
  assert.equal(
    mock.calls[1].url,
    `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`,
  );
  assert.equal(
    mock.calls[1].headers.Authorization,
    `Bearer ${token.access_token}`,
  );
  assert.ok(!mock.logs.join(" ").includes(token.access_token));
});

test("publish uploads exact bytes before a review submission using v2", async (t) => {
  const archive = await archiveFor(t);
  const mock = client([
    token,
    status(),
    upload,
    status(),
    { state: "PENDING_REVIEW" },
  ]);
  assert.deepEqual(
    await runWebStore({ mode: "publish", version, archive, ...mock.options }),
    { outcome: "submitted", state: "PENDING_REVIEW" },
  );
  assert.equal(
    mock.calls[2].url,
    `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`,
  );
  assert.equal(mock.calls[2].body.toString(), "zip fixture bytes");
  assert.equal(
    mock.calls[4].url,
    `https://chromewebstore.googleapis.com/v2/${name}:publish`,
  );
  assert.deepEqual(JSON.parse(mock.calls[4].body), {
    publishType: "DEFAULT_PUBLISH",
    skipReview: false,
    blockOnWarnings: true,
  });
});

test("upload mode polls async uploads and never submits", async (t) => {
  const mock = client([
    token,
    status(),
    { uploadState: "IN_PROGRESS" },
    status({ lastAsyncUploadState: "IN_PROGRESS" }),
    status({ lastAsyncUploadState: "SUCCEEDED" }),
  ]);
  assert.deepEqual(
    await runWebStore({
      mode: "upload",
      version,
      archive: await archiveFor(t),
      ...mock.options,
    }),
    { outcome: "uploaded" },
  );
  assert.ok(!mock.calls.some((call) => call.url.endsWith(":publish")));
});

test("slow polls share a five-minute deadline and cap each HTTP timeout", async (t) => {
  let elapsed = 0;
  let polling = false;
  let polls = 0;
  const timeouts = [];
  const calls = [];
  t.mock.method(AbortSignal, "timeout", (ms) => {
    timeouts.push(ms);
    return new AbortController().signal;
  });
  await assert.rejects(
    runWebStore({
      mode: "publish",
      version,
      archive: await archiveFor(t),
      env,
      log: () => {},
      now: () => elapsed,
      wait: async (ms) => {
        elapsed += ms;
      },
      fetchImpl: async (url) => {
        calls.push(url);
        if (url.includes("oauth2.googleapis.com")) return Response.json(token);
        if (url.endsWith(":upload")) {
          polling = true;
          return Response.json({ uploadState: "IN_PROGRESS" });
        }
        if (polling) {
          polls++;
          // Each response takes 110 seconds unless its request budget expires first.
          elapsed += Math.min(110_000, timeouts.at(-1));
          return Response.json(status({ lastAsyncUploadState: "IN_PROGRESS" }));
        }
        return Response.json(status());
      },
    }),
    /within five minutes/,
  );
  assert.equal(elapsed, 300_000);
  assert.equal(polls, 3);
  assert.deepEqual(timeouts.slice(-3), [120_000, 120_000, 65_000]);
  assert.ok(!calls.some((url) => url.endsWith(":publish")));
});

test("the final sleep uses only the remaining budget and starts no late poll", async (t) => {
  let elapsed = 0;
  let polls = 0;
  let uploaded = false;
  const waits = [];
  const calls = [];
  await assert.rejects(
    runWebStore({
      mode: "publish",
      version,
      archive: await archiveFor(t),
      env,
      log: () => {},
      now: () => elapsed,
      wait: async (ms) => {
        waits.push(ms);
        elapsed += ms;
      },
      fetchImpl: async (url) => {
        calls.push(url);
        if (url.includes("oauth2.googleapis.com")) return Response.json(token);
        if (url.endsWith(":upload")) {
          uploaded = true;
          elapsed += 115_000;
          return Response.json({ uploadState: "IN_PROGRESS" });
        }
        if (uploaded) {
          polls++;
          assert.ok(
            polls <= 2,
            "No status request may start after the deadline",
          );
          elapsed += polls === 1 ? 90_000 : 84_000;
          return Response.json(status({ lastAsyncUploadState: "IN_PROGRESS" }));
        }
        return Response.json(status());
      },
    }),
    /within five minutes/,
  );
  assert.equal(elapsed, 300_000);
  assert.deepEqual(waits, [5000, 5000, 1000]);
  assert.equal(calls.length, 5);
});

test("response body time counts toward the deadline even when upload succeeds", async (t) => {
  let elapsed = 0;
  let uploaded = false;
  let polls = 0;
  const mock = client([
    token,
    status(),
    { uploadState: "IN_PROGRESS" },
    status({ lastAsyncUploadState: "IN_PROGRESS" }),
    status({ lastAsyncUploadState: "SUCCEEDED" }),
    status(),
    { state: "PENDING_REVIEW" },
  ]);
  const fetchImpl = mock.options.fetchImpl;
  await assert.rejects(
    runWebStore({
      ...mock.options,
      mode: "publish",
      version,
      archive: await archiveFor(t),
      now: () => elapsed,
      wait: async (ms) => {
        elapsed += ms;
      },
      fetchImpl: async (url, options) => {
        const response = await fetchImpl(url, options);
        if (url.endsWith(":upload")) {
          uploaded = true;
          elapsed += 100_000;
        } else if (uploaded && url.endsWith(":fetchStatus")) {
          polls++;
          if (polls === 2) elapsed += 100_000;
          const json = response.json.bind(response);
          response.json = async () => {
            elapsed += polls === 1 ? 80_000 : 10_000;
            return json();
          };
        }
        return response;
      },
    }),
    /within five minutes/,
  );
  assert.equal(elapsed, 300_000);
  assert.ok(!mock.calls.some((call) => call.url.endsWith(":publish")));
});

test("aborting a response body at the deadline reports a safe timeout", async (t) => {
  let elapsed = 0;
  let polling = false;
  let polls = 0;
  let controller;
  let budget;
  const calls = [];
  t.mock.method(AbortSignal, "timeout", (ms) => {
    controller = new AbortController();
    budget = ms;
    return controller.signal;
  });
  await assert.rejects(
    runWebStore({
      mode: "publish",
      version,
      archive: await archiveFor(t),
      env,
      log: () => {},
      now: () => elapsed,
      wait: async (ms) => {
        elapsed += ms;
      },
      fetchImpl: async (url, options) => {
        calls.push(url);
        if (url.includes("oauth2.googleapis.com")) return Response.json(token);
        if (url.endsWith(":upload")) {
          polling = true;
          return Response.json({ uploadState: "IN_PROGRESS" });
        }
        if (!polling) return Response.json(status());
        polls++;
        if (polls < 3) {
          elapsed += 110_000;
          return Response.json(status({ lastAsyncUploadState: "IN_PROGRESS" }));
        }
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve, reject) => {
              options.signal.addEventListener(
                "abort",
                () => reject(new Error(env.CWS_REFRESH_TOKEN)),
                { once: true },
              );
              queueMicrotask(() => {
                elapsed += budget;
                controller.abort();
              });
            }),
        };
      },
    }),
    (error) => {
      assert.match(error.message, /within five minutes/);
      assert.ok(!error.message.includes(env.CWS_REFRESH_TOKEN));
      return true;
    },
  );
  assert.equal(elapsed, 300_000);
  assert.equal(budget, 65_000);
  assert.ok(!calls.some((url) => url.endsWith(":publish")));
});

test("same version pending, staged or published makes re-runs read-only", async () => {
  for (const state of [
    "PENDING_REVIEW",
    "STAGED",
    "PUBLISHED",
    "PUBLISHED_TO_TESTERS",
  ]) {
    const mock = client([
      token,
      status({ submittedItemRevisionStatus: revision(state) }),
    ]);
    const result = await runWebStore({
      mode: "publish",
      version,
      archive: "unused.zip",
      ...mock.options,
    });
    assert.equal(result.outcome, "already-submitted");
    assert.equal(mock.calls.length, 2);
  }
});

test("different pending versions, newer versions and policy problems block writes", () => {
  for (const data of [
    status({
      submittedItemRevisionStatus: revision("PENDING_REVIEW", "0.11.0"),
    }),
    status({ submittedItemRevisionStatus: revision("STAGED", "0.11.0") }),
    status({ publishedItemRevisionStatus: revision("PUBLISHED", "1.0.0") }),
    status({ submittedItemRevisionStatus: revision("REJECTED") }),
    status({ submittedItemRevisionStatus: revision("CANCELLED") }),
    status({ takenDown: true }),
    status({ warned: true }),
  ])
    assert.throws(() => submissionDecision(data, version));
});

test("failed, unknown and timed-out uploads never publish", async (t) => {
  const archive = await archiveFor(t);
  for (const state of ["FAILED", "NOT_FOUND", "UNEXPECTED", "IN_PROGRESS"]) {
    const mock = client([token, status(), { uploadState: state }]);
    await assert.rejects(
      runWebStore({
        mode: "publish",
        version,
        archive,
        pollAttempts: 0,
        ...mock.options,
      }),
      /Upload failed/,
    );
    assert.equal(mock.calls.length, 3);
  }
});

test("wrong uploaded version stops before publish", async (t) => {
  const mock = client([token, status(), { ...upload, crxVersion: "0.9.0" }]);
  await assert.rejects(
    runWebStore({
      mode: "publish",
      version,
      archive: await archiveFor(t),
      ...mock.options,
    }),
    /version differs/,
  );
});

test("OAuth and HTTP failures do not expose credentials or raw responses", async () => {
  const mock = client([
    {
      http: 400,
      body: {
        error: "invalid_grant",
        error_description: env.CWS_REFRESH_TOKEN,
      },
    },
  ]);
  await assert.rejects(
    runWebStore({ mode: "status", ...mock.options }),
    (error) => {
      assert.match(error.message, /expired or revoked/);
      assert.ok(!error.message.includes(env.CWS_REFRESH_TOKEN));
      return true;
    },
  );
  const broken = client([new Error(env.CWS_CLIENT_SECRET)]);
  await assert.rejects(
    runWebStore({ mode: "status", ...broken.options }),
    (error) => !error.message.includes(env.CWS_CLIENT_SECRET),
  );
});

test("missing secrets and invalid extension IDs fail before HTTP", async () => {
  const mock = client([]);
  for (const key of Object.keys(env))
    await assert.rejects(
      runWebStore({
        mode: "status",
        ...mock.options,
        env: { ...env, [key]: "" },
      }),
      /Missing Environment secret/,
    );
  await assert.rejects(
    runWebStore({
      mode: "status",
      ...mock.options,
      env: { ...env, CWS_EXTENSION_ID: "invalid" },
    }),
    /Invalid CWS_EXTENSION_ID/,
  );
  assert.equal(mock.calls.length, 0);
});

test("unrecognized status and concurrent store changes prevent publishing", async (t) => {
  const invalid = client([token, {}]);
  await assert.rejects(
    runWebStore({ mode: "status", ...invalid.options }),
    /expected extension/,
  );
  const archive = await archiveFor(t);
  const mock = client([
    token,
    status(),
    upload,
    status({
      submittedItemRevisionStatus: revision("PENDING_REVIEW", "0.11.0"),
    }),
  ]);
  await assert.rejects(
    runWebStore({ mode: "publish", version, archive, ...mock.options }),
    /Another submission/,
  );
  assert.equal(mock.calls.length, 4);
});

test("ambiguous write errors are not retried blindly", async (t) => {
  const mock = client([token, status(), new Error("socket closed")]);
  await assert.rejects(
    runWebStore({
      mode: "publish",
      version,
      archive: await archiveFor(t),
      ...mock.options,
    }),
    /Check store status/,
  );
  assert.equal(mock.calls.length, 3);
});

test("another extension's valid ID cannot be used accidentally", async () => {
  await assert.rejects(runWebStore({ mode: "status", env: { ...env, CWS_EXTENSION_ID: "ldfjicmbmelkdnggkdpkgjdenbpgenec" }, fetchImpl: () => assert.fail("No HTTP request is allowed") }), /must identify the published DopaTube/);
});
