// The doodlebot plugin's SessionStart hook (designs/vortex-session-context.md). In a Vortex
// checkout or worktree it gives the session a short note: doodlebot is set up, and a Vortex change
// is not finished until doodlebot has shown it working. Anywhere else it prints nothing. It only
// reads: no file is written, and no process is started (`doodlebot version --json` takes seconds).
// Plain CommonJS without dependencies, so it runs from the plugin folder alone.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const VORTEX_PACKAGE = "@vortex/monorepo";
/** Claude Code caps hook context at 10,000 characters; the note stays far below. */
const MAX_NOTE = 2000;

/** The folder holding `.git` (a directory, or a worktree's `.git` file) at or above `dir`. */
function gitTop(dir) {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return undefined;
  }
}

/** The Vortex checkout `cwd` is in, or undefined. */
function vortexCheckout(cwd) {
  if (typeof cwd !== "string" || cwd === "") return undefined;
  const top = gitTop(cwd);
  if (top === undefined) return undefined;
  const pkg = readJson(path.join(top, "package.json"));
  return pkg !== undefined && pkg !== null && pkg.name === VORTEX_PACKAGE ? top : undefined;
}

/** The workspace `doodlebot link` recorded, when it still holds the CLI. */
function workspace(home) {
  const record = readJson(path.join(home, ".doodlebot", "workspace.json"));
  const dir = record !== undefined && record !== null ? record.workspace : undefined;
  if (typeof dir !== "string" || !fs.existsSync(path.join(dir, "bin", "doodlebot.cjs")))
    return undefined;
  return dir;
}

function note(dir, pluginRoot) {
  const ref = (rel) => path.join(dir, ...rel.split("/"));
  const lines = [
    `This session is in a Vortex checkout, and the doodlebot companion is set up (workspace ${dir}). Doodlebot runs Vortex for real, in an isolated test instance, and proves changes on it.`,
    "- A Vortex change is not finished when it compiles and its unit tests pass. Before saying it works, offer to show it working: /doodlebot:try to see it in a test Vortex, /doodlebot:qa <branch> to compare it with its base, /doodlebot:qa --design <design> to check a design's acceptance criteria with negative controls.",
    `- Write acceptance criteria, in a design or a plan, as things that can be observed on a running Vortex. What doodlebot can observe: ${ref("harness/reference/cli.md")} and ${ref("harness/reference/mcp-tools.md")}. Known traps: ${ref("KNOWLEDGE.md")}.`,
  ];
  if (typeof pluginRoot === "string" && pluginRoot !== "")
    lines.push(
      `- For a feature's EGM design, follow ${path.join(pluginRoot, "resources", "egm.md")}.`,
    );
  lines.push(
    "- Never start a test Vortex yourself outside these commands; the person's own Vortex must keep running.",
  );
  return lines.join("\n").slice(0, MAX_NOTE);
}

const NOT_SET_UP =
  "This session is in a Vortex checkout. The doodlebot plugin is installed but not set up on this machine: run /doodlebot:setup (or `doodlebot link` in the doodlebot workspace).";

/** The context for one hook input, or undefined to print nothing. */
function sessionNote(input, env) {
  if (vortexCheckout(input && input.cwd) === undefined) return undefined;
  const dir = workspace(env.home);
  return dir === undefined ? NOT_SET_UP : note(dir, env.pluginRoot);
}

function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    let input;
    try {
      input = JSON.parse(raw.replace(/^﻿/, ""));
    } catch {
      return;
    }
    let context;
    try {
      context = sessionNote(input, {
        home: os.homedir(),
        pluginRoot: process.env.CLAUDE_PLUGIN_ROOT,
      });
    } catch {
      return;
    }
    if (context === undefined) return;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
      }),
    );
  });
}

if (require.main === module) main();

module.exports = { sessionNote, vortexCheckout, MAX_NOTE, NOT_SET_UP };
