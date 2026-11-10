import * as core from "@actions/core";

export { info, setOutput, setSecret } from "@actions/core";

export async function withGroup(title, action) {
  return process.env.GITHUB_ACTIONS === "true"
    ? core.group(title, action)
    : action();
}

export async function writeSummary(title, rows, note = "") {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const escape = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  await core.summary
    .emptyBuffer()
    .addHeading(escape(title), 2)
    .addTable([
      [
        { data: "Item", header: true },
        { data: "Result", header: true },
      ],
      ...rows.map((row) => row.map(escape)),
    ])
    .addRaw(escape(note), true)
    .write();
}

export function fail(message) {
  if (process.env.GITHUB_ACTIONS === "true") core.setFailed(message);
  else {
    console.error(message);
    process.exitCode = 1;
  }
}
