import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { archiveFiles, buildPackage, releaseVersion, sourceFiles, validateFiles, verifyPackage, versionParts } from "../scripts/package-release.mjs";

const script = fileURLToPath(new URL("../scripts/package-release.mjs", import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "dopatube-package-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const version = "1.1.1";
  const manifest = {
    manifest_version: 3, version, default_locale: "en", description: "__MSG_description__",
    icons: { 16: "assets/icon.png" },
    action: { default_popup: "popup.html", default_icon: { 16: "assets/action.png" } },
    options_ui: { page: "options.html" },
    content_scripts: [{ js: ["content.js"], css: ["content.css"] }],
    web_accessible_resources: [{ resources: ["assets/logo.png"], matches: ["https://www.youtube.com/*"] }],
  };
  const files = {
    "manifest.json": JSON.stringify(manifest), LICENSE: "MIT fixture",
    "assets/icon.png": "icon", "assets/action.png": "action", "assets/logo.png": "logo",
    "popup.html": '<script src="localize.js"></script><a href="https://www.youtube.com/">YouTube</a>',
    "options.html": '<link rel="stylesheet" href="options.css"><script src="options.js"></script>',
    "localize.js": "// translation fixture", "options.css": 'body { background: url("assets/background.png"); }',
    "assets/background.png": "background", "options.js": "// settings fixture", "content.js": "// content fixture", "content.css": "body {}",
    "_locales/en/messages.json": JSON.stringify({ description: { message: "Fixture" } }),
    "_locales/ja/messages.json": JSON.stringify({ description: { message: "テスト" } }),
    "CHANGELOG.md": "# Changelog\n\n## Unreleased\n\n- Next change.\n\n## 1.1.1\n\n- Release test.\n\n## 1.1.0\n\n- Older release.\n",
    "README.md": "not shipped", "private.pem": "not shipped", ".env": "not shipped",
    "package.json": '{"name":"tooling"}', "docs/notes.md": "not shipped", "dist/old.zip": "not shipped",
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return { root, output: join(root, "releases"), tag: `v${version}` };
}

test("package uses root runtime references and locales, without build output or development files", async (t) => {
  const { root, output, tag } = await fixture(t);
  const result = await buildPackage(root, output, tag);
  const files = archiveFiles(await readFile(result.archive));
  assert.equal(files.size, 15);
  for (const name of ["manifest.json", "LICENSE", "popup.html", "options.html", "options.js", "localize.js", "assets/action.png", "assets/logo.png", "assets/background.png", "_locales/en/messages.json", "_locales/ja/messages.json"]) assert.ok(files.has(name), name);
  for (const name of ["README.md", "private.pem", ".env", "package.json", "docs/notes.md", "dist/old.zip", "CHANGELOG.md"]) assert.equal(files.has(name), false, name);
  for (const [name, bytes] of files) assert.deepEqual(bytes, await readFile(join(root, name)));
  assert.equal(await readFile(join(output, "release-notes.md"), "utf8"), "- Release test.\n");
  assert.match(await readFile(`${result.archive}.sha256`, "utf8"), /  dopatube-1\.1\.1\.zip\n$/);
  assert.equal(await verifyPackage(root, result.archive, result.sha256, tag), "1.1.1");
});

test("manifest alone determines release version and the tag must match", async (t) => {
  const { root, output } = await fixture(t);
  assert.equal(await releaseVersion(root), "1.1.1");
  await assert.rejects(buildPackage(root, output, "v1.1.0"), /tag must match/);
  for (const value of ["0.0.0", "01.2.3", "1.2.3-beta", "65536.0.0", "1.2"]) assert.throws(() => versionParts(value));
  assert.deepEqual(versionParts("1.1.1"), [1, 1, 1]);
});

test("missing popup, options, accessible resources, CSS images and translations fail packaging", async (t) => {
  const { root, output } = await fixture(t);
  for (const name of ["popup.html", "options.js", "assets/logo.png", "assets/action.png", "assets/background.png", "_locales/en/messages.json", "_locales/ja/messages.json"]) {
    const bytes = await readFile(join(root, name));
    await rm(join(root, name));
    await assert.rejects(buildPackage(root, output), /ENOENT/);
    await writeFile(join(root, name), bytes);
  }
  const files = await sourceFiles(root);
  files.delete("options.html");
  assert.throws(() => validateFiles(files, "1.1.1"), /Missing manifest resource/);
});

test("ordinary external links are allowed, while remote resources and unsafe URL schemes fail", async (t) => {
  const { root, output } = await fixture(t);
  await buildPackage(root, output);
  for (const html of ['<script src="https://example.com/code.js"></script>', '<link href="//example.com/style.css">', '<a href="javascript:alert(1)">bad</a>', '<img src="https://example.com/pixel.png">']) {
    await writeFile(join(root, "popup.html"), html);
    await assert.rejects(buildPackage(root, output), /Remote or unsupported/);
  }
});

test("unsafe archive paths, sensitive files and symlink resources are rejected", async (t) => {
  const { root, output } = await fixture(t);
  const bytes = await readFile(join(root, "assets/icon.png"));
  await rm(join(root, "assets/icon.png"));
  await symlink(join(root, "private.pem"), join(root, "assets/icon.png"));
  await assert.rejects(buildPackage(root, output), /Symlinks/);
  await rm(join(root, "assets/icon.png"));
  await writeFile(join(root, "assets/icon.png"), bytes);
  const files = await sourceFiles(root);
  for (const name of ["../file", "/absolute", "C:/absolute", "path\\file"]) assert.throws(() => validateFiles(new Map([...files, [name, Buffer.from("bad")]]), "1.1.1"), /Unsafe archive path/);
  for (const name of [".env", "private.pem", "tests/test.js", "scripts/tool.js", "docs/data.json", "package-lock.json"]) assert.throws(() => validateFiles(new Map([...files, [name, Buffer.from("bad")]]), "1.1.1"), /Unexpected development file/);
});

test("default locale, manifest translations and release notes are required", async (t) => {
  const { root, output } = await fixture(t);
  const files = await sourceFiles(root);
  files.delete("_locales/en/messages.json");
  assert.throws(() => validateFiles(files, "1.1.1"), /Missing default locale/);
  files.set("_locales/en/messages.json", Buffer.from('{}'));
  assert.throws(() => validateFiles(files, "1.1.1"), /Missing manifest translation/);
  await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n- Future.\n");
  await assert.rejects(buildPackage(root, output), /Missing CHANGELOG/);
});

test("downloaded archives must match both SHA-256 and every source byte", async (t) => {
  const { root, output } = await fixture(t);
  const result = await buildPackage(root, output);
  await assert.rejects(verifyPackage(root, result.archive, "0".repeat(64)), /SHA-256 mismatch/);
  await writeFile(join(root, "content.js"), "// changed after packaging");
  await assert.rejects(verifyPackage(root, result.archive, result.sha256), /differs from source/);
  const altered = new AdmZip(await readFile(result.archive));
  altered.addFile("unused.js", Buffer.from("// extra runtime file"));
  const bytes = altered.toBuffer();
  await writeFile(result.archive, bytes);
  await assert.rejects(verifyPackage(root, result.archive, createHash("sha256").update(bytes).digest("hex")), /differs from source/);
});

test("ZIP CRC corruption and duplicate entries fail validation", () => {
  const zip = new AdmZip();
  const entry = zip.addFile("icon.png", Buffer.from("unique file payload"));
  entry.header.method = 0;
  const bytes = zip.toBuffer();
  bytes[bytes.indexOf("unique file payload")] ^= 1;
  assert.throws(() => archiveFiles(bytes), /CRC/);
  const duplicates = new AdmZip();
  duplicates.addFile("aaa.js", Buffer.from("first"));
  duplicates.addFile("bbb.js", Buffer.from("second"));
  const data = Buffer.from(duplicates.toBuffer().toString("latin1").replaceAll("bbb.js", "aaa.js"), "latin1");
  assert.throws(() => archiveFiles(data), /Duplicate/);
});

test("Actions CLI produces deterministic bytes across timestamps and timezones, outputs and summaries", async (t) => {
  const { root, output, tag } = await fixture(t);
  const summary = join(root, "summary.md"), outputs = join(root, "outputs.txt");
  await writeFile(summary, ""); await writeFile(outputs, "");
  const options = { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: outputs, TZ: "UTC" } };
  const first = spawnSync(process.execPath, [script, "--tag", tag, "--output", output], options);
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.match(first.stdout, /::group::Create and verify release ZIP/);
  assert.match(await readFile(outputs, "utf8"), /version<<[^\n]+\n1\.1\.1\n/);
  assert.match(await readFile(summary, "utf8"), /SHA-256/);
  const before = await readFile(join(output, "dopatube-1.1.1.zip"));
  await utimes(join(root, "assets/icon.png"), new Date(), new Date());
  const second = spawnSync(process.execPath, [script, "--tag", tag, "--output", output], { ...options, env: { ...options.env, TZ: "Asia/Tokyo" } });
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(before, await readFile(join(output, "dopatube-1.1.1.zip")));
});
