/**
 * The plugin's SessionStart hook, `plugins/doodlebot/hooks/session-note.cjs`
 * (designs/vortex-session-context.md, criteria 1-4): silent outside a Vortex checkout, the note in
 * a checkout and in a linked worktree, one line when doodlebot is not set up, and fast.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REPO_ROOT } from "./paths";

const SCRIPT = path.join(REPO_ROOT, "plugins", "doodlebot", "hooks", "session-note.cjs");
const hook = createRequire(import.meta.url)(SCRIPT) as {
  sessionNote: (
    input: { cwd?: string },
    env: { home: string; pluginRoot?: string },
  ) => string | undefined;
  MAX_NOTE: number;
  NOT_SET_UP: string;
};

let temp: string;
let home: string;
let workspace: string;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-note-"));
  home = path.join(temp, "home");
  workspace = path.join(temp, "workspace");
  fs.mkdirSync(path.join(workspace, "bin"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "bin", "doodlebot.cjs"), "");
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function repo(name: string, packageName: string): string {
  const dir = path.join(temp, name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  git(dir, "init", "-q", "-b", "master");
  git(dir, "config", "user.email", "t@example.test");
  git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: packageName }));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return dir;
}

function linked(): void {
  fs.mkdirSync(path.join(home, ".doodlebot"), { recursive: true });
  fs.writeFileSync(path.join(home, ".doodlebot", "workspace.json"), JSON.stringify({ workspace }));
}

/** Runs the script as Claude Code does: hook input on stdin, the home folder from the env. */
function runHook(input: unknown): { stdout: string; status: number | null; ms: number } {
  const started = performance.now();
  const result = spawnSync(process.execPath, [SCRIPT], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: "/plugin" },
  });
  return { stdout: result.stdout, status: result.status, ms: performance.now() - started };
}

describe("the SessionStart session note", () => {
  it("prints nothing outside a Vortex checkout", () => {
    linked();
    const other = repo("other", "some-app");
    for (const cwd of [other, path.join(other, "src"), path.join(temp, "home"), temp])
      expect(hook.sessionNote({ cwd }, { home })).toBeUndefined();
    expect(runHook({ hook_event_name: "SessionStart", cwd: other })).toMatchObject({
      stdout: "",
      status: 0,
    });
    // Input that is not the hook's: still silent, still exit 0.
    expect(runHook("not json")).toMatchObject({ stdout: "", status: 0 });
    expect(runHook({ hook_event_name: "SessionStart" })).toMatchObject({ stdout: "", status: 0 });
  });

  it("gives the note in a Vortex checkout, a subfolder and a linked worktree", () => {
    linked();
    const vortex = repo("vortex", "@vortex/monorepo");
    const worktree = path.join(temp, "wt");
    git(vortex, "worktree", "add", "-q", "-b", "feat/x", worktree, "master");
    for (const cwd of [vortex, path.join(vortex, "src"), worktree]) {
      const result = runHook({ hook_event_name: "SessionStart", source: "startup", cwd });
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as {
        hookSpecificOutput: { hookEventName: string; additionalContext: string };
      };
      expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
      const note = output.hookSpecificOutput.additionalContext;
      expect(note).toContain(`workspace ${workspace}`);
      expect(note).toContain("/doodlebot:try");
      expect(note).toContain("/doodlebot:qa --design <design>");
      expect(note).toContain(path.join(workspace, "harness", "reference", "mcp-tools.md"));
      expect(note).toContain(path.join("/plugin", "resources", "egm.md"));
      expect(note.length).toBeLessThan(hook.MAX_NOTE);
    }
  });

  it("says to run /doodlebot:setup when link has not recorded a workspace", () => {
    const vortex = repo("vortex", "@vortex/monorepo");
    expect(hook.sessionNote({ cwd: vortex }, { home })).toBe(hook.NOT_SET_UP);
    // A record naming a folder that no longer holds the CLI counts as not set up.
    fs.mkdirSync(path.join(home, ".doodlebot"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".doodlebot", "workspace.json"),
      JSON.stringify({ workspace: path.join(temp, "gone") }),
    );
    expect(hook.sessionNote({ cwd: vortex }, { home })).toBe(hook.NOT_SET_UP);
    expect(hook.NOT_SET_UP).toContain("/doodlebot:setup");
  });

  it("finishes quickly: it reads two files and starts no process", () => {
    linked();
    const vortex = repo("vortex", "@vortex/monorepo");
    runHook({ cwd: vortex }); // warm the file cache
    const { ms, stdout } = runHook({ hook_event_name: "SessionStart", cwd: vortex });
    expect(stdout).not.toBe("");
    // Node's own start-up is most of this; the design's budget is 300 ms on a warm machine.
    expect(ms).toBeLessThan(1000);
  });
});
