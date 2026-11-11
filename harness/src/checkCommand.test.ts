import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOW_DISK_BYTES,
  checkCommand,
  checkRows,
  formatCheck,
  type CheckDeps,
  type CheckRow,
} from "./checkCommand";
import { updateContent } from "./content";
import { addGap } from "./gapCommand";
import { addLesson } from "./knowledgeCommand";

let root: string;
let deps: CheckDeps & { contentFile: string; gapsFile: string };

const LESSON = {
  area: "collections",
  symptom: "s",
  cause: "c",
  remedy: "r",
  scope: "sc",
  evidence: "e",
  vortex: "2.8.0",
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "check-command-"));
  const settings = path.join(root, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ enabledPlugins: { "egm@egm": true } }));
  fs.writeFileSync(
    path.join(root, "shared-knowledge.md"),
    "# Knowledge\n\n## Collections\n\n### Review stays open after Resume\n\nText.\n",
  );
  deps = {
    version: () => ({ version: "2.0.0", commit: "abcdef1234567", dirty: false, workspace: root }),
    doctor: () =>
      Promise.resolve([
        { name: "Vortex (installed)", ok: true, detail: "C:/Vortex/Vortex.exe" },
        {
          name: "7-Zip",
          ok: false,
          advisory: true,
          detail: "not found",
          fix: "winget install 7zip.7zip",
        },
        { name: "Nexus login captured", ok: false, advisory: true, detail: "missing" },
      ]),
    inventory: () => ({
      items: [
        { id: "sandbox", kind: "sandbox", ready: true, label: "the fake game" },
        { id: "login", kind: "login", ready: false, next: "x", label: "no Nexus login cached" },
      ],
    }),
    contentFile: path.join(root, "content.json"),
    gapsFile: path.join(root, "gaps.md"),
    knowledge: {
      local: path.join(root, "knowledge.md"),
      shared: path.join(root, "shared-knowledge.md"),
    },
    userSettingsFile: settings,
    installedPluginsFile: path.join(root, "installed_plugins.json"),
    source: () => ({
      dir: path.join(root, "vortex"),
      remotes: { upstream: "https://github.com/Nexus-Mods/Vortex.git" },
      branch: "master",
      built: false,
    }),
    oldClone: path.join(root, "old-clone"),
    artifactDir: path.join(root, "artifacts"),
    cacheDir: path.join(root, "cache"),
    releasesDir: path.join(root, "releases"),
    sizeOf: (dir) => (dir.endsWith("artifacts") ? 3 * 1024 ** 3 : undefined),
    freeBytes: () => 50 * 1024 ** 3,
  };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const row = (rows: CheckRow[], item: string): CheckRow | undefined =>
  rows.find((r) => r.item === item);

describe("doodlebot check", () => {
  it("prints one row per item: ready, missing with the exact next command, or blocked", async () => {
    const rows = await checkRows(deps);
    expect(row(rows, "doodlebot")).toMatchObject({ status: "ready", area: "workspace" });
    expect(row(rows, "doodlebot")?.detail).toContain("2.0.0 (abcdef1234");
    expect(row(rows, "7-Zip")).toMatchObject({
      status: "advisory",
      next: "winget install 7zip.7zip",
    });
    // The login is its own row, not doctor's.
    expect(row(rows, "Nexus login captured")).toBeUndefined();
    expect(row(rows, "Nexus login")).toMatchObject({
      status: "missing",
      next: "/doodlebot:setup --login",
    });
    expect(row(rows, "EGM (Elephant-Goldfish Model)")?.status).toBe("ready");
    expect(row(rows, "this checkout")).toMatchObject({
      status: "missing",
      next: `doodlebot build --checkout ${path.join(root, "vortex")}`,
    });
    expect(row(rows, "this checkout")?.detail).toMatch(
      /upstream https:.*no fork as origin.*master/,
    );
    expect(row(rows, "old Vortex clone")).toBeUndefined();
    expect(row(rows, "sandbox")?.status).toBe("ready");
    expect(row(rows, "copy folder")).toMatchObject({
      status: "missing",
      next: "doodlebot game folder <dir>",
    });
    expect(row(rows, "pending restores")).toMatchObject({ status: "ready", detail: "none" });
    expect(row(rows, "open kit gaps")).toMatchObject({ status: "info", detail: "none" });
    expect(row(rows, "harness/.artifacts")?.detail).toMatch(/^3\.0 GB/);
    expect(row(rows, "harness/.cache")?.detail).toContain("absent");
    expect(row(rows, "free space")).toMatchObject({ status: "ready" });
    for (const r of rows)
      if (r.status === "missing" || r.status === "blocked") expect(r.next, r.item).toBeDefined();
  });

  it("lists a pending restore with doodlebot game restore <id>, and each registered copy's size", async () => {
    updateContent((content) => {
      content.copyFolder = path.join(root, "copies");
      content.games.push({
        gameId: "stardewvalley",
        path: path.join(root, "copies", "stardewvalley"),
        sizeBytes: 2 * 1024 ** 3,
        registeredAt: "2026-11-10T00:00:00.000Z",
      });
      content.pendingRestores.push({
        gameId: "stardewvalley",
        backupDir: path.join(root, "cache", "backup"),
        startedAt: "2026-11-10T01:00:00.000Z",
      });
    }, deps.contentFile);
    const rows = await checkRows(deps);
    expect(row(rows, "copy folder")).toMatchObject({ status: "ready" });
    expect(row(rows, "pending restore: stardewvalley")).toMatchObject({
      status: "blocked",
      next: "doodlebot game restore stardewvalley",
    });
    expect(row(rows, "game copy stardewvalley")?.detail).toMatch(/^2\.0 GB recorded/);
  });

  it("warns below 10 GB free and names doodlebot clean", async () => {
    deps.freeBytes = () => LOW_DISK_BYTES - 1;
    const free = row(await checkRows(deps), "free space");
    expect(free?.status).toBe("advisory");
    expect(free?.detail).toContain("below 10 GB");
    expect(free?.next).toContain("doodlebot clean");
  });

  it("counts open kit gaps and offers to remove local lessons KNOWLEDGE.md now holds", async () => {
    addGap(
      {
        title: "No tool reads the Downloads queue",
        command: "/doodlebot:try",
        needed: "the queue",
        happened: "nothing",
        blocked: "no",
      },
      { file: deps.gapsFile, kit: () => "abc", isAncestor: () => false },
    );
    const duplicate = addLesson(
      { title: "review stays open after resume", ...LESSON },
      deps.knowledge!.local,
    );
    addLesson({ title: "Something only local", ...LESSON }, deps.knowledge!.local);
    const rows = await checkRows(deps);
    expect(row(rows, "open kit gaps")).toMatchObject({
      detail: "1: No tool reads the Downloads queue",
      next: "doodlebot gap list",
    });
    const lessons = rows.filter((r) => r.item.startsWith("local lesson "));
    expect(lessons).toEqual([
      expect.objectContaining({
        item: `local lesson ${duplicate.id}`,
        next: `doodlebot knowledge remove ${duplicate.id}`,
      }),
    ]);
  });

  it("reports EGM missing with the install step when no settings file enables it", async () => {
    deps.userSettingsFile = path.join(root, "absent.json");
    expect(row(await checkRows(deps), "EGM (Elephant-Goldfish Model)")).toMatchObject({
      status: "missing",
      next: expect.stringContaining("install EGM at user scope"),
    });
  });

  it("U4: counts only user scope for EGM; a project-scope install alone is missing", async () => {
    deps.userSettingsFile = path.join(root, "absent.json");
    const install = (scope: string) =>
      fs.writeFileSync(
        deps.installedPluginsFile!,
        JSON.stringify({
          version: 2,
          plugins: {
            "egm@egm": [{ scope, ...(scope === "project" ? { projectPath: root } : {}) }],
          },
        }),
      );
    install("project");
    expect(row(await checkRows(deps), "EGM (Elephant-Goldfish Model)")).toMatchObject({
      status: "missing",
      detail: expect.stringContaining("installed only at project scope"),
      next: expect.stringContaining("install EGM at user scope"),
    });
    install("user");
    expect(row(await checkRows(deps), "EGM (Elephant-Goldfish Model)")).toMatchObject({
      status: "ready",
      detail: "installed at user scope",
    });
  });

  it("outside a Vortex checkout, names the step that makes one, and prints a table or JSON", async () => {
    deps.source = () => undefined;
    const text = await checkCommand({}, deps);
    expect(text).toContain("[advisory] this checkout: this session is not in a Vortex checkout");
    expect(text).toContain(
      "next: Open Claude in a Vortex checkout or worktree (or clone one with `doodlebot source --clone <dir>`).",
    );
    expect(text).toMatch(/item\(s\) missing or blocked/);
    const json = JSON.parse(await checkCommand({ json: true }, deps)) as { rows: CheckRow[] };
    expect(row(json.rows, "this checkout")?.status).toBe("advisory");
    expect(formatCheck([])).toContain("Nothing missing.");
  });

  it("S1: reports an old Vortex clone with its worktrees and no delete step", async () => {
    const clone = deps.oldClone!;
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
    fs.mkdirSync(clone);
    git(clone, "init", "-q", "-b", "master");
    git(
      clone,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.test",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    );
    for (const name of ["wt-a", "wt-b"])
      git(clone, "worktree", "add", "-q", "-b", name, path.join(root, name));
    expect(row(await checkRows(deps), "old Vortex clone")).toEqual({
      area: "vortex source",
      item: "old Vortex clone",
      status: "advisory",
      detail: `Your Vortex clone from an older doodlebot (${clone}, 2 worktrees): open Claude in it or one of its worktrees`,
    });
    expect(await checkCommand({}, deps)).not.toMatch(/doodlebot clean/);
  });
});
