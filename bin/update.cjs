// `doodlebot update --ref <tag or branch>`: move this workspace to a released tag or a branch
// of origin, then reinstall and rebuild. Plain Node with no dependencies, so it runs before tsx
// loads and while the code it replaces is changing under it.
"use strict";
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REF = /^[A-Za-z0-9._/-]+$/;
const VORTEX_IMAGES = new Set(["vortex.exe", "electron.exe", "vortex", "electron"]);

/** The arguments after `update`: `--ref <ref>` or `--ref=<ref>`, nothing else. */
function parseUpdateArgs(args) {
  if (args.length === 0) return undefined;
  if (args.length === 1 && args[0].startsWith("--ref=")) return args[0].slice("--ref=".length);
  if (args.length === 2 && args[0] === "--ref") return args[1];
  throw new Error("update takes only --ref <tag or branch>.");
}

/** The same lookup as harness/src/processes.ts: lower-cased image name, or undefined. */
function defaultImageName(pid) {
  if (process.platform === "win32") {
    const line = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    const match = /^"([^"]+)","(\d+)"/.exec(line);
    return match !== null && Number(match[2]) === pid ? match[1].toLowerCase() : undefined;
  }
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim().toLowerCase() || undefined;
  } catch (err) {
    if (err.code === "ENOENT") return undefined;
    throw err;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/** Whether an instance record file names a running Vortex (runningVortex.ts's rule). */
function recordRunning(file, imageName) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  const pid = record === null || typeof record !== "object" ? undefined : record.pid;
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return false;
  const image = imageName(pid);
  return image !== undefined && VORTEX_IMAGES.has(image);
}

/** Spawn a command; `git` directly, `pnpm` through the shell with fixed arguments. */
function defaultRun(cmd, args, opts) {
  const result = opts.shell
    ? spawnSync([cmd, ...args].join(" "), { cwd: opts.cwd, shell: true, stdio: "inherit" })
    : spawnSync(cmd, args, {
        cwd: opts.cwd,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "inherit"],
      });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

/**
 * Update the workspace at `root` to `ref`. `run(cmd, args, { cwd, shell? })` returns
 * `{ status, stdout }`; `deps.stateDir` (default ~/.doodlebot) holds the instance record, and
 * `deps.imageName(pid)` names a process's executable.
 */
function update(root, ref, run = defaultRun, deps = {}) {
  const stateDir = deps.stateDir ?? path.join(os.homedir(), ".doodlebot");
  const imageName = deps.imageName ?? defaultImageName;
  const log = deps.log ?? ((message) => process.stdout.write(`${message}\n`));
  if (ref === undefined || ref === "") throw new Error("update needs --ref <tag or branch>.");
  // A leading "-" would read as a git option.
  if (!REF.test(ref) || ref.startsWith("-"))
    throw new Error(
      `Invalid ref ${JSON.stringify(ref)}: use letters, digits, ".", "_", "/" or "-".`,
    );

  const records = [
    path.join(stateDir, "instance.json"),
    // The record of an older doodlebot, before it moved to the per-user folder.
    path.join(root, "harness", ".cache", "instance.json"),
  ];
  if (records.some((file) => recordRunning(file, imageName)))
    throw new Error("A harness Vortex is running; run doodlebot down before updating.");

  const step = (cmd, args, shell = false) => {
    const result = run(cmd, args, shell ? { cwd: root, shell: true } : { cwd: root });
    if (result.status !== 0)
      throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${String(result.status)}.`);
    return result;
  };
  if (step("git", ["status", "--porcelain"]).stdout.trim() !== "")
    throw new Error("The workspace has local changes; commit or remove them before updating.");

  if (
    run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${ref}`], { cwd: root })
      .status === 0
  ) {
    log(`update: ${ref} is a tag on origin`);
    step("git", ["fetch", "origin", "tag", ref]);
    step("git", ["checkout", "--detach", `refs/tags/${ref}`]);
  } else if (
    run("git", ["ls-remote", "--exit-code", "--heads", "origin", ref], { cwd: root }).status === 0
  ) {
    log(`update: ${ref} is a branch on origin`);
    step("git", ["fetch", "origin", ref]);
    step("git", ["checkout", "--detach", "FETCH_HEAD"]);
  } else {
    throw new Error(`No tag or branch ${ref} on origin.`);
  }
  step("pnpm", ["install", "--frozen-lockfile"], true);
  step("pnpm", ["run", "build"], true);
  log(`Updated ${root} to ${ref}; dependencies installed and the extension built.`);
}

module.exports = { update, parseUpdateArgs, defaultRun };
