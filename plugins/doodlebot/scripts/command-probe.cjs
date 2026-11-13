// Read-only command discovery for a plugin whose doodlebot command cannot run.
// No workspace dependencies or child processes: this must work before the CLI does.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function envValue(env, name, platform) {
  const key =
    platform === "win32"
      ? Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
      : name;
  return key === undefined ? "" : (env[key] ?? "");
}

function inspectShim(file, platform) {
  if (!fs.statSync(file).isFile()) return false;
  // access() alone does not enforce Windows ACLs. Opening the file does.
  const fd = fs.openSync(file, "r");
  fs.closeSync(fd);
  if (platform !== "win32") fs.accessSync(file, fs.constants.X_OK);
  return true;
}

function failure(file, error) {
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
  return {
    path: file,
    status: ["EACCES", "EPERM"].includes(code) ? "inaccessible" : "error",
    code,
  };
}

/** Discovery is not execution: "found" still needs a successful version --json. */
function probe(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const inspect = options.inspect ?? inspectShim;
  const p = platform === "win32" ? path.win32 : path.posix;
  const cwd = options.cwd ?? process.cwd();
  const diagnostics = [];
  let workspace;
  let recordedShim;
  if (home !== "") {
    const record = path.join(home, ".doodlebot", "workspace.json");
    try {
      const value = JSON.parse(fs.readFileSync(record, "utf8").replace(/^\uFEFF/, ""));
      if (value === null || typeof value.workspace !== "string" || !p.isAbsolute(value.workspace))
        throw Object.assign(new Error("Invalid workspace record"), { code: "INVALID_RECORD" });
      workspace = value.workspace;
      if (typeof value.shim === "string" && p.isAbsolute(value.shim)) recordedShim = value.shim;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) diagnostics.push(failure(record, error));
    }
  }

  const candidates = [
    options.shim,
    recordedShim,
    ...envValue(env, "PATH", platform)
      .split(platform === "win32" ? ";" : ":")
      .filter((dir) => platform !== "win32" || dir.trim() !== "")
      .map((dir) =>
        p.join(
          platform === "win32" ? dir.trim().replace(/^"(.*)"$/, "$1") : dir,
          platform === "win32" ? "doodlebot.cmd" : "doodlebot",
        ),
      ),
  ]
    .filter((file) => typeof file === "string" && file !== "")
    .map((file) => p.resolve(cwd, file));
  const seen = new Set();
  const found = [];
  for (const file of candidates) {
    const key = platform === "win32" ? file.toLowerCase() : file;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (inspect(file, platform)) found.push(file);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) diagnostics.push(failure(file, error));
    }
  }
  const status =
    found.length > 0
      ? "found"
      : diagnostics.some((item) => item.status === "inaccessible")
        ? "inaccessible"
        : diagnostics.length > 0
          ? "error"
          : "missing";
  return {
    status,
    ...(found.length > 0 ? { shim: found[0] } : {}),
    ...(workspace === undefined ? {} : { workspace }),
    diagnostics,
  };
}

if (require.main === module) {
  if (process.argv.length > 3) {
    process.stderr.write("Usage: node command-probe.cjs [known-shim]\n");
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(JSON.stringify(probe({ shim: process.argv[2] }), null, 2) + "\n");
    } catch (error) {
      process.stdout.write(
        JSON.stringify({ status: "error", code: error.code ?? "UNKNOWN" }) + "\n",
      );
      process.exitCode = 1;
    }
  }
}
module.exports = { probe };
