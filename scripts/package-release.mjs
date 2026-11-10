import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import AdmZip from "adm-zip";
import { fail, info, setOutput, withGroup, writeSummary } from "./actions.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function versionParts(version) {
  check(typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version),
    "Expected a stable three-part version");
  const parts = version.split(".").map(Number);
  check(parts.every((part) => part <= 65535) && parts.some(Boolean), "Invalid Chrome version");
  return parts;
}

export async function releaseVersion(root, tag) {
  // npm metadata describes tooling; the extension manifest is the version authority.
  const { version } = await json(join(root, "manifest.json"));
  versionParts(version);
  if (tag) check(tag === `v${version}`, "Release tag must match the manifest version");
  return version;
}

function validateName(name) {
  check(typeof name === "string" && name && !posix.isAbsolute(name)
    && !/^[A-Za-z]:/.test(name) && !name.includes("\\") && !name.includes("\0")
    && !name.split("/").some((part) => part === ".." || part === ""), "Unsafe archive path");
  check(!name.split("/").some((part) => part.startsWith(".")
    || ["node_modules", "tests", "docs", "scripts", "src", "dist", "releases"].includes(part))
    && !["package.json", "package-lock.json"].includes(name)
    && (name === "LICENSE" || /\.(?:html|css|js|json|png|jpe?g|svg|webp|gif|ico|woff2?)$/.test(name)),
  "Unexpected development file in archive");
}

function manifestReferences(manifest) {
  const icons = (value) => typeof value === "string" ? [value] : Object.values(value ?? {});
  const refs = [...icons(manifest.icons), ...icons(manifest.action?.default_icon),
    ...Object.values(manifest.chrome_url_overrides ?? {})];
  if (manifest.action?.default_popup) refs.push(manifest.action.default_popup);
  if (manifest.options_ui?.page) refs.push(manifest.options_ui.page);
  if (manifest.options_page) refs.push(manifest.options_page);
  if (manifest.background?.service_worker) refs.push(manifest.background.service_worker);
  for (const entry of manifest.content_scripts ?? []) refs.push(...(entry.js ?? []), ...(entry.css ?? []));
  for (const entry of manifest.web_accessible_resources ?? []) refs.push(...entry.resources);
  for (const ref of refs) {
    check(!/[*?]/.test(ref), "Use explicit manifest resource paths for release packaging");
    validateName(ref);
  }
  return refs;
}

function resourceReferences(name, bytes) {
  const refs = [];
  const add = (ref, externalLink = false) => {
    if (externalLink && /^https:\/\//i.test(ref)) return;
    if (ref.startsWith("#")) return;
    check(!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref), "Remote or unsupported HTML/CSS resource");
    const path = ref.split(/[?#]/)[0];
    check(path, "Empty resource path");
    const target = path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(name), path);
    validateName(target);
    refs.push(target);
  };
  if (name.endsWith(".html")) {
    for (const [, tag, attributes] of bytes.toString().matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
      for (const [, attribute, ref] of attributes.matchAll(/\b(src|href)\s*=\s*["']([^"']+)["']/gi)) {
        add(ref, tag.toLowerCase() === "a" && attribute.toLowerCase() === "href");
      }
    }
  }
  if (name.endsWith(".css")) {
    const css = bytes.toString();
    for (const [, ref] of css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) add(ref);
    for (const [, ref] of css.matchAll(/@import\s+["']([^"']+)["']/gi)) add(ref);
  }
  return refs;
}

async function safeRead(root, name) {
  validateName(name);
  let path = root;
  const parts = name.split("/");
  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index]);
    const entry = await lstat(path);
    check(!entry.isSymbolicLink(), "Symlinks are not allowed in release resources");
    check(index === parts.length - 1 ? entry.isFile() : entry.isDirectory(), "Unexpected resource file type");
  }
  return readFile(path);
}

export async function sourceFiles(root) {
  const manifestBytes = await safeRead(root, "manifest.json");
  const manifest = JSON.parse(manifestBytes);
  const files = new Map([["manifest.json", manifestBytes]]);
  const pending = ["LICENSE", ...manifestReferences(manifest)];
  const localeRoot = await lstat(join(root, "_locales"));
  check(localeRoot.isDirectory() && !localeRoot.isSymbolicLink(), "Expected a regular _locales directory");
  for (const entry of await readdir(join(root, "_locales"), { withFileTypes: true })) {
    check(entry.isDirectory() && !entry.isSymbolicLink() && /^[a-z]{2,3}(?:_[A-Za-z0-9]+)?$/.test(entry.name),
      "Unexpected locale directory");
    pending.push(`_locales/${entry.name}/messages.json`);
  }
  while (pending.length) {
    const name = pending.shift();
    if (files.has(name)) continue;
    const bytes = await safeRead(root, name);
    files.set(name, bytes);
    pending.push(...resourceReferences(name, bytes));
  }
  return new Map([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export function validateFiles(files, version) {
  check(files.has("manifest.json"), "manifest.json must be at the ZIP root");
  check(files.has("LICENSE"), "Missing LICENSE");
  for (const name of files.keys()) validateName(name);
  const manifest = JSON.parse(files.get("manifest.json").toString());
  check(manifest.version === version && manifest.manifest_version === 3, "Unexpected archive manifest");
  for (const ref of manifestReferences(manifest)) check(files.has(ref), `Missing manifest resource: ${ref}`);
  for (const [name, content] of files) {
    for (const ref of resourceReferences(name, content)) check(files.has(ref), `Missing HTML/CSS resource: ${ref}`);
  }
  check(typeof manifest.default_locale === "string" && /^[a-z]{2,3}(?:_[A-Za-z0-9]+)?$/.test(manifest.default_locale),
    "Missing or invalid default locale");
  const defaultPath = `_locales/${manifest.default_locale}/messages.json`;
  check(files.has(defaultPath), "Missing default locale catalog");
  const fallback = JSON.parse(files.get(defaultPath).toString());
  for (const [name, bytes] of files) {
    if (!/^_locales\/[^/]+\/messages\.json$/.test(name)) continue;
    const catalog = JSON.parse(bytes.toString());
    for (const [key, value] of Object.entries(catalog)) {
      check(typeof value?.message === "string" && value.message.trim(), `Invalid message: ${name}:${key}`);
    }
  }
  for (const [, key] of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) {
    check(fallback[key]?.message, `Missing manifest translation: ${key}`);
  }
  return manifest;
}

export function archiveFiles(bytes) {
  const zip = new AdmZip(bytes);
  const files = new Map();
  for (const entry of zip.getEntries()) {
    validateName(entry.entryName);
    check(!files.has(entry.entryName), "Duplicate ZIP entries");
    files.set(entry.entryName, entry.getData());
  }
  return files;
}

export async function buildPackage(root, output, tag) {
  const version = await releaseVersion(root, tag);
  const files = await sourceFiles(root);
  validateFiles(files, version);
  const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
  const escaped = version.replaceAll(".", "\\.");
  const match = changelog.match(new RegExp(`^## ${escaped}(?:[^\\S\\r\\n][^\\n]*)?\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
  check(match?.[1].trim(), "Missing CHANGELOG entry for release version");
  const zip = new AdmZip();
  for (const [name, content] of files) {
    const entry = zip.addFile(name, content, "", 0o644);
    entry.header.timeval = 0x00210000;
    entry.header.made = 0x0314;
  }
  const bytes = zip.toBuffer();
  check(isDeepStrictEqual(archiveFiles(bytes), files), "ZIP differs from source");
  await mkdir(output, { recursive: true });
  const archive = join(output, `dopatube-${version}.zip`);
  const digest = sha256(bytes);
  await writeFile(archive, bytes);
  await writeFile(`${archive}.sha256`, `${digest}  dopatube-${version}.zip\n`);
  await writeFile(join(output, "release-notes.md"), `${match[1].trim()}\n`);
  return { version, archive, sha256: digest };
}

export async function verifyPackage(root, archive, expectedHash, tag) {
  const version = await releaseVersion(root, tag);
  const bytes = await readFile(archive);
  check(/^[a-f0-9]{64}$/.test(expectedHash ?? "") && sha256(bytes) === expectedHash, "Archive SHA-256 mismatch");
  const files = archiveFiles(bytes);
  validateFiles(files, version);
  check(isDeepStrictEqual(files, await sourceFiles(root)), "Archive differs from source files");
  return version;
}

async function main() {
  const { values } = parseArgs({ options: {
    tag: { type: "string" }, output: { type: "string", default: "releases" },
    "check-version": { type: "boolean" }, verify: { type: "string" }, sha256: { type: "string" },
  } });
  const root = process.cwd();
  if (values.verify) {
    const version = await withGroup("Verify release archive", () => verifyPackage(root, values.verify, values.sha256, values.tag));
    info(`Verified downloaded archive for ${version}`);
    return;
  }
  if (values["check-version"]) { info(await releaseVersion(root, values.tag)); return; }
  const result = await withGroup("Create and verify release ZIP", () => buildPackage(root, values.output, values.tag));
  info(`Verified package: ${result.archive} (SHA-256 ${result.sha256})`);
  if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(result)) setOutput(key, value);
  await writeSummary("Package ready", [["Version", result.version], ["Archive", result.archive], ["SHA-256", result.sha256]]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(`Packaging failed: ${error.message}`));
}
